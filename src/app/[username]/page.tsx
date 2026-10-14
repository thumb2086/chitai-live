import { query, queryOne } from "@/lib/db-http";
import { notFound } from "next/navigation";
import { Heart } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function PublicCreatorPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const decoded = decodeURIComponent(username);
  const cleanName = decoded.startsWith("@") ? decoded.slice(1) : decoded;
  const user = await queryOne<{ id: string; username: string; name: string; avatar: string; publicPage: boolean }>(
    'SELECT "id", "username", "name", "avatar", "publicPage" FROM "User" WHERE "username" = $1 LIMIT 1',
    [cleanName],
  );

  if (!user || !user.publicPage) return notFound();

  const goals = await query<{ id: string; emoji: string; title: string; current: number; goal: number }>(
    'SELECT "id", "emoji", "title", "current", "goal" FROM "DonationGoal" WHERE "userId" = $1 ORDER BY "sortOrder" ASC',
    [user.id],
  );
  const totalDonations = goals.reduce((sum: number, g: { current: number }) => sum + g.current, 0);
  const totalGoal = goals.reduce((sum: number, g: { goal: number }) => sum + g.goal, 0);

  return (
    <div style={{ minHeight: "100vh", background: "#f5f1ec", fontFamily: "system-ui, sans-serif", padding: "40px 16px" }}>
      <div style={{ maxWidth: "680px", margin: "0 auto" }}>
        <div style={{ background: "#ffffff", borderRadius: "14px", border: "1px solid #e5e2dd", padding: "32px", marginBottom: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "16px" }}>
            <div style={{
              width: "64px", height: "64px", borderRadius: "50%",
              background: "#f4f3f1", display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "24px", fontWeight: "bold", color: "#ff5600", overflow: "hidden",
            }}>
              {user.avatar ? <img src={user.avatar} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}} /> : user.name.charAt(0)}
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: "24px", fontWeight: 600, color: "#111" }}>{user.name}</h1>
              <p style={{ margin: "4px 0 0", color: "#8a8a8a", fontSize: "14px" }}>@{user.username}</p>
            </div>
          </div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "4px 12px", borderRadius: "999px", background: "#f4f3f1", border: "1px solid #e5e2dd", color: "#6b6b6b", fontSize: "13px", fontWeight: 500 }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#8a8a8a", display: "inline-block" }} />
            離線
          </div>
        </div>

        {goals.length > 0 && (
          <div style={{ background: "#ffffff", borderRadius: "14px", border: "1px solid #e5e2dd", padding: "24px", marginBottom: "16px" }}>
            <h2 style={{ margin: "0 0 16px", fontSize: "18px", fontWeight: 600, color: "#111", display: "flex", alignItems: "center", gap: "8px" }}>
              <Heart style={{ color: "#ff5600" }} size={20} /> 贊助目標
            </h2>
            {goals.map((g: { id: string; emoji: string; title: string; current: number; goal: number }) => {
              const pct = Math.min(100, Math.round((g.current / g.goal) * 100));
              return (
                <div key={g.id} style={{ marginBottom: "12px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                    <span style={{ fontSize: "14px", fontWeight: 600, color: "#111" }}>{g.emoji} {g.title}</span>
                    <span style={{ fontSize: "13px", fontWeight: 700, color: "#ff5600" }}>{pct}%</span>
                  </div>
                  <div style={{ height: "8px", background: "#f4f3f1", borderRadius: "999px", overflow: "hidden" }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: "#ff5600", borderRadius: "999px" }} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px", fontSize: "13px", color: "#8a8a8a" }}>
                    <span style={{ fontWeight: 600, color: "#111" }}>ZXC {g.current.toLocaleString()}</span>
                    <span>目標 ZXC {g.goal.toLocaleString()}</span>
                  </div>
                </div>
              );
            })}
            {totalGoal > 0 && (
              <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid #ebe7e1", textAlign: "center" }}>
                <span style={{ fontSize: "14px", color: "#6b6b6b" }}>已贊助總額 </span>
                <strong style={{ fontSize: "18px", color: "#111" }}>ZXC {totalDonations.toLocaleString()}</strong>
              </div>
            )}
          </div>
        )}

        <div style={{ background: "#ffffff", borderRadius: "14px", border: "1px solid #e5e2dd", padding: "24px", textAlign: "center" }}>
          <p style={{ margin: "0 0 12px", color: "#6b6b6b", fontSize: "14px" }}>喜歡這個頻道嗎？贊助支持創作者！</p>
          {/* ★ 這裡原本是一個 <div> 寫著「贊助支援（功能即將推出）」——
              外觀是橘色膠囊、內含愛心圖示，看起來完全可點，
              但它是 div 不是 button，點了什麼都不會發生。

              ★ 而「功能即將推出」是錯的：/donate/[username] 早就有完整的
                DonateForm 與支付鏈路（chargeZixi / confirmZixiCharge），
                實測回 HTTP 200 且渲染出表單。

              一個看起來能用但不能用的按鈕，比沒有更糟：
              使用者會以為系統壞了，或以為自己沒錢可捐。*/}
          <a
            href={"/donate/" + user.username}
            style={{
              display: "inline-flex", alignItems: "center", gap: "8px",
              padding: "12px 28px", borderRadius: "999px",
              background: "#ff5600", color: "#ffffff",
              fontSize: "15px", fontWeight: 600, textDecoration: "none",
            }}
          >
            <Heart size={18} /> 立即贊助
          </a>
        </div>
      </div>
    </div>
  );
}
