"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Gamepad2, TvMinimalPlay } from "lucide-react";

export default function AuthModal() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

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
                <span style={{ fontSize: "17px", fontWeight: 600, color: "#111" }}>登入 熾台</span>
              </div>
              <button onClick={() => setOpen(false)} style={{ width: "32px", height: "32px", borderRadius: "8px", border: "1px solid #e5e2dd", background: "#f4f3f1", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#111" }}>
                <X size={16} />
              </button>
            </div>
            <p style={{ margin: "0 0 20px", fontSize: "14px", color: "#6b6b6b", lineHeight: 1.6 }}>選擇你想要的登入方式，我們不會未經授權發布任何內容。</p>
            <div style={{ display: "grid", gap: "10px" }}>
              <a href="/api/auth/twitch" style={{ display: "flex", alignItems: "center", gap: "14px", padding: "14px 16px", borderRadius: "8px", border: "1px solid #e5e2dd", background: "#fafaf8", color: "#111", textDecoration: "none" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "#d4d0ca"; e.currentTarget.style.background = "#f4f3f1"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "#e5e2dd"; e.currentTarget.style.background = "#fafaf8"; }}>
                <div style={{ width: "36px", height: "36px", borderRadius: "8px", background: "#ffffff", display: "flex", alignItems: "center", justifyContent: "center", color: "#9146ff" }}><Gamepad2 size={20} /></div>
                <div style={{ flex: 1 }}><strong style={{ display: "block", fontSize: "14px", fontWeight: 600 }}>Twitch 帳號</strong><span style={{ fontSize: "12px", color: "#8a8a8a" }}>使用 Twitch 帳號快速登入</span></div>
                <span style={{ color: "#b0b0b0", fontSize: "18px" }}>→</span>
              </a>
              <a href="/api/auth/youtube" style={{ display: "flex", alignItems: "center", gap: "14px", padding: "14px 16px", borderRadius: "8px", border: "1px solid #e5e2dd", background: "#fafaf8", color: "#111", textDecoration: "none" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "#d4d0ca"; e.currentTarget.style.background = "#f4f3f1"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "#e5e2dd"; e.currentTarget.style.background = "#fafaf8"; }}>
                <div style={{ width: "36px", height: "36px", borderRadius: "8px", background: "#ffffff", display: "flex", alignItems: "center", justifyContent: "center", color: "#ff0033" }}><TvMinimalPlay size={20} /></div>
                <div style={{ flex: 1 }}><strong style={{ display: "block", fontSize: "14px", fontWeight: 600 }}>Google 帳號</strong><span style={{ fontSize: "12px", color: "#8a8a8a" }}>使用 YouTube/Google 帳號登入</span></div>
                <span style={{ color: "#b0b0b0", fontSize: "18px" }}>→</span>
              </a>
            </div>
            <p style={{ margin: "16px 0 0", fontSize: "12px", color: "#b0b0b0", textAlign: "center" }}>登入即表示你同意我們的使用條款與隱私政策</p>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
