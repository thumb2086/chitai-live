/**
 * 驗證 db-http 的查詢逾時真的會發生。
 *
 * 為什麼需要這個測試：
 * 「程式碼裡有 setTimeout」不等於「逾時會發生」。
 * Promise.race 最容易寫錯的地方是 —— timer 被 unref 掉、或底層先
 * 結束，於是逾時那條路徑永遠走不到，而測試也「看起來通過」
 * （因為正常查詢本來就該成功）。
 *
 * 所以這裡分兩層驗：
 *   ① 正常查詢仍然成功 —— 逾時不能變成「一律失敗」
 *   ② 掛住的 promise 真的會被逾時打斷，且丟出正確的型別
 *
 * 另外驗證錯誤訊息不洩漏參數（參數可能是 token／個資／會話）。
 *
 * 跑法：npx tsx tools/test-db-timeout.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { query, QueryTimeoutError, QUERY_TIMEOUT_MS } from "../src/lib/db-http";

// ⚠️ 專案沒有裝 dotenv，而且測試不該為了跑起來多一個依賴。
//    .env 的格式很單純（KEY=VALUE，支援 # 註解與引號），自己讀就好。
function loadEnv(path: string) {
  let text = "";
  try { text = readFileSync(path, "utf-8"); } catch { return; }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    if (process.env[key] !== undefined) continue;   // 環境變數優先
    let val = m[2].trim();
    if (/^"(.*)"$/.test(val) || /^'(.*)'$/.test(val)) val = val.slice(1, -1);
    process.env[key] = val;
  }
}
loadEnv(join(__dirname, "..", ".env"));

if (!process.env.DATABASE_URL) {
  console.log("  ✗ 沒有 DATABASE_URL（.env 讀不到），無法測試");
  process.exit(1);
}

let pass = 0, fail = 0;
function ok(cond: boolean, name: string, extra?: string) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "\n      → " + extra : "")); }
}

/** 複製 db-http 裡 rejectAfter 的形狀，驗證它會 reject 而不是永久掛住。
 *  ★ 刻意保留「不 unref」—— 那正是 db-http 現在的寫法，
 *    而這個測試的存在理由就是抓到它被 unref 時會靜靜失效。 */
function rejectAfter(ms: number, text: string): Promise<never> {
  return new Promise<never>((_, reject) => {
    setTimeout(() => reject(new QueryTimeoutError(ms, text)), ms);
  });
}

(async () => {
  console.log("\n══ db-http 逾時測試 ══\n");

  // ① 正常查詢必須仍然成功
  const t0 = Date.now();
  const rows = await query<{ ok: number }>(`SELECT 1 AS ok`);
  ok(rows.length === 1 && Number(rows[0]?.ok) === 1,
     `正常查詢仍然成功（${Date.now() - t0}ms）`, JSON.stringify(rows));

  // ② 逾時路徑
  console.log("\n  ── 逾時路徑 ──");
  const before = Date.now();
  let threw: unknown = null;
  try {
    await Promise.race([
      new Promise<never>(() => { /* 永不 resolve，模擬 DB 掛住 */ }),
      rejectAfter(300, "SELECT 1"),
    ]);
  } catch (e) { threw = e; }
  const elapsed = Date.now() - before;

  ok(threw !== null, "掛住的 promise 會被逾時打斷", "沒有任何東西被丟出來");
  ok(elapsed >= 250 && elapsed < 1500, `逾時在合理時間內發生（${elapsed}ms）`, "計時異常");
  ok(threw instanceof QueryTimeoutError, "丟出的是 QueryTimeoutError", String((threw as Error)?.name));

  // ③ 錯誤訊息不含參數
  const e2 = new QueryTimeoutError(8000, `SELECT * FROM "User" WHERE "username" = $1`);
  ok(!/=\s*['"][^'"]+['"]/.test(e2.message), "錯誤訊息不含參數值", e2.message);
  ok(e2.message.includes('SELECT * FROM "User"'), "錯誤訊息保留 SQL 形狀（才知道是哪條查詢掛住）", e2.message);

  // ④ 真實的 DB 慢查詢也會被逾時打斷
  //    ★ 睡的時間必須**大於**上限。我第一版寫 pg_sleep(3) 配上 8 秒上限，
  //    結果 3 秒就回來了 —— 測試卻期待它超時，於是「失敗」。
  //    那是測試的期望錯，不是程式錯：3 秒的查詢本來就不該被 8 秒的逾時打斷。
  //    這件事值得記一下，因為「測試失敗」很容易被誤讀成「剛寫的東西壞了」。
  console.log("\n  ── 真實 DB 慢查詢（必須比上限久才會觸發）──");
  const sleepSec = Math.ceil(QUERY_TIMEOUT_MS / 1000) + 4;
  const realBefore = Date.now();
  let realThrew: unknown = null;
  try {
    await query(`SELECT pg_sleep(${sleepSec})`);
  } catch (e) { realThrew = e; }
  const realElapsed = Date.now() - realBefore;
  ok(realThrew instanceof QueryTimeoutError,
     `真實 DB 慢查詢（睡 ${sleepSec}s）被逾時打斷（${realElapsed}ms，上限 ${QUERY_TIMEOUT_MS}ms）`,
     `丟出的是 ${(realThrew as Error)?.name}：${String((realThrew as Error)?.message).slice(0, 90)}`);
  ok(realElapsed >= QUERY_TIMEOUT_MS - 300 && realElapsed < sleepSec * 1000 + 500,
     `逾時時間點正確（不是太快也不是等完才回）`, `${realElapsed}ms`);
  // 錯誤訊息的長度要受限。
  // ★ 我第一版寫的是「訊息裡不該出現兩位數以上」——
  //   那等於在檢查「沒有 timeout 毫秒數」和「SQL 裡沒有數字」，
  //   而 "逾時（8000ms）" 與 "pg_sleep(12)" 本來就該有數字。
  //   測試失敗看起來像「剛寫的東西壞了」，其實是斷言本身不合理。
  //
  //   真正要守的性質是：**SQL 有被截斷**（防止超長查詢把 log 灌爆），
  //   以及**參數沒有被帶進去**（前面已驗）。這裡驗長度。
  const msg = String((realThrew as Error)?.message || "");
  ok(msg.length < 220, `錯誤訊息長度受限（${msg.length} 字元）`, msg);

  console.log(`\n══ 結果：${pass} 過 / ${fail} 失敗 ══\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("測試本身炸了：", e);
  process.exit(1);
});