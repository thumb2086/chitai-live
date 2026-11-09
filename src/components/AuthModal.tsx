"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";

export default function AuthModal() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => setMounted(true), []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMsg("");
    try {
      const url = mode === "login"
        ? "https://api.zixilive.dpdns.org/api/auth/login"
        : "https://api.zixilive.dpdns.org/api/auth/register";
      const body = mode === "login"
        ? { email, password }
        : { email, password, name: name || email.split("@")[0] };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        setMsg(data?.error || data?.message || `失敗 ${res.status}`);
        return;
      }
      const token = data?.data?.token;
      if (token) {
        localStorage.setItem("chitai_token", token);
        document.cookie = `token=${token}; path=/; max-age=604800`;
        window.location.href = "/dashboard";
      } else {
        setMsg("登入成功但未取得 token");
      }
    } catch (err: any) {
      setMsg(err?.message || "網路錯誤");
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = { width: "100%", padding: "12px 14px", borderRadius: "8px", border: "1px solid #e5e2dd", background: "#fafaf8", color: "#111", fontSize: "13px", boxSizing: "border-box" as const };

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="flex min-h-[34px] items-center rounded-[999px] border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] px-4 text-[13px] font-[500] text-[var(--ic-ink)] transition-all hover:border-[var(--ic-hairline-strong)]">
        登入
      </button>

      {open && mounted && createPortal(
        <div onClick={() => setOpen(false)}
          style={{ position: "fixed", inset: 0, zIndex: 99999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(17,17,17,0.38)" }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: "#ffffff", borderRadius: "14px", padding: "32px", maxWidth: "400px", width: "90%", border: "1px solid #d4d0ca", boxShadow: "0 18px 56px rgba(17,17,17,0.1)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div style={{ width: "32px", height: "32px", borderRadius: "8px", background: "#ff5600", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "14px", fontWeight: "bold" }}>SF</div>
                <span style={{ fontSize: "17px", fontWeight: 600, color: "#111" }}>{mode === "login" ? "登入" : "註冊"}</span>
              </div>
              <button onClick={() => setOpen(false)} style={{ width: "32px", height: "32px", borderRadius: "8px", border: "1px solid #e5e2dd", background: "#f4f3f1", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#111" }}>
                ✕
              </button>
            </div>

            <form onSubmit={submit} style={{ display: "grid", gap: "10px" }}>
              {mode === "register" && (
                <input value={name} onChange={e => setName(e.target.value)} placeholder="顯示名稱" style={inputStyle} />
              )}
              <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="email" style={inputStyle} />
              <input type="password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="password (≥6)" style={inputStyle} />
              <button type="submit" disabled={loading}
                style={{ padding: "13px 16px", borderRadius: "8px", border: "none", background: "#ff5600", color: "#fff", fontSize: "14px", fontWeight: 600, cursor: loading ? "wait" : "pointer" }}>
                {loading ? "處理中…" : (mode === "login" ? "登入" : "註冊")}
              </button>
              {msg && <p style={{ margin: 0, color: "#ff0033", fontSize: "12px", textAlign: "center" }}>{msg}</p>}
            </form>

            <div style={{ textAlign: "center", marginTop: "12px" }}>
              <button onClick={() => setMode(mode === "login" ? "register" : "login")} style={{ background: "none", border: "none", color: "#ff5600", cursor: "pointer", fontSize: "13px" }}>
                {mode === "login" ? "沒有帳號？去註冊" : "已有帳號？回登入"}
              </button>
            </div>

            <p style={{ margin: "16px 0 0", fontSize: "12px", color: "#b0b0b0", textAlign: "center" }}>Google/Twitch SSO 需要在對應控制台註冊 client secret 後才能啟用；目前可先用 email/password 登入。</p>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}