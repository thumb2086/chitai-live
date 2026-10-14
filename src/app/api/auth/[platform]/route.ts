import { NextRequest, NextResponse } from "next/server";
import { oauthRedirectUri } from "@/lib/oauth-origin";

const OAUTH_CONFIG: Record<string, { authUrl: string; clientIdEnv: string; scopes: string; redirectPath: string }> = {
  twitch: {
    authUrl: "https://id.twitch.tv/oauth2/authorize",
    clientIdEnv: "TWITCH_CLIENT_ID",
    scopes: "user:read:email channel:read:subscriptions chat:read",
    redirectPath: "twitch",
  },
  youtube: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    clientIdEnv: "YOUTUBE_CLIENT_ID",
    scopes: "openid email profile https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly",
    redirectPath: "youtube",
  },
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ platform: string }> },
) {
  const { platform } = await params;
  const config = OAUTH_CONFIG[platform];

  if (!config) {
    return new Response(`Unknown platform: ${platform}`, { status: 400 });
  }

  const clientId = process.env[config.clientIdEnv];

  if (!clientId) {
    // No credentials configured — show setup page
    return new Response(
      `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>設定 OAuth</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f5f1ec;color:#111}
.card{background:#fff;border-radius:14px;padding:32px;max-width:480px;border:1px solid #e5e2dd}
h1{font-size:20px;margin:0 0 8px}
p{color:#6b6b6b;font-size:14px;line-height:1.6;margin:0 0 16px}
code{display:block;background:#f4f3f1;padding:12px;border-radius:8px;font-size:13px;margin-bottom:12px;word-break:break-all}
.step{margin-bottom:12px;padding:12px;background:#fafaf8;border-radius:8px;border:1px solid #e5e2dd}
.step strong{display:block;margin-bottom:4px;font-size:14px}
.step span{color:#6b6b6b;font-size:13px}</style></head>
<body><div class="card">
<h1>🔑 設定 ${platform === "twitch" ? "Twitch" : "YouTube"} 連線</h1>
<p>需要先到 ${platform === "twitch" ? "Twitch" : "Google Cloud"} 建立應用程式取得憑證</p>
<div class="step"><strong>步驟 1</strong>
<span>前往 ${platform === "twitch" ? '<a href="https://dev.twitch.tv/console/apps" target="_blank">Twitch Developer Console</a>' : '<a href="https://console.cloud.google.com/apis/credentials" target="_blank">Google Cloud Console</a>'} 建立應用程式</span></div>
<div class="step"><strong>步驟 2</strong>
<span>設定 OAuth Redirect URI 為：<br><code>${oauthRedirectUri(_req)}</code></span></div>
<div class="step"><strong>步驟 3</strong>
<span>複製 Client ID 和 Client Secret，填入專案根目錄的 <code>.env</code> 檔案：</span>
<code>${config.clientIdEnv}=你的_Client_ID</code>
<code>${platform === "twitch" ? "TWITCH_CLIENT_SECRET" : "YOUTUBE_CLIENT_SECRET"}=你的_Secret</code></div>
<div class="step"><strong>步驟 4</strong>
<span>填完後重新啟動開發伺服器，再回來點「連線」</span></div>
</div></body></html>`,
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  // ★ 這裡曾經是 `${_req.nextUrl.origin}/api/auth/callback`，
  //   結果本機開發時送出去的是 localhost:3000，Twitch/Google 直接回
  //   redirect_mismatch。改用設定值（見 lib/oauth-origin 的說明）。
  const redirectUri = oauthRedirectUri(_req);
  const stateVal = Buffer.from(JSON.stringify({ platform: config.redirectPath })).toString("base64");

  const qs = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: config.scopes,
    state: stateVal,
  });

  // Force account selection every time so user can switch accounts
  if (platform === "youtube") qs.set("prompt", "select_account");
  if (platform === "twitch") qs.set("force_verify", "true");

  return NextResponse.redirect(`${config.authUrl}?${qs.toString()}`);
}
