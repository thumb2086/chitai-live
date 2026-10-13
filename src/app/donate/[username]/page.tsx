import { query, queryOne } from "@/lib/db-http";
import { notFound } from "next/navigation";
import DonateForm from "./DonateForm";

export const dynamic = "force-dynamic";

export default async function PublicDonatePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const decoded = decodeURIComponent(username);
  const cleanName = decoded.startsWith("@") ? decoded.slice(1) : decoded;
  const user = await queryOne<{ id: string; username: string; name: string; avatar: string; publicPage: boolean; zixiWallet: string }>(
    'SELECT "id", "username", "name", "avatar", "publicPage", "zixiWallet" FROM "User" WHERE "username" = $1 LIMIT 1',
    [cleanName],
  );
  if (!user || !user.publicPage) return notFound();

  const goals = await query<{ id: string; title: string; current: number; goal: number }>(
    'SELECT "id", "title", "current", "goal" FROM "DonationGoal" WHERE "userId" = $1 ORDER BY "sortOrder" ASC',
    [user.id],
  );
  const totalReceived = goals.reduce((s: number, g: { current: number }) => s + g.current, 0);
  const hasZixi = user.zixiWallet && user.zixiWallet.startsWith("0x");
  const zixiWallet = user.zixiWallet || "";

  const recentDonations = await query<{ donorName: string; donorAddress: string; amount: number; token: string; message: string }>(
    'SELECT "donorName", "donorAddress", "amount", "token", "message" FROM "ZixiDonation" WHERE "userId" = $1 AND "status" = \'confirmed\' ORDER BY "createdAt" DESC LIMIT 10',
    [user.id],
  );

  const recentJson = JSON.stringify(recentDonations.map(d => ({
    name: d.donorName || d.donorAddress?.slice(0,6)+"..."+d.donorAddress?.slice(-4) || "匿名",
    amount: d.amount,
    token: d.token,
    msg: d.message,
  })));

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)", fontFamily: "system-ui, sans-serif", padding: "40px 16px" }}>
      <div style={{ maxWidth: "480px", margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: "24px" }}>
          <div style={{ width: "72px", height: "72px", borderRadius: "50%", margin: "0 auto 16px", background: "rgba(255,86,0,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "28px", fontWeight: "bold", color: "#ff5600", border: "2px solid rgba(255,86,0,0.3)", overflow: "hidden" }}>
            {user.avatar ? <img src={user.avatar} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}} /> : user.name.charAt(0)}
          </div>
          <h1 style={{ margin: "0 0 4px", fontSize: "24px", fontWeight: 700, color: "#ffffff" }}>贊助 {user.name}</h1>
          <p style={{ margin: 0, fontSize: "14px", color: "rgba(255,255,255,0.6)" }}>使用 ZIXI 生態系代幣贊助</p>
        </div>

        {hasZixi ? (
          <DonateForm username={cleanName} zixiWallet={zixiWallet} goals={goals.map(g => ({ title: g.title, current: g.current, goal: g.goal }))} totalReceived={totalReceived} recentDonations={recentJson} />
        ) : (
          <p style={{ textAlign: "center", fontSize: "14px", color: "rgba(255,255,255,0.4)" }}>此創作者尚未開通贊助功能</p>
        )}

        <p style={{ marginTop: "24px", textAlign: "center", fontSize: "12px", color: "rgba(255,255,255,0.3)" }}>
          由 熾台 提供技術支援
        </p>
      </div>
    </div>
  );
}
