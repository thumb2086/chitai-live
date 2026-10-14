import { timingSafeEqual as timingSafeEqualBuf } from "node:crypto";
import { NextResponse } from "next/server";
// 2026-10-06：從 Prisma 改成 Neon HTTP（Workers 相容）。
import { queryOne } from "@/lib/db-http";
import { getOrCreateUser, getSessionId, unauthorized } from "@/lib/getUser";
// ★ 這個檔案是唯一還留著死掉 fallback 的地方（2026-10-14 修）。
//   原本是：
//     const ZIXI_API = process.env.ZIXI_API_URL || "https://zixi-casino-api.onrender.com/api/v1";
//   而 onrender 那台實測是 20 秒逾時。
//
//   ★ 而 zixi-endpoints.ts 的檔頭早就把這個坑寫下來了：
//     「真正的问题不是『网址旧了』，是『旧网址是 fallback』」
//     「设定错误被转换成了功能正常但结果为空」
//
//   但那個檔案只遷移了 callback，漏了 proxy。
//   後果：wallet-summary 一直 500，前端顯示「餘額查詢失敗」——
//   症狀看起來像「功能沒接好」，實際上是打到一个死掉的 host。
//
//   現在統一走單一來源，與 callback 一致。
import { zixiApiBase } from "@/lib/zixi-endpoints";

/**
 * ZIXI custody proxy.
 *
 * This route used to resolve no identity at all. It imported getSessionId but only
 * consulted it inside getAuthHeaders, which silently fell back to the server's
 * ZIXI_ADMIN_SESSION. That produced three live holes:
 *
 *   - `login` was an unauthenticated credential-forwarding oracle against the
 *     custody API.
 *   - `setup-admin` handed a ZIXI *admin sessionId* to any caller.
 *   - `admin-transfer` moved real balances between two caller-supplied addresses
 *     authorised by the server's admin session, callable from the public
 *     /donate/[username] page with no session at all.
 *
 * `login` and `setup-admin` are gone: neither has a legitimate caller left, and
 * setup-admin is an operator bootstrap task that should never be an HTTP
 * endpoint. Everything that remains requires a session, and nothing silently
 * borrows the admin session any more -- an explicit, reported "not connected"
 * is what the UI should render.
 */

const ZIXI_API = zixiApiBase();

const timingSafeEqual = (a: string, b: string) =>
  a.length === b.length && timingSafeEqualBuf(Buffer.from(a), Buffer.from(b));

/**
 * The caller's own ZIXI bearer, or null.
 *
 * Deliberately does NOT fall back to ZIXI_ADMIN_SESSION. That fallback is what
 * made a public page render the operator's wallet balances as if they were the
 * visitor's.
 */
async function callerToken(userId: string): Promise<string | null> {
  const user = await queryOne<{ zixiAccessToken: string | null; zixiTokenExpiresAt: string | null }>(
    'SELECT "zixiAccessToken", "zixiTokenExpiresAt" FROM "User" WHERE "id" = $1 LIMIT 1',
    [userId],
  );
  const token: string | null = user?.zixiAccessToken ?? null;
  if (!token) return null;
  const expires = user?.zixiTokenExpiresAt ? new Date(user.zixiTokenExpiresAt) : null;
  if (expires && expires <= new Date()) return null; // expired, not connected
  return token;
}

async function adminAdjustBalance(
  address: string,
  amount: string,
  token: string,
  reason: string,
  adminSession: string
) {
  const res = await fetch(`${ZIXI_API}/admin/adjust-balance`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: adminSession, address, amount, token, reason }),
  });
  return res.json();
}

export async function POST(req: Request) {
  try {
    const user = await getOrCreateUser(getSessionId(req));
    if (!user) return unauthorized();

    const body = await req.json();
    const action = body?.action;

    if (action === "login" || action === "setup-admin") {
      // Removed rather than gated: both existed only to bootstrap the operator's
      // admin session, and neither has a caller now. Bootstrapping belongs in a
      // script, not in a route reachable by anyone.
      return NextResponse.json(
        { success: false, error: `${action} is not available through this endpoint` },
        { status: 410 }
      );
    }

    if (action === "wallet-summary" || action === "me") {
      const token = await callerToken(user.id);
      if (!token) {
        // Say so instead of quietly returning the operator's numbers.
        return NextResponse.json({
          success: false,
          connected: false,
          error: "尚未連線或連線已過期，請重新連線 ZIXI",
        });
      }
      // ★ 2026-10-14 修正。這裡原本打的三個端點都不能用（實測）：
      //   /api/v1/wallet/summary → 404（只存在於 dlinker.js 相容層）
      //   /api/v1/auth/me        → 401（那是給 session JWT 用的）
      //   /api/oauth/userinfo    → 200 但不回傳餘額
      //
      // 改用 zixi-earth 新加的 /api/oauth/balance（2026-10-14）：
      // 接受 oat_ token、回 ZXC/YJC，而且與 userinfo 共用同一個
      // requireOAuthUser 驗證 —— 避免兩個函式對同一件事判斷不一致
      // （那正是 zixi-earth 鏈上結算事故根因 8 的結構）。
      const res = await fetch(`${ZIXI_API}/api/oauth/balance`, {
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error) {
        return NextResponse.json({
          success: false,
          connected: false,
          error: data?.error ? String(data.error) : "ZIXI 回應 " + res.status,
        }, { status: res.status === 200 ? 401 : res.status });
      }
      return NextResponse.json({
        success: true,
        connected: true,
        sub: data?.sub || "",
        username: data?.username || "",
        address: data?.wallet_address || "",
        // ★ 字串不是數字：zixi-earth 端就是 String() 回的
        //   （dlinker 的 addressBalances 也一樣）。前端顯示時再格式化，
        //   不要在這裡轉 Number —— 同一個餘額有兩個型別就會對不起來。
        balances: data?.balances || { ZXC: "0", YJC: "0" },
      });
    }


    if (action === "admin-transfer") {
      const adminSession = process.env.ZIXI_ADMIN_SESSION;
      if (!adminSession) {
        return NextResponse.json({ success: false, error: "Admin session not configured" }, { status: 500 });
      }
      if (!body.donorAddress || !body.creatorAddress || !body.amount) {
        return NextResponse.json({ success: false, error: "Missing donorAddress, creatorAddress, or amount" }, { status: 400 });
      }

      // The destination must be the caller's own registered wallet. Without this
      // any signed-in account could credit an arbitrary address out of the
      // operator's admin balance.
      if (body.creatorAddress !== (user.zixiWallet ?? "")) {
        return NextResponse.json(
          { success: false, error: "creatorAddress 必須是你自己已登記的錢包" },
          { status: 403 }
        );
      }

      const amt = String(body.amount);
      const token = body.token === "YJC" ? "yjc" : "zhixi";
      const reason = `熾台 donation: ${body.donorName || "anonymous"} → ${body.creatorName || user.username}`;

      const deductRes = await adminAdjustBalance(body.donorAddress, `-${amt}`, token, reason, adminSession);
      if (!deductRes.success) {
        return NextResponse.json({ success: false, error: deductRes.data?.error?.message || "Failed to deduct from donor" });
      }

      const creditRes = await adminAdjustBalance(body.creatorAddress, amt, token, reason, adminSession);
      if (!creditRes.success) {
        await adminAdjustBalance(body.donorAddress, amt, token, "REVERSAL: " + reason, adminSession).catch(() => {});
        return NextResponse.json({ success: false, error: creditRes.data?.error?.message || "Failed to credit creator" });
      }

      return NextResponse.json({
        success: true,
        data: { message: `Transferred ${amt} ${token}`, tx: deductRes.data?.intent || creditRes.data?.intent },
      });
    }

    return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 });
  } catch (e) {
    console.error("ZIXI proxy error:", e);
    return NextResponse.json({ success: false, error: "ZIXI proxy failed" }, { status: 500 });
  }
}