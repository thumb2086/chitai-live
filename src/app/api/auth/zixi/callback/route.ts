import { NextRequest, NextResponse } from "next/server";
// 2026-10-06：從 Prisma 改成 Neon HTTP（Workers 相容）。
//
// ⚠️ 這條路由是**跨專案 ZXC 付款的 OAuth 入口** ——
//    zixi-earth 是 provider，這裡是 client 的 callback。
//    所以在 Workers 上它壞掉 = 付款的 OAuth 鏈路斷在最後一步。
//
//    而症狀會是：使用者按下「連結 ZIXI」→ 被導回
//    /dashboard/zixi?error=callback_failed，而錯誤是 WASM 訊息。
import { getSessionId } from "@/lib/getUser";
import { getSessionUserId, saveZixiToken } from "@/lib/auth-http";
import { zixiApiBase } from "@/lib/zixi-endpoints";

// 2026-10-06：原本是 `|| "https://zixi-casino-api.onrender.com/api/v1"`。
// 那台 Render 已經逾時（實測），而 .env.example 從來沒宣告 ZIXI_API_URL ——
// 所以**每次部署都靜默使用死掉的 host**。
// 現在走 lib/zixi-endpoints.ts 單一來源，預設指向實測活著的 workers.dev。
// 詳見該檔案檔頭：問題不是網址舊了，是「舊網址是 fallback」。
const ZIXI_API_URL = zixiApiBase();
const ZIXI_CLIENT_ID = process.env.ZIXI_CLIENT_ID || "livestream-dashboard";
const ZIXI_CLIENT_SECRET = process.env.ZIXI_CLIENT_SECRET || "";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const errorParam = searchParams.get("error");
  const stateParam = searchParams.get("state");

  if (errorParam) {
    return NextResponse.redirect(new URL("/dashboard/zixi?error=" + errorParam, req.url));
  }

  if (!code) {
    return NextResponse.redirect(new URL("/dashboard/zixi?error=no_code", req.url));
  }

  const sessionId = getSessionId(req);
  if (!sessionId) {
    return NextResponse.redirect(new URL("/dashboard/zixi?error=not_logged_in", req.url));
  }

  const userId = await getSessionUserId(sessionId);
  if (!userId) {
    return NextResponse.redirect(new URL("/dashboard/zixi?error=session_not_found", req.url));
  }

  if (!ZIXI_CLIENT_SECRET) {
    return NextResponse.redirect(new URL("/dashboard/zixi?error=missing_client_secret", req.url));
  }

  try {
    const redirectUri = `${req.nextUrl.origin}/api/auth/zixi/callback`;
    const tokenRes = await fetch(`${ZIXI_API_URL}/api/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        client_id: ZIXI_CLIENT_ID,
        client_secret: ZIXI_CLIENT_SECRET,
        redirect_uri: redirectUri,
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      console.error("ZIXI token exchange failed:", tokenData);
      return NextResponse.redirect(new URL("/dashboard/zixi?error=token_exchange_failed", req.url));
    }

    // ⚠️ expiresAt 傳 ISO 字串，不是 Date 物件。
//    Prisma 傳 Date、HTTP 查詢傳字串，而 Neon 的 timestamptz 接受 ISO 8601。
//    這裡明確用 toISOString() 讓型別與儲存格式一致 ——
//    若把 Date 物件直接 bind 進去，driver 收到的是非字串，行為不確定。
const expiresAtIso = new Date(
      Date.now() + (tokenData.expires_in || 365 * 24 * 3600) * 1000,
    ).toISOString();
    await saveZixiToken(userId, tokenData.access_token, expiresAtIso);

    return NextResponse.redirect(new URL("/dashboard/zixi?success=connected", req.url));
  } catch (e) {
    console.error("ZIXI OAuth callback error:", e);
    return NextResponse.redirect(new URL("/dashboard/zixi?error=callback_failed", req.url));
  }
}
