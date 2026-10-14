import { NextRequest, NextResponse } from "next/server";
import { oauthRedirectUri } from "@/lib/oauth-origin";
// 2026-10-06：從 Prisma 改成 Neon HTTP（Workers 相容）。
//
// ⚠️ 這是**登入入口** —— 沒有它，沒有人能進來。
//   而症狀會被 OAuth 的 try/catch 轉成 callback_failed，
//   看起來像「憑證有問題」而不是「Prisma 沒法在 Workers 上跑」。
import {
  userBySessionId, userByEmail, userByChannel, userByPlatformChannelName,
  createUserWithDefaults, updateUserProfile, upsertPlatformConnection, createSession,
} from "@/lib/account-http";

const CLIENT_CONFIG: Record<string, { tokenUrl: string; idEnv: string; secretEnv: string }> = {
  twitch: { tokenUrl: "https://id.twitch.tv/oauth2/token", idEnv: "TWITCH_CLIENT_ID", secretEnv: "TWITCH_CLIENT_SECRET" },
  youtube: { tokenUrl: "https://oauth2.googleapis.com/token", idEnv: "YOUTUBE_CLIENT_ID", secretEnv: "YOUTUBE_CLIENT_SECRET" },
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const errorParam = searchParams.get("error");
  const stateParam = searchParams.get("state");

  let platform = "twitch";
  if (stateParam) {
    try {
      const decoded = JSON.parse(Buffer.from(stateParam, "base64").toString());
      platform = decoded.platform || "twitch";
    } catch { /* ignore */ }
  }

  if (errorParam) return NextResponse.redirect(new URL(`/dashboard/connections?error=${errorParam}`, req.url));
  if (!code) return NextResponse.redirect(new URL(`/dashboard/connections?error=no_code&platform=${platform}`, req.url));

  const config = CLIENT_CONFIG[platform];
  if (!config) return NextResponse.redirect(new URL("/dashboard/connections?error=unknown_platform", req.url));

  const clientId = process.env[config.idEnv];
  const clientSecret = process.env[config.secretEnv];
  if (!clientId || !clientSecret) return NextResponse.redirect(new URL("/dashboard/connections?error=missing_credentials", req.url));

  // Exchange code for tokens
  let tokens: any;
  try {
    // ★ 必須與 [platform]/route.ts 送出的字串**完全一致** —— OAuth 的
    //   token 交換會逐一比對，差一個字元就 redirect_mismatch。
    const redirectUri = oauthRedirectUri(req);
    const tokenRes = await fetch(config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, grant_type: "authorization_code", redirect_uri: redirectUri }),
    });
    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      console.error(`Token exchange failed for ${platform}:`, text);
      return NextResponse.redirect(new URL("/dashboard/connections?error=token_exchange_failed", req.url));
    }
    tokens = await tokenRes.json();
  } catch (e) {
    console.error(`Token exchange exception for ${platform}:`, e);
    return NextResponse.redirect(new URL("/dashboard/connections?error=token_exchange_failed", req.url));
  }

  // Fetch channel/user info (best effort)
  let channelId: string | null = null, channelName: string | null = null, channelHandle: string | null = null, channelAvatar: string | null = null, email: string | null = null;

  try {
    if (platform === "twitch") {
      const res = await fetch("https://api.twitch.tv/helix/users", {
        headers: { Authorization: `Bearer ${tokens.access_token}`, "Client-Id": clientId },
      });
      if (res.ok) { const d: any = await res.json(); if (d.data?.[0]) { channelId = d.data[0].id; channelName = d.data[0].display_name; channelHandle = d.data[0].login; channelAvatar = d.data[0].profile_image_url; email = d.data[0].email; } }
    } else if (platform === "youtube") {
      // 1. Try YouTube channel API (gives the CHANNEL name + handle)
      const chRes = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (chRes.ok) {
        const chData: any = await chRes.json();
        if (chData.items?.[0]) { const ch = chData.items[0]; channelId = ch.id; channelName = ch.snippet.title; channelHandle = ch.snippet.customUrl?.replace(/^@/, ""); channelAvatar = ch.snippet.thumbnails?.default?.url; }
      } else {
        const chErr = await chRes.text();
        console.error(`YouTube channel API failed (${chRes.status}):`, chErr);
      }
      // 2. Get email + avatar from userinfo (always works with Google OAuth)
      const infoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (infoRes.ok) { const info: any = await infoRes.json(); email = info.email; if (!channelAvatar) channelAvatar = info.picture; }
      // 3. If channel API failed, check scopes
      if (!channelName) {
        try {
          const tokRes = await fetch(`https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${tokens.access_token}`);
          if (tokRes.ok) console.log("Token scopes:", (await tokRes.json()).scope);
        } catch { /* ignore */ }
      }
    }
  } catch (e) { console.error(`Failed to fetch ${platform} info:`, e); }

  // Determine user: check existing session → email match → channel match → create new
  let user: any = null;

  // 1. Check existing session cookie
  const cookie = req.headers.get("cookie") || "";
  const sessionMatch = cookie.match(/sf_session=([^;]+)/);
  if (sessionMatch) {
    user = await userBySessionId(sessionMatch[1]);
  }

  // 2. Try by email (most reliable cross-platform)
  if (!user && email) {
    user = await userByEmail(email);
  }

  // 3. Try by channel ID
  if (!user && channelId) {
    user = await userByChannel(channelId, platform);
  }

  // 4. If this user already has a connection for this platform, DON'T create new user
  if (!user && channelName) {
    // ⚠️ 這裡**必須**檢查 channelName。
    //
    //    原 Prisma 版本傳的是 `channelName`（可能為 null），
    //    而 findFirst({ where: { channelName: null } }) 會撈到
    //    「channelName 是 null 的第一筆連線」—— 也就是**別人**的帳號。
    //
    //    那是個身分冒用漏洞：任何一個沒有 channel name 的平台登入，
    //    都可能被掛到某個隨機的使用者身上。
    //
    //    我第一版照抄了 Prisma 的行為（傳 null 進去），
    //    而 TS 立刻抓到型別不符 —— 那是個好兆頭：
    //    改寫成 raw SQL 讓原本被型別系統忽略的問題浮現。
    user = await userByPlatformChannelName(platform, channelName);
  }

  // 5. Create new user with default settings
  if (!user) {
    const finalHandle = (channelHandle || channelName || email?.split("@")[0] || `user_${Date.now()}`).toLowerCase().replace(/[^a-z0-9]/g, "");
    const finalName = channelName || finalHandle;
    // 原本是 1 個 users create + Promise.all([11 個])。
    // 現在是單一 multi-statement —— 11 次跨網路往返降到 1 次，
    // 而語意等價（實測見 scripts/test-account-http.cjs）。
    //
    // ⚠️ enabled 的預設值不在這裡決定，而在 account-http.ts 裡 ——
    //    donations 與 stats 預設是 false，而那是容易被「順手改成 true」的細節。
    const expiresAtIso = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null;
    user = await createUserWithDefaults(
      finalName,
      finalHandle,
      email || "",
      channelAvatar || "",
      platform,
      tokens.access_token,
      tokens.refresh_token || null,
      expiresAtIso,
    );
  } else {
    // Update user: display name from channel name, username from handle
    const updateFields: any = {};
    if (channelName && channelName !== user.name) updateFields.name = channelName;
    if (channelHandle) {
      const cleanHandle = channelHandle.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (cleanHandle && cleanHandle !== user.username) updateFields.username = cleanHandle;
    }
    if (email && email !== user.email) updateFields.email = email;
    if (channelAvatar && !user.avatar) updateFields.avatar = channelAvatar;
    if (Object.keys(updateFields).length) await updateUserProfile(user.id, updateFields);
  }

  // Store/update platform connection for THIS user (regardless of which platform it is)
  await upsertPlatformConnection(user.id, platform, {
    connected: true,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || null,
    tokenExpiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null,
    channelId: channelId || null,
    channelName: channelName || null,
    channelAvatar: channelAvatar || null,
  });

  // Create/renew session
  const sessionId = await createSession(user.id, platform);
  const response = NextResponse.redirect(new URL(`/dashboard/connections?connected=${platform}`, req.url));
  response.cookies.set("sf_session", sessionId, { httpOnly: true, maxAge: 86400 * 30, path: "/", sameSite: "lax" });

  return response;
}
