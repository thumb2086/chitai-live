import { NextResponse } from "next/server";
// 2026-10-06：從 Prisma 改成 Neon HTTP（Workers 相容）。
import {
  findUserByUsername, createZixiDonation, findOBSSource, listZixiDonations,
} from "@/lib/zixi-donations-http";
import { getOrCreateUser, getSessionId, unauthorized } from "@/lib/getUser";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { username, donorAddress, donorName, amount, token, message } = body;

    if (!username || !donorAddress || !amount || amount <= 0) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const user = await findUserByUsername(username);
    if (!user) {
      return NextResponse.json({ error: "Creator not found" }, { status: 404 });
    }

    const isTest = body.isTest === true;
    if (isTest) {
      // Test donations write confirmed records into alerts/leaderboard.
      // Require the caller's session to match the target creator — otherwise
      // anyone knowing a username can inject fake confirmed donations.
      const caller = await getOrCreateUser(getSessionId(req));
      if (!caller || caller.username !== user.username) {
        return NextResponse.json({ error: "Test donations require owner session" }, { status: 403 });
      }
    }
    if (!user.zixiWallet && !isTest) {
      return NextResponse.json({ error: "No wallet configured" }, { status: 400 });
    }

    // Record the donation
    const donation = await createZixiDonation({
      userId: user.id,
      donorAddress,
      donorName: donorName || "",
      amount: Number(amount),
      token: token || "ZXC",
      message: message || "",
      status: isTest ? "confirmed" : "pending",
    });

    return NextResponse.json({
      ok: true,
      donationId: donation?.id ?? "",
      recipientAddress: user.zixiWallet,
      instructions: `請從你的 ZIXI 錢包發送 ${amount} ${token || "ZXC"} 到 ${user.zixiWallet}`,
    });
  } catch (e: any) {
    console.error("POST /api/v1/zixi-donations error:", e);
    return NextResponse.json({ error: "Failed to create donation", detail: e?.message || String(e) }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const token = searchParams.get("token");
    const since = searchParams.get("since");
    const after = searchParams.get("after");

    let userId: string | null = null;

    // Support both: authenticated user (session) and OBS source (token)
    if (token) {
      const source = await findOBSSource(token, "alerts");
      if (source) userId = source.userId;
    }
    if (!userId) {
      const user = await getOrCreateUser(getSessionId(req));
      if (!user) return unauthorized();
      userId = user.id;
    }

    const donations = await listZixiDonations(userId, {
      status: status || null,
      since: since || null,
      after: after || null,
      take: 50,
    });

    return NextResponse.json({ donations });
  } catch (e) {
    console.error("GET /api/v1/zixi-donations error:", e);
    return NextResponse.json({ error: "Failed to fetch donations" }, { status: 500 });
  }
}
