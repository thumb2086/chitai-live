// zixi-endpoints.ts — ZIXI 服務端點的單一來源
//
// ══════════════════════════════════════════════════════════
// 為什麼要有這個檔案
// ══════════════════════════════════════════════════════════
//
// 2026-10-06 盤點：livestream-dashboard 裡有 **5 個檔案**寫著
// zixi-casino 的舊端點：
//
//   auth/zixi/callback/route.ts    ZIXI_API_URL  || onrender
//   auth/zixi/route.ts             ZIXI_OAUTH_URL || zixi-casino.vercel.app
//   v1/zixi/proxy/route.ts         ZIXI_API       || onrender
//   v1/zixi-donations/route.ts     **寫死**，連 env 都不能改
//   dashboard/zixi/page.tsx        href 寫死 vercel
//   donate/[username]/DonateForm   href 寫死 vercel
//
// 而 onrender 那台（zixi-casino-api.onrender.com）**已經逾時** —— 實測。
//
// ── 真正的問題不是「網址舊了」，是「舊網址是 fallback」──
//
// `process.env.ZIXI_API_URL || "https://dead.host"` 的形狀是：
//   環境變數沒設 → 靜默使用死掉的 host → 請求逾時 → 被 catch 吞掉
//   → 使用者看到「沒有新交易」→ 沒有任何地方顯示「我連不到伺服器」
//
// **設定錯誤被轉換成了功能正常但結果為空。**
// 而「沒有新交易」和「我查不到」在使用者眼裡完全一樣。
//
// check-tx 那個檔案已經修過一次（未提交），而它修對的不只是網址 ——
// 它加了 explorerError 回報，讓「查無」與「查不到」可以區分。
// 這個檔案是同樣思路的延伸。
//
// ══════════════════════════════════════════════════════════
// 為什麼用 workers.dev 而不是自訂網域
// ══════════════════════════════════════════════════════════
//
// 目前 zixi-earth 的自訂網域是 twonline.dpdns.org，而：
//   · 那個名稱來自 earthonline（合併前的另一半），對現在的產品是誤導
//   · 使用者決定要註冊兩個**分開的**網域，所以 zixi-earth 會換網域
//   · 換網域時只有這 5 個檔案需要改（因為它們都 import 這個檔案）
//
// 所以這裡用 workers.dev 當預設值：**它不會變**。
// workers.dev 名稱在 wrangler 設定的 name 改掉時才會變，而那需要明確的
// 遷移決定 —— 不像自訂網域那樣會因為換 DNS 而失效。
//
// 等自訂網域就緒後，只要設 ZIXI_API_URL / ZIXI_OAUTH_URL 即可，
// 這 5 個檔案不需要再動。

/** zixi-earth 的 Workers 網址（實測 HTTP 200）。 */
export const ZIXI_EARTH_DEFAULT = "https://zixiearth.dpdns.org";

/** 走 /api/v1/* 風格路徑的端點（舊 zixi-casino 的 API 形狀）。 */
export function zixiApiBase(): string {
  return (process.env.ZIXI_API_URL || ZIXI_EARTH_DEFAULT).replace(/\/+$/, "");
}

/**
 * OAuth 授權頁所在的 origin。
 *
 * 與 zixiApiBase() 分開是因為兩者語意不同：
 *   · ZIXI_API_URL  → API 根（舊的帶 /api/v1 尾綴）
 *   · ZIXI_OAUTH_URL → 授權頁 origin（舊的是前端網域）
 *
 * 合併成一個常數會讓「把 API 指到 workers.dev、授權頁指到自訂網域」
 * 這種正常設定變成不可能。
 */
export function zixiOAuthOrigin(): string {
  const v = (process.env.ZIXI_OAUTH_URL || ZIXI_EARTH_DEFAULT).replace(/\/+$/, "");
  return v;
}

/**
 * 設定是否完整 —— 給啟動時的診斷用。
 *
 * 回傳「哪一個環境變數沒設」而不是只有 boolean，
 * 因後者只會得到一個「false」而沒有人知道該設什麼。
 */
export function zixiConfigReport(): { ok: boolean; missing: string[]; apiBase: string; oauthOrigin: string } {
  const missing: string[] = [];
  if (!process.env.ZIXI_API_URL) missing.push("ZIXI_API_URL");
  if (!process.env.ZIXI_OAUTH_URL) missing.push("ZIXI_OAUTH_URL");
  if (!process.env.ZIXI_CLIENT_ID) missing.push("ZIXI_CLIENT_ID");
  if (!process.env.ZIXI_CLIENT_SECRET) missing.push("ZIXI_CLIENT_SECRET");
  return {
    ok: missing.length === 0,
    missing,
    apiBase: zixiApiBase(),
    oauthOrigin: zixiOAuthOrigin(),
  };
}