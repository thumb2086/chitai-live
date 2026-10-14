"use client";

import { useState, useRef, useEffect } from "react";
import { Check, Copy, ExternalLink, Wallet, LogIn, Send, User } from "lucide-react";

interface Props {
  username: string;
  zixiWallet: string;
  goals: { title: string; current: number; goal: number }[];
  totalReceived: number;
  recentDonations: string;
}


/**
 * 捐款級距（2026-10-14）。
 *
 * 為什麼要帶名字：原本只有一個空白數字輸入框，使用者不知道多少算合理，
 * 於是隨便填或乾脆不填。
 *
 * ★ 名稱與金額是我們自己定的，不是照抄任何競品 ——
 *   參考的只是「有名字的級距」這個概念（好過空白輸入框）。
 *   「應援」用語在台灣實況圈通用，且直接說明用途、不承諾回報。
 */
const TIERS = [
  { icon: "🩵", label: "應援",     value: 100,  note: "單純支持一下" },
  { icon: "💛", label: "推一把",   value: 500,  note: "幫你加油打氣" },
  { icon: "🎁", label: "揪團禮",   value: 2000, note: "一起看更划算" },
  { icon: "🚀", label: "大力挺",   value: 10000, note: "這場很值" },
] as const;

export default function DonateForm({ username, zixiWallet, goals, totalReceived, recentDonations }: Props) {
  const [copied, setCopied] = useState(false);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("100");
  const [token, setToken] = useState<"ZXC" | "YJC">("ZXC");
  const [msg, setMsg] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [donations, setDonations] = useState<any[]>(JSON.parse(recentDonations || "[]"));
  const [lastTime, setLastTime] = useState("");

  // ZIXI login state
  const [zixiSession, setZixiSession] = useState<string | null>(null);
  const [zixiUser, setZixiUser] = useState<string>("");
  const [zixiPass, setZixiPass] = useState("");
  const [zixiBalance, setZixiBalance] = useState<{ zxc: number; yjc: number } | null>(null);
  const [loginError, setLoginError] = useState("");
  const [sendingDonation, setSendingDonation] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Restore session from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("sf_zixi_session");
    const savedUser = localStorage.getItem("sf_zixi_user");
    if (saved && savedUser) {
      setZixiSession(saved);
      setZixiUser(savedUser);
      fetchBalance(saved);
    }
  }, []);

  useEffect(() => {
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/v1/zixi-donations?status=confirmed&after=${encodeURIComponent(lastTime || "2000-01-01")}`);
        const d = await r.json();
        if (d.donations?.length) {
          setDonations(prev => {
            const existing = new Set(prev.map((x: any) => x.id));
            const newOnes = d.donations.filter((x: any) => !existing.has(x.id));
            return [...newOnes, ...prev].slice(0, 20);
          });
          setLastTime(d.donations[0].createdAt || "");
        }
      } catch {}
    }, 15000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [lastTime]);

  const fetchBalance = async (sessionId: string) => {
    try {
      const r = await fetch("/api/v1/zixi/proxy", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "wallet-summary", sessionId }),
      });
      const d = await r.json();
      if (d.success && d.data?.summary?.balances) {
        setZixiBalance({
          zxc: parseFloat(d.data.summary.balances.ZXC || "0"),
          yjc: parseFloat(d.data.summary.balances.YJC || "0"),
        });
      }
    } catch {}
  };

  const zixiLogin = async () => {
    setLoginError("");
    try {
      const r = await fetch("/api/v1/zixi/proxy", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", username: zixiUser, password: zixiPass }),
      });
      const d = await r.json();
      if (d.success && d.data?.sessionId) {
        setZixiSession(d.data.sessionId);
        localStorage.setItem("sf_zixi_session", d.data.sessionId);
        localStorage.setItem("sf_zixi_user", zixiUser);
        setZixiPass("");
        fetchBalance(d.data.sessionId);
      } else {
        setLoginError(d.error || d.data?.error?.message || "登入失敗");
      }
    } catch {
      setLoginError("無法連接到 ZIXI 伺服器");
    }
  };

  const zixiLogout = () => {
    setZixiSession(null);
    setZixiUser("");
    setZixiBalance(null);
    localStorage.removeItem("sf_zixi_session");
    localStorage.removeItem("sf_zixi_user");
  };

  const sendDonation = async () => {
    if (!zixiSession || !name.trim()) return;
    setSendingDonation(true);
    try {
      // Get donor's wallet address from session
      const summaryR = await fetch("/api/v1/zixi/proxy", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "wallet-summary", sessionId: zixiSession }),
      });
      const summaryD = await summaryR.json();
      const donorAddress = summaryD.data?.summary?.balances ? (zixiUser.startsWith("0x") ? zixiUser : summaryD.data?.onchain?.zxc?.contractAddress ? zixiUser : "") : "";
      const r = await fetch("/api/v1/zixi/proxy", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "admin-transfer", donorAddress: donorAddress || zixiUser, creatorAddress: zixiWallet, amount: parseFloat(amount) || 0, token, donorName: name.trim() }),
      });
      const d = await r.json();
      if (d.success || d.data?.success) {
        setStatus("sent");
        // Record in our DB
        await fetch("/api/v1/zixi-donations", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, donorAddress: zixiUser, donorName: name.trim(), amount: parseFloat(amount) || 0, token, message: msg.trim(), isTest: true }),
        }).catch(() => {});
        fetchBalance(zixiSession);
        setTimeout(() => setStatus("idle"), 4000);
      } else {
        setStatus("error");
        setLoginError(d.data?.error?.message || "發送失敗");
      }
    } catch {
      setStatus("error");
    }
    setSendingDonation(false);
  };

  const copyAddress = () => {
    navigator.clipboard.writeText(zixiWallet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const pct = goals.length > 0 ? Math.min(100, Math.round((goals[0].current / goals[0].goal) * 100)) : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {goals.length > 0 && (
        <div style={{ background: "rgba(255,255,255,0.08)", borderRadius: "14px", padding: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px", fontSize: "13px", color: "rgba(255,255,255,0.7)" }}>
            <span>贊助進度</span>
            <span style={{ color: "#ff5600", fontWeight: 700 }}>ZXC {totalReceived.toLocaleString()}</span>
          </div>
          <div style={{ height: "6px", background: "rgba(255,255,255,0.1)", borderRadius: "999px", overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: "#ff5600", borderRadius: "999px" }} />
          </div>
        </div>
      )}

      {/* ZIXI Login */}
      {!zixiSession ? (
        <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: "14px", padding: "20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
            <Wallet size={18} color="#ff5600" />
            <span style={{ color: "#fff", fontSize: "15px", fontWeight: 700 }}>登入 ZIXI 帳號</span>
          </div>
          <p style={{ margin: "0 0 12px", fontSize: "12px", color: "rgba(255,255,255,0.4)" }}>
            登入後可直接從錢包發送代幣贊助，不需離開此頁面
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <input value={zixiUser} onChange={e => setZixiUser(e.target.value)} placeholder="ZIXI 使用者名稱"
              style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.06)", color: "#fff", fontSize: "13px", outline: "none", boxSizing: "border-box" }} />
            <input value={zixiPass} onChange={e => setZixiPass(e.target.value)} type="password" placeholder="密碼"
              style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.06)", color: "#fff", fontSize: "13px", outline: "none", boxSizing: "border-box" }} />
            {loginError && <div style={{ fontSize: "12px", color: "#ff6b6b" }}>{loginError}</div>}
            <button onClick={zixiLogin} style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "none", background: "#ff5600", color: "#fff", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>
              <LogIn size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />登入 ZIXI
            </button>
          </div>
          <p style={{ marginTop: "8px", fontSize: "11px", color: "rgba(255,255,255,0.3)", textAlign: "center" }}>
            還沒有帳號？<a href="https://zixi-casino.vercel.app" target="_blank" rel="noopener noreferrer" style={{ color: "#ff5600" }}>前往 ZIXI Casino 註冊</a>
          </p>
        </div>
      ) : (
        <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: "14px", padding: "20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Wallet size={18} color="#0bbf50" />
              <span style={{ color: "#fff", fontSize: "14px", fontWeight: 600 }}>{zixiUser}</span>
            </div>
            <button onClick={zixiLogout} style={{ padding: "4px 10px", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: "rgba(255,255,255,0.5)", fontSize: "11px", cursor: "pointer" }}>登出</button>
          </div>

          {zixiBalance && (
            <div style={{ display: "flex", gap: "10px", marginBottom: "12px" }}>
              <div style={{ flex: 1, background: "rgba(255,255,255,0.04)", borderRadius: "8px", padding: "10px", textAlign: "center" }}>
                <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)", textTransform: "uppercase" }}>ZXC</div>
                <div style={{ fontSize: "16px", fontWeight: 700, color: "#ff5600" }}>{zixiBalance.zxc.toLocaleString()}</div>
              </div>
              <div style={{ flex: 1, background: "rgba(255,255,255,0.04)", borderRadius: "8px", padding: "10px", textAlign: "center" }}>
                <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)", textTransform: "uppercase" }}>YJC</div>
                <div style={{ fontSize: "16px", fontWeight: 700, color: "#a78bfa" }}>{zixiBalance.yjc.toLocaleString()}</div>
              </div>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="你的名稱（顯示在斗內通知）"
              style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.06)", color: "#fff", fontSize: "13px", outline: "none", boxSizing: "border-box" }} />
            {/* ★ 捐款級距：給一個起點，而不是空白輸入框。
                選了級距之後，下面仍可自訂 —— 級距是起點不是限制。*/}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              {TIERS.map(t => {
                const active = amount === String(t.value);
                return (
                  <button key={t.label} type="button" onClick={() => setAmount(String(t.value))}
                    aria-pressed={active}
                    title={t.note}
                    style={{
                      padding: "9px 10px", borderRadius: "8px", cursor: "pointer", textAlign: "left",
                      border: active ? "2px solid #ff5600" : "1px solid rgba(255,255,255,0.1)",
                      background: active ? "rgba(255,86,0,0.12)" : "transparent",
                      color: "#fff",
                    }}>
                    <div style={{ fontSize: "12px", fontWeight: 700, lineHeight: 1.3 }}>{t.icon} {t.label}</div>
                    <div style={{ fontSize: "10px", color: active ? "#ffb38a" : "#8b93a7", marginTop: 2 }}>
                      {t.value.toLocaleString()} {token}
                    </div>
                  </button>
                );
              })}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <input value={amount} onChange={e => setAmount(e.target.value)} type="number" placeholder="或自訂金額" aria-label="捐款金額"
                style={{ flex: 1, padding: "10px 12px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.06)", color: "#fff", fontSize: "13px", outline: "none", boxSizing: "border-box" }} />
              <div style={{ fontSize: "13px", color: "#8b93a7", whiteSpace: "nowrap" }}>{token}</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              <div onClick={() => setToken("ZXC")} style={{ padding: "10px", borderRadius: "8px", textAlign: "center", cursor: "pointer", border: token === "ZXC" ? "2px solid #ff5600" : "1px solid rgba(255,255,255,0.1)" }}>
                <div style={{ fontSize: "9px", color: "#ff5600", fontWeight: 700, textTransform: "uppercase" }}>子熙幣</div>
                <div style={{ fontSize: "15px", fontWeight: 700, color: "#fff" }}>ZXC</div>
              </div>
              <div onClick={() => setToken("YJC")} style={{ padding: "10px", borderRadius: "8px", textAlign: "center", cursor: "pointer", border: token === "YJC" ? "2px solid #a78bfa" : "1px solid rgba(255,255,255,0.1)" }}>
                <div style={{ fontSize: "9px", color: "#a78bfa", fontWeight: 700, textTransform: "uppercase" }}>佑戩幣</div>
                <div style={{ fontSize: "15px", fontWeight: 700, color: "#fff" }}>YJC</div>
              </div>
            </div>
            <input value={msg} onChange={e => setMsg(e.target.value)} placeholder="留言（選填）"
              style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.06)", color: "#fff", fontSize: "13px", outline: "none", boxSizing: "border-box" }} />
            {loginError && <div style={{ fontSize: "12px", color: "#ff6b6b" }}>{loginError}</div>}

            <button onClick={sendDonation} disabled={sendingDonation || !name.trim()}
              style={{ width: "100%", padding: "12px", borderRadius: "8px", border: "none",
                background: status === "sent" ? "#0bbf50" : "#ff5600",
                color: "#fff", fontSize: "14px", fontWeight: 600, cursor: "pointer", opacity: sendingDonation ? 0.6 : 1 }}>
              {sendingDonation ? "發送中..." : status === "sent" ? "✅ 贊助成功！" : status === "error" ? "❌ 失敗，重試" : <><Send size={14} style={{marginRight:6,verticalAlign:"middle"}} />發送 {amount} {token}</>}
            </button>
          </div>
        </div>
      )}

      {/* Quick copy address + link */}
      <div style={{ display: "flex", gap: "8px" }}>
        <button onClick={copyAddress} style={{ flex: 1, padding: "10px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)", color: "#fff", fontSize: "12px", cursor: "pointer" }}>
          {copied ? <><Check size={14} style={{marginRight:4,verticalAlign:"middle"}} /> 已複製</> : <><Copy size={14} style={{marginRight:4,verticalAlign:"middle"}} /> 複製地址</>}
        </button>
        <a href="https://zixi-casino.vercel.app" target="_blank" rel="noopener noreferrer"
          style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "4px", padding: "10px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.6)", fontSize: "12px", textDecoration: "none" }}>
          <ExternalLink size={14} /> ZIXI Casino
        </a>
      </div>

      {/* Recent Donations */}
      {donations.length > 0 && (
        <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: "14px", padding: "16px" }}>
          <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.5)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "12px" }}>近期贊助</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {donations.map((d: any, i: number) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <div>
                  <div style={{ color: "#fff", fontSize: "13px", fontWeight: 600 }}>{d.name}</div>
                  {d.msg && <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "11px" }}>{d.msg}</div>}
                </div>
                <div style={{ color: d.token === "YJC" ? "#a78bfa" : "#ff5600", fontSize: "14px", fontWeight: 700 }}>{d.amount} {d.token}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
