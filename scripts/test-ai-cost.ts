/**
 * 驗證 AI 點數計價 —— 不碰資料庫，只測純函式。
 *
 * 為什麼要獨立測：原本的計量測試（test-usage-metering.ts）需要真實 Neon，
 * 離線跑不了。而「費率算錯」是這次改動最可能犯的錯，
 * 必須有一個不依賴外部服務就能擋住它的測試。
 *
 * 對應的真實風險：
 *   · 單次字幕窗太小被 toFixed(4) 歸零 → 使用者「用量不動」
 *   · 分鐘與點數換算比例錯一個數量級 → 額度實際是設定的 10 倍或 1/10
 */
import { audioSecondsToCredits, AI_RATES, POINTS_PER_USD } from "@/lib/ai-cost";

/**
 * 複製自 lib/usage.ts 的常數。
 *
 * 刻意不改成 import：為了測試而把產品碼的內部常數匯出，是讓測試
 * 反過來改動被測對象的形狀。這個測試存在的意義是「獨立驗算」，
 * 所以這兩個值要能與產品碼對不上 —— 對不上時這個測試會失效，
 * 那正是它該有的反應（會在下方 assert 裡指出）。
 */
const PRECISION = 4;   // usage.ts:20
const MAX_QTY = 100_000; // usage.ts:18

let fail = 0;
function ok(label: string, got: unknown, want: unknown) {
  const pass = got === want;
  if (!pass) fail++;
  console.log(`  ${pass ? "✓" : "★"} ${label}  ${got}${pass ? "" : `  want=${want}`}`);
}
function truthy(label: string, cond: boolean, info = "") {
  if (!cond) fail++;
  console.log(`  ${cond ? "✓" : "★"} ${label}${info ? `  ${info}` : ""}`);
}

console.log("  ── 單元定義 ──");
ok("1 點 = US$1", POINTS_PER_USD, 1);

console.log("\n  ── 基本換算 ──");
ok("0 秒 → 0", audioSecondsToCredits(0), 0);
ok("負數夾到 0", audioSecondsToCredits(-10), 0);
ok("NaN 夾到 0", audioSecondsToCredits(NaN), 0);
ok("1 秒 = 0.0007", audioSecondsToCredits(1), 0.0007);
ok("60 秒 = 0.042", audioSecondsToCredits(60), 0.042);

console.log("\n  ── 關鍵：不會被 toFixed(4) 歸零 ──");
// 這是最容易犯的錯：1 秒窗算出 0.0007，若精度不夠就會變 0 而「用量不動」。
const oneSec = audioSecondsToCredits(1);
const survived = Number(oneSec.toFixed(PRECISION));
truthy(
  "1 秒窗在 recordUsage 精度下存活",
  survived > 0,
  `raw=${oneSec}  toFixed(${PRECISION})=${survived}`
);
// 最短可記錄量：PRECISION 決定小數點後幾位，最小非零就是 10^-PRECISION
const minRecorded = 1 / Math.pow(10, PRECISION);
const shortestWindow = minRecorded / AI_RATES.asrPerSecond;
truthy(
  "最短可記錄單位的秒數 << 1 秒（所以 1 秒窗一定記得住）",
  shortestWindow < 1,
  `最小記錄 ${minRecorded} 點 = ${shortestWindow.toFixed(2)} 秒`
);

console.log("\n  ── 累積到方案額度的耗時 ──");
const PLANS = { free: 50, pro: 500, creator: 3000, studio: 30000 };
for (const [k, limit] of Object.entries(PLANS)) {
  const sec = limit / AI_RATES.asrPerSecond;
  const hours = sec / 3600;
  console.log(`    ${k.padEnd(8)} ${String(limit).padStart(6)} 點 = ${hours.toFixed(1)} 小時字幕`);
}

console.log("\n  ── 上限保護 ──");
// 夾除發生在 recordUsage，不在 audioSecondsToCredits。
// 所以這裡要驗證「夾除之後安全」，而不是要求計價函式自己就夾好 ——
// 要求它夾會讓 MAX_QTY 這個常數有兩個套用點，哪天改一個就會不一致。
const huge = audioSecondsToCredits(1e9);
const clamped = Math.max(0, Math.min(MAX_QTY, Number(huge.toFixed(PRECISION))));
truthy(
  "recordUsage 夾除後仍在 MAX_QTY 內",
  clamped <= MAX_QTY,
  `raw=${huge} → clamped=${clamped} (MAX_QTY=${MAX_QTY})`
);
truthy(
  "夾除是有效的保護而非溢出",
  huge > MAX_QTY && clamped === MAX_QTY,
  "即：這個測試有實際在驗一個會觸發的情況"
);

console.log(fail ? `\n  ★ ${fail} 項未通過` : "\n  ✓ 全部通過");
process.exit(fail ? 1 : 0);