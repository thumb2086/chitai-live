import { NextRequest, NextResponse } from "next/server";
import { zixiOAuthOrigin } from "@/lib/zixi-endpoints";

// 2026-10-06：原本 fallback 是 `https://zixi-casino.vercel.app` ——
// 那是 zixi-casino（已拋棄）的**前端**網域，不是授權頁的服務端。
// 而 OAuth 授權頁在 zixi-earth 的 Worker 上（/api/oauth/authorize）。
// 單一來源見 lib/zixi-endpoints.ts。
const ZIXI_OAUTH_URL = zixiOAuthOrigin();
const ZIXI_CLIENT_ID = process.env.ZIXI_CLIENT_ID || "livestream-dashboard";

export async function GET(req: NextRequest) {
  const redirectUri = `${req.nextUrl.origin}/api/auth/zixi/callback`;

  const qs = new URLSearchParams({
    client_id: ZIXI_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "profile",
  });

  // ★ ★ 這裡原本是 `/oauth/consent?${qs}`，**兩個地方都錯**（2026-10-14 修正）：
  //
  //   ① 路徑：zixi-earth 認得的是 `#/oauth`，不是 `/oauth/consent`
  //   ② 參數位置：它的 OAuthConsentPage 讀 `location.hash`，
  //      參數必須在 **hash 裡面**，不是 query string
  //
  // zixi-earth 是純 hash 路由（client-react/src/App.jsx）：
  //     const onHash = () => { setPage(location.hash.slice(1) || '/'); };
  //
  // 送 `/oauth/consent?client_id=...` 時 hash 是空的 → page = '/' → 賭場首頁。
  // 症狀就是「點授權跳過去就停在賭場、回不來」——
  // 使用者看到一個沒有在授權的頁面，以為流程壞了。
  //
  // ★ 這不是「同意頁沒實作」。zixi-earth 的 OAuthConsentPage 一直都存在，
  //   而且連「未登入」都有處理（info.needsLogin 分支）。
  //   我一開始以為缺頁面，還寫了一個新的 consent 元件 —— 那是多餘的，
  //   而且寫進了 client/（不是建置用的 client-react/），等於什麼都沒修到。
  //   正確的修法就是這一行。
  return NextResponse.redirect(`${ZIXI_OAUTH_URL}/#/oauth?${qs.toString()}`);
}
