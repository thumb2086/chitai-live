/**
 * transcribe 請求體大小上限的測試。
 *
 * 為什麼要有這支
 * ══════════════════════════════════════════════════════════
 *
 * `POST /api/v1/captions/transcribe` 原本是：
 *
 *     const buf = Buffer.from(await req.arrayBuffer());
 *
 * 兩個問題：
 *   ① **沒有上限** —— 單一請求可以塞任意大的 body。
 *      Next 不會擋，`arrayBuffer()` 會老實把整個 body 讀進記憶體。
 *   ② **在驗證身份之前讀** —— 沒���任何憑證的人就能佔用記憶體。
 *
 * 而這條路徑是字幕的熱路徑：客戶端每 STEP_MS 就送一個重疊視窗，
 * 一次直播會打幾百上千次。
 *
 * ── 修法與它的兩道閘 ────────────────────────────────────
 *
 *   1. Content-Length 快速拒絕（不讀 body，O(1)）
 *   2. 串流讀取 + 累積計數，超標立刻 abort（不等讀完）
 *   3. 讀完後再核對實際長度（防偽造／省略 header）
 *
 * ⚠️ 為什麼第 2 道不能用 `arrayBuffer()` 然後才檢查大小：
 *    那樣整個 body 已經在記憶體裡了，檢查只是事後通知。
 *    必須在**讀的過程中**就停手。
 *
 * Usage: node_modules\.bin\jiti.cmd scripts\test-transcribe-body-cap.ts
 */
import "./_boot";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
function loadEnv(file: string, override: boolean) {
  const p = join(ROOT, file);
  if (!existsSync(p)) return;
  for (const raw of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = raw.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (override || process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadEnv(".env", false);
loadEnv(".env.local", true);

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}${extra ? "  " + extra : ""}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${extra ? "  " + extra : ""}`);
  }
}

const MB = 1024 * 1024;
const CAP = 8 * MB;

// ⚠️ 這支測試**只走會在網路之前就決定結果的路徑**。
//
// 原始版本用「有聲音訊」當 payload，結果通過大小閘之後就一路跑到
// transcribePcm → 真的打去 Groq（假 key）→ 重試 → 整支測試卡死。
//
// 靜音（全 0）的 PCM 會被 pcmRms 的靜音門擋下，直接回 {skipped:true}。
// 那正好證明「已經通過大小閘、而且沒有多花任何一毛錢」——
// 而這條路徑不碰網路、不碰資料庫。
function silentPcm(bytes: number): Buffer {
  return Buffer.alloc(bytes);
}

async function main() {
  console.log("\ntranscribe 請求體大小上限\n");

  // 進到本體之前必須先過 503 閘，所以確保 provider 是「已設定」的狀態。
  process.env.GROQ_API_KEY ||= "test-key-not-used";
  const saved = process.env.GROQ_API_KEY;

  const { POST } = await import("@/app/api/v1/captions/transcribe/route");
  const url = "http://localhost/api/v1/captions/transcribe";

  // ── ① Content-Length 明顯超標 → 不該讀 body 就拒絕 ────────
  {
    // 假的 stream：只要有人拉資料就記一筆，用來證明「根本沒讀」。
    let pulled = 0;
    const spy = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        c.enqueue(new Uint8Array(MB));
      },
    });
    const req = new Request(url, {
      method: "POST",
      body: spy,
      duplex: "half",
      headers: { "content-length": String(CAP + 1) },
    } as any);

    // ⚠️ 對照組：先證明這樁測試**真的**帶著一個超標的 Content-Length。
    //    否則「快速拒絕」可能只是因為 header 根本沒設上去 ——
    //    而那會讓這條測試在壞掉的方式下繼續變綠。
    ok("對照組：這個 Request 確實帶著超標 Content-Length", req.headers.get("content-length") === String(CAP + 1),
      `content-length=${req.headers.get("content-length")}`);

    // ⚠️ ReadableStream 預設就有 highWaterMark=1 的內部佇列，
    //    所以**建立時**就會 eager 地呼叫 pull() 一次，跟有沒有人讀無關。
    //    所以不能斷言 pulled === 0 —— 那在還沒呼叫 POST 時就不成立了。
    //
    //    正確的量法是「POST 期間有沒有再拉」：先把 eager 那次兌現，
    //    記下基準值，再看有沒有增加。
    await new Promise((r) => setTimeout(r, 10));
    const beforePull = pulled;

    const res = await POST(req);
    const body: any = await res.json().catch(() => null);

    ok("超標的 Content-Length 被拒絕（413）", res.status === 413, `status=${res.status}`);
    ok(
      "快速拒絕期間完全沒有再讀 body",
      pulled === beforePull,
      `POST 前已拉 ${beforePull} 次（串流建立時的 eager pull），POST 後 ${pulled} 次`,
    );
    ok("413 有中文錯誤訊息", typeof body?.error === "string" && /[一-鿿]/.test(body.error), body?.error ?? "(無)");
    ok("413 訊息帶出上限數字", String(body?.error ?? "").includes("8"), String(body?.error ?? "").slice(0, 60));
  }

  // ── ② 沒有 Content-Length（或說謊）→ 串流讀取時必須中途停手 ──
  {
    let produced = 0;
    const CHUNK = MB;
    const spy = new ReadableStream<Uint8Array>({
      pull(c) {
        produced++;
        c.enqueue(new Uint8Array(CHUNK));
        // 給個上限避免測試自己無限跑
        if (produced > 40) c.close();
      },
    });
    const req = new Request(url, { method: "POST", body: spy, duplex: "half" } as any);

    const res = await POST(req);
    const body: any = await res.json().catch(() => null);

    ok("偽造/省略 Content-Length 的超標 body 仍被拒絕（413）", res.status === 413, `status=${res.status}`);
    ok(
      "串流讀取中途停手，沒有把整個 body 讀完",
      produced * CHUNK < 40 * CHUNK,
      `實際產生 ${produced} MB（上限 8MB）`,
    );
    ok("仍然回中文錯誤訊息", typeof body?.error === "string" && /[一-鿿]/.test(body.error), body?.error ?? "(無)");
  }

  // ── ③ 剛好在上限之內的正常請求必須照樣通過 ────────────────
  {
    // 正常直播視窗：WINDOW_MS=2400 × 16000Hz × Int16 = 76,800 bytes。
    const normal = silentPcm((2400 * 16000 * 2) / 1000);
    const req = new Request(url, { method: "POST", body: normal });
    const res = await POST(req);
    const body: any = await res.json().catch(() => null);

    ok(`正常視窗大小（${normal.length} bytes）不會被 413 擋掉`, res.status !== 413, `status=${res.status}`);
    ok(
      "正常大小通過大小閘、並在靜音門被擋（證明沒有多花錢）",
      res.status === 200 && body?.skipped === true,
      `status=${res.status} body=${JSON.stringify(body)?.slice(0, 60)}`,
    );
    ok(
      "正常大小距離 8MB 上限有大量餘裕",
      normal.length * 100 < CAP,
      `${normal.length} bytes，約為上限的 ${((normal.length / CAP) * 100).toFixed(1)}%`,
    );
  }

  // ── ④ 邊界：剛好等於上限 vs 超過一個位元組 ────────────────
  {
    const atCap = silentPcm(CAP);
    const resA = await POST(new Request(url, { method: "POST", body: atCap }));
    ok("剛好等於上限（8MB）不被擋", resA.status !== 413, `status=${resA.status}`);

    const overBy1 = silentPcm(CAP + 1);
    const resB = await POST(new Request(url, { method: "POST", body: overBy1 }));
    ok("超過上限 1 byte 被擋（413）", resB.status === 413, `status=${resB.status}`);
  }

  // ── ⑤ 過小的 body 仍然是 400「音訊片段太短」，不是 413 ────
  {
    const tiny = silentPcm(1024);
    const res = await POST(new Request(url, { method: "POST", body: tiny }));
    const body: any = await res.json().catch(() => null);
    ok("過小 body 回 400 而不是 413", res.status === 400, `status=${res.status}`);
    ok("過小 body 的訊息沒被換成大小錯誤", !String(body?.error ?? "").includes("8MB"), String(body?.error));
  }

  if (saved === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = saved;

  console.log(`\n結果: ${pass} 通過 / ${fail} 失敗`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("測試本身出錯:", e);
  process.exitCode = 1;
});
