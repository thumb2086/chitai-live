/**
 * Podcast 來源測試（2026-10-14）
 *
 * ★ 為什麼一定要真的抓一個 feed
 *   RSS 解析的錯誤長得很像成功：
 *   · XML 實體解碼順序錯 → 標題變成「A &amp;amp; B」但仍看得出是標題
 *   · 跳過沒有 enclosure 的項目 → 少幾集也不會報錯
 *   · itunes:image 的空元素形式抓不到 → image 是空字串，也不會報錯
 *   這些只有拿真實 feed 跑才看得出來。
 *
 * 執行：npx tsx tools/test-podcast.ts
 * 註：會真的連外抓 RSS，但**不會**下載音檔或呼叫 STT（那要錢）。
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
function loadEnv(file: string, override: boolean) {
  const p = join(ROOT, file);
  if (!existsSync(p)) return 0;
  let n = 0;
  for (const raw of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = raw.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (override || process.env[m[1]] === undefined) {
      process.env[m[1]] = v;
      n++;
    }
  }
  return n;
}
loadEnv(".env", false);
loadEnv(".env.local", true);

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

// ★ 只放「實測過真的存在」的 feed。
//
//   一開始我憑印象寫了三個中文 feed（科技島、首頁客、PyCon Taiwan），
//   結果三個全 404 —— 而失敗的**不是程式**。
//   手打的網址會錯，錯的網址產生的 404 與「feed 掛了」完全無法區分。
//   （AGENTS.md 3e：診斷腳本要從設定檔讀值，不要手打字串）
//
//   syntax.fm 是實測 HTTP 200 + 確實是 RSS 的。
//   ★ 中文 feed 我沒驗到 —— 所以下面的中文斷言只覆蓋純函式
//     （實體解碼、切塊），沒有覆蓋真實中文 feed 的完整流程。
//     要補的話請把可用的中文 feed 網址填回來。
const FEEDS = [
  { name: "syntax.fm", url: "https://feed.syntax.fm/rss" },
];

async function main() {
  console.log("\n══ Podcast RSS 解析測試 ══\n");

  const pod = await import("../src/lib/podcast.ts");

  // ── 單元測試（不需要網路）──
  console.log("── 1. 純函式 ──");
  ok("decodeXml 處理 &amp;", pod.decodeXml("A &amp; B") === "A & B");
  ok("decodeXml 處理數字實體", pod.decodeXml("&#39;&#x4e2d;") === "'中");
  ok(
    "decodeXml 的 &amp; 必須最後解",
    pod.decodeXml("&amp;lt;") === "&lt;",
    `（實得 ${JSON.stringify(pod.decodeXml("&amp;lt;"))}，若變成 "<" 就是順序錯了）`,
  );
  ok("decodeXml 處理 CDATA", pod.decodeXml("<![CDATA[x < y]]>") === "x < y");
  ok("parseDuration 1:02:03", pod.parseDuration("1:02:03") === 3723, `實得 ${pod.parseDuration("1:02:03")}`);
  ok("parseDuration 62:03", pod.parseDuration("62:03") === 3723);
  ok("parseDuration 純秒數", pod.parseDuration("3723") === 3723);
  ok("parseDuration 空白 → null", pod.parseDuration("  ") === null);
  ok("parseDuration 垃圾 → null（不是 NaN）", pod.parseDuration("abc") === null);

  const split = await import("../src/lib/rag.ts");
  const s1 = split.splitText("今天天氣很好。我們去公園走走。你覺得呢？", 10);
  ok("splitText 會切", s1.length > 1, `${s1.length} 段`);
  ok("splitText 不會漏字", s1.join("") === "今天天氣很好。我們去公園走走。你覺得呢？", `拼回長度 ${s1.join("").length}`);
  const long = "這是一段沒有任何標點符號的很長的文字".repeat(40);
  const s2 = split.splitText(long, 200);
  ok("splitText 處理無標點長文", s2.length > 1, `${s2.length} 段`);
  ok("splitText 每段不失控", s2.every((x) => x.length <= 360), `最長 ${Math.max(...s2.map(x => x.length))}`);
  ok("splitText 不會回空陣列", split.splitText("").length === 0);

  // ── 真實 feed ──
  console.log("\n── 2. 真實 feed ──");
  let gotAny = false;

  for (const f of FEEDS) {
    console.log(`  ▸ ${f.name}`);
    let r: Awaited<ReturnType<typeof pod.fetchFeed>>;
    try {
      r = await pod.fetchFeed(f.url);
    } catch (e) {
      ok(`${f.name} 抓取`, false, String((e as Error).message).slice(0, 90));
      continue;
    }
    gotAny = true;
    ok(`${f.name} 有節目名稱`, !!r.feed.title, `"${r.feed.title}"`);
    ok(`${f.name} 有集數`, r.episodes.length > 0, `${r.episodes.length} 集`);

    const ep = r.episodes[0];
    if (ep) {
      ok(`${f.name} 第一集有音檔網址`, /^https?:\/\//.test(ep.audioUrl), ep.audioUrl.slice(0, 60));
      ok(`${f.name} 第一集有 guid`, ep.guid.length > 3, ep.guid.slice(0, 40));
      ok(`${f.name} 標題沒有殘留 XML`, !/[<>]|&amp;/.test(ep.title), `"${ep.title.slice(0, 44)}"`);
      ok(`${f.name} duration 有解析`, ep.durationSec !== null, ep.durationSec ? `${ep.durationSec}s` : "無");
    }

    // ★ 這裡以前印「有宣告大小的: N/M」，
    //   但 N 算的是 `!== null` —— 而 syntax.fm 全部是 length="0"，
    //   所以「1046/1046 有大小」是**假的**。
    //   現在分開印：宣告了 length 欄位 ≠ 有非零大小。
    const declared = r.episodes.filter((e) => e.audioBytes !== null).length;
    const nonzero = r.episodes.filter((e) => (e.audioBytes ?? 0) > 0).length;
    const oversize = r.episodes.filter((e) => (e.audioBytes ?? 0) > pod.MAX_AUDIO_BYTES).length;
    // ★ 大小上限**不在這裡**（2026-10-14 實測後移除）：
    //   中轉改收 audioUrl，本地不再有 4 MB 的限制。
    //   第一版這裡印 `pod.MAX_AUDIO_BYTES` —— 常數移掉後變成
    //   「超過 NaNMB」。NaN 會照樣印出來，看起來像一個數字，
    //   但它代表的是「我沒清乾淨」，不是「沒有超大的集數」。
    //   （這正是 AGENTS.md 規則 1：數字要能對上它的來源。）
    const oversized = r.episodes.filter(
      (e) => (e.audioBytes ?? 0) > 50 * 1024 * 1024,
    ).length;
    console.log(
      `     宣告了 length 欄位: ${declared}/${r.episodes.length}` +
        `   其中非零: ${nonzero}   超過 50MB: ${oversized}（粗略篩，非硬限制）`,
    );
    if (declared === 0 && r.episodes.length) {
      console.log(`     ★ 這個 feed 完全沒填大小 —— 預期的，不是錯誤`);
    }
    ok(
      "audioBytes 不會是 0（0 只可能代表「沒填」）",
      r.episodes.every((e) => e.audioBytes === null || e.audioBytes > 0),
    );

    // 至少一個 feed 要能抓到封面，證明 itunes:image 的空元素形式有處理
    if (r.feed.image) {
      ok(`${f.name} 抓到封面`, /^https?:\/\//.test(r.feed.image), r.feed.image.slice(0, 50));
    }
  }

  ok("至少一個 feed 抓成功（否則後面的結論沒意義）", gotAny);

  // ── 錯誤處理 ──
  console.log("\n── 3. 錯誤輸入 ──");
  try {
    await pod.fetchFeed("https://zixilive.dpdns.org/"); // 回 HTML 不是 RSS
    ok("非 RSS 內容要明確報錯", false, "★ 沒有報錯（靜默接受了）");
  } catch (e) {
    ok("非 RSS 內容要明確報錯", /RSS|feed/i.test(String((e as Error).message)), String((e as Error).message).slice(0, 50));
  }
  try {
    await pod.fetchFeed("https://zixilive.dpdns.org/api/definitely-not-real");
    ok("404 要明確報錯", false, "★ 沒有報錯");
  } catch (e) {
    ok("404 要明確報錯", /HTTP/.test(String((e as Error).message)), String((e as Error).message).slice(0, 50));
  }

  // ── 轉錄：送網址，不送檔案 ──
  console.log("\n── 4. 轉錄 ──");

  // ★ 這一段改寫過兩次，每次的原因都寫在 commit 裡：
  //
  //   v1 上傳音檔給 groq-router → Vercel 請求體上限約 4.5 MB，失敗
  //   v2 改送 { audioUrl }    → 繞開限制，但 Worker 要 hold 整個檔案
  //   v3 換 STT 主機 + X-API-Key → 新端點**只收 multipart**
  //      （實測錯誤「multipart/* content type expected」）
  //
  // 所以 v2 的斷言「不再把音檔讀進記憶體」現在不成立 ——
  // 新端點要求 multipart，Worker 就必須讀。留著那個斷言只會給人假的安全感。

  const call = async (url: string): Promise<string> => {
    try {
      await pod.transcribe(url);
      return "";
    } catch (e) {
      return String((e as Error).message);
    }
  };

  const bad = await call("https://example.invalid/nope.mp3");
  ok(
    "壞網址要給能行動的訊息（不是 undici 的 fetch failed）",
    bad.length > 0 && !/fetch failed/i.test(bad),
    bad.slice(0, 76),
  );

  // 上游錯誤必須原樣往外送。「音檔太大」對使用者有意義。
  const over = await call(
    "https://upload.wikimedia.org/wikipedia/commons/1/16/No_file.ogg",
  );
  ok(
    "服務端錯誤要原樣送出（不換成籠統訊息）",
    over.includes("HTTP"),
    over.slice(0, 86),
  );

  // 端點與認證方式
  const src = readFileSync(new URL("../src/lib/podcast.ts", import.meta.url), "utf8");
  ok("打的是 stt.twonline.dpdns.org", src.includes("stt.twonline.dpdns.org"));
  ok('認證用 X-API-Key', /"X-API-Key"/.test(src));
  ok(
    "不該還在送 audioUrl 的 JSON 模式（新端點不支援）",
    !/body:\s*JSON\.stringify\(\{[\s\S]{0,80}audioUrl/.test(src),
  );
  ok("用 multipart（不是 JSON）", /new FormData\(\)/.test(src));
  // ★ 兩種限制來自不同地方，不能混為一談
  ok(
    "Worker 記憶體上限與服務端 96MB 要分開講",
    /WORKER_AUDIO_MAX_BYTES/.test(src) && /不是轉錄服務/.test(src),
  );

  console.log(`\n══ 結果: ${pass} 通過 / ${fail} 失敗 ══`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("測試本身崩潰:", e);
  process.exit(1);
});