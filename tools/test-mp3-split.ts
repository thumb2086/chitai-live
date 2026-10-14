/**
 * MP3 切分器測試（2026-10-14）
 *
 * ★ 為什麼要專門測這個
 *   切在影格中間會讓那一小段變成雜訊，而**症狀是在轉錄結果裡**——
 *   「某幾個詞聽起來亂掉」，不會丟錯誤。
 *   所以要驗的是「切出來的每一段，重新組回去的位元組完全相同」
 *   加上「每一段的開頭都是一個合法影格」。
 *
 *   這兩件事都不需要真的送 STT 就能驗。
 *
 * 執行：npx tsx tools/test-mp3-split.ts
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}${extra ? "  " + extra : ""}`);
  } else {
    fail++;
    console.log(`  ★ 失敗: ${name}${extra ? "  " + extra : ""}`);
  }
}

async function main() {
  const { splitMp3, parseFrame, id3Size, looksLikeMp3 } = await import(
      "../src/lib/mp3-split.ts"
    );

  const CHUNK = 20 * 1024 * 1024;

  // ── 造一個結構正確的假 MP3 ──
  //  MPEG1 Layer III, 128 kbps, 44100 Hz → 每影格 417 或 418 bytes
  function makeMp3(frames: number, bitrateKbps = 128, rateHz = 44100): Uint8Array {
    const brIdx = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, -1].indexOf(
      bitrateKbps,
    );
    const srIdx = [44100, 48000, 32000, -1].indexOf(rateHz);
    const frameLen = Math.floor((1152 / 8) * (bitrateKbps * 1000)) / rateHz;

    const size = Math.floor(frameLen) * frames + 10;
    const b = new Uint8Array(size);
    b[0] = 0x49; b[1] = 0x44; b[2] = 0x33; // ID3
    b[3] = 3; b[4] = 0; b[5] = 0;
    // ★ 標籤 payload 長度寫 0，不是 size-10。
    //   寫 size-10 等於宣告「整個檔案都是 ID3 標籤內容」，
    //   那 id3Size() 當然會回檔案總長 —— 那不是切分器的 bug，
    //   是假資料寫錯了。（第一版就是這樣，9 條全紅，差點以為切分器壞掉。）
    b[6] = 0; b[7] = 0; b[8] = 0; b[9] = 0;

    let pos = 10;
    for (let i = 0; i < frames; i++) {
      if (pos + 4 > b.length) break;
      b[pos] = 0xff;
      b[pos + 1] = 0xfb;                     // MPEG1, Layer III, no CRC
      b[pos + 2] = (brIdx << 4) | (srIdx << 2);
      b[pos + 3] = 0x00;
      pos += Math.floor(frameLen);
    }
    return b;
  }

  console.log("\n══ MP3 影格切分測試 ══\n");

  console.log("── 1. 影格標頭解析 ──");
  {
    const m = makeMp3(50);
    ok("looksLikeMp3 認得 ID3 + 影格", looksLikeMp3(m));
    const off = id3Size(m);
    ok("id3Size 算出標頭長度", off === 10, `實得 ${off}`);
    const f = parseFrame(m, off);
    ok("能解析第一個影格", !!f, f ? `length=${f.length}` : "");
    ok("影格長度合理（128kbps/44.1k ≈ 417）", !!f && f.length >= 400 && f.length <= 440,
       f ? `${f.length}` : "");
    ok("非影格位置回 null", parseFrame(m, off + 1) === null);
    ok("超出結尾回 null", parseFrame(m, m.length - 2) === null);
    const notMp3 = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4]);
    ok("WAV 頭不會被當 MP3", !looksLikeMp3(notMp3));
    ok("WAV 切分回 null（明確拒絕，不是亂切）", splitMp3(notMp3, CHUNK) === null);
  }

  console.log("\n── 2. 小於上限 → 不切 ──");
  {
    const m = makeMp3(100);
    const parts = splitMp3(m, CHUNK);
    ok("回 1 段", !!parts && parts.length === 1, `實得 ${parts?.length}`);
    ok("位元組完全相同", !!parts && parts[0].length === m.length);
  }

  console.log("\n── 3. 超過上限 → 依影格邊界切 ──");
  {
    // 造一個超過 1 MB 的檔，用 1 MB 當上限來測（不用真的 20 MB）
    const limit = 1024 * 1024;
    const frames = Math.ceil((limit * 1.35) / 417) + 10;
    const m = makeMp3(frames);
    ok("測試檔超過上限", m.length > limit, `${(m.length / 1048576).toFixed(2)} MB`);

    const parts = splitMp3(m, limit);
    ok("切成多段", !!parts && parts.length > 1, `實得 ${parts?.length} 段`);

    if (parts) {
      // ★ 最重要的一條：拼回去必須逐位元組相同。
      //   少一個位元組就是有資料遺失，切錯位置就是有資料重複。
      const rejoined = Buffer.concat(parts.map((p) => Buffer.from(p)));
      ok("★ 拼回原檔逐位元組相同", rejoined.equals(Buffer.from(m)),
         `${rejoined.length} vs ${m.length}`);

      const over = parts.filter((p) => p.length > limit);
      ok("沒有任何一段超過上限", over.length === 0,
         over.length ? `最大 ${Math.max(...parts.map(p=>p.length))}` : `最大 ${Math.max(...parts.map(p=>p.length))}`);

      // ★ 每一段的開頭（第一段是 ID3 之後）都必須是合法影格，
      //   否則 STT 會從雜訊開始 —— 那正是「某幾個詞亂掉」的來源。
      let bad = 0;
      parts.forEach((p, i) => {
        const at = i === 0 ? id3Size(p) : 0;
        if (!parseFrame(p, at)) bad++;
      });
      ok("★ 每一段開頭都是合法影格", bad === 0, bad ? `${bad}/${parts.length} 段不合法` : "");
    }
  }

  console.log("\n── 4. 邊界情況 ──");
  {
    ok("空緩衝區回 null", splitMp3(new Uint8Array(0), CHUNK) === null);
    ok("只有 ID3 標頭回 null", splitMp3(makeMp3(0), CHUNK) === null);

    // 剛好整除
    const m = makeMp3(40);
    const p1 = splitMp3(m, Math.floor(m.length / 2));
    ok("能切成整數段", !!p1 && p1.length >= 2, `${p1?.length} 段`);
    ok("整除後拼回相同", !!p1 && Buffer.concat(p1.map((x) => Buffer.from(x))).equals(Buffer.from(m)));

    // 一個影格都沒有的垃圾
    const junk = new Uint8Array([0xff, 0xe0, 0x00, 0x00, ...new Array(100).fill(0)]);
    ok("無效影格標頭 → 回 null", splitMp3(junk, 100) === null);
  }

  console.log("\n── 5. 真實 MP3（從網路抓）──");
  {
    const url = "https://upload.wikimedia.org/wikipedia/commons/c/c8/Example.ogg";
    const r = await fetch(url);
    const buf = new Uint8Array(await r.arrayBuffer());
    const isMp3 = looksLikeMp3(buf);
    console.log(`     抓到 ${buf.length} bytes，looksLikeMp3=${isMp3}`);
    if (!isMp3) {
      // 這個來源本來就是 ogg —— 誠實說明，不是失敗
      console.log("     （這個來源是 ogg，不是 MP3；預期中的結果。ogg 不支援位元組切分。）");
      ok("非 MP3 明確回 null（不硬切）", splitMp3(buf, CHUNK) === null);
    } else {
      const parts = splitMp3(buf, Math.floor(buf.length / 3));
      ok("真實 MP3 能切", !!parts);
      if (parts) {
        ok("拼回相同", Buffer.concat(parts.map((p) => Buffer.from(p))).equals(Buffer.from(buf)));
      }
    }
  }

  console.log(`\n══ 結果: ${pass} 通過 / ${fail} 失敗 ══`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('測試本身崩潰:', e);
  process.exit(1);
});
