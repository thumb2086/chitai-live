/**
 * OAuth redirect_uri 的 origin 來源 —— 單一真相來源。
 *
 * ★ 為什麼不能用 `req.nextUrl.origin`：
 *   那個值是「當下這次請求是從哪個網址進來的」。本機開發時就是
 *   http://localhost:3000，於是送給 Twitch/Google 的 redirect_uri 也是
 *   localhost —— 對方立刻回 `redirect_mismatch`。
 *   更麻煩的是：正式站與本機會送出**不同的** redirect_uri，
 *   而 token 交換時兩邊必須完全一致，少一個字元就 400。
 *
 *   所以這裡優先用設定值 PUBLIC_BASE_URL（wrangler.jsonc 的 vars 已經是
 *   https://zixilive.dpdns.org），只有本機開發且沒設定時才退回 origin。
 *
 *   ★ 授權（[platform]/route.ts）與換 token（callback/route.ts）必須呼叫
 *     同一個函式 —— 這是 OAuth 最常見的自傷：兩邊各自組字串，串接參數不同。
 */
export function oauthOrigin(req: { nextUrl: URL }): string {
  // 結尾斜線去掉，避免變成 `https://x//api/auth/callback`
  return (process.env.PUBLIC_BASE_URL || req.nextUrl.origin).replace(/\/+$/, "");
}

/** 完整的 callback 網址。Twitch / Google 註冊的就是這個字串。 */
export function oauthRedirectUri(req: { nextUrl: URL }): string {
  return `${oauthOrigin(req)}/api/auth/callback`;
}
