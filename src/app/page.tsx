"use client";

import { useEffect, useState } from "react";
import { Gamepad2, TvMinimalPlay } from "lucide-react";
import Image from "next/image";
import Logo from "@/public/logo.svg";
import { api } from "@/lib/api";

export default function Home() {
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    api.getUser().then(u => {
      if (u?.id) window.location.href = "/dashboard";
    }).catch(() => {}).finally(() => setChecking(false));
  }, []);

  if (checking) return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--ic-canvas)]">
      <div className="text-[14px] text-[var(--ic-ink-muted)]">載入中...</div>
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--ic-canvas)] px-4" style={{ background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)" }}>
      <div className="flex w-full max-w-sm flex-col items-center gap-6 text-center">
        <div className="flex flex-col items-center gap-2">
          <Image
            src="/logo.svg"
            alt="熾台 CHITAI"
            width={80}
            height={80}
            priority
            className="drop-shadow-[0_0_20px_theme(colors.orange.500/0.5)]"
          />
          <span className="text-2xl font-[650] tracking-tight text-white">熾台</span>
          <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/45">CHITAI</span>
        </div>
        <h1 className="text-[clamp(24px,5vw,32px)] font-[600] leading-[1.2] text-white">
          創作者控制中心
        </h1>
        {/* ★ 原先這裡寫「免費開源」。兩個問題分開處理：
            「免費」是誤導 —— 我們現在收子熙幣，功能不是不用付錢就不能用。
            「開源」更麻煩：專案裡沒有 LICENSE 檔、git 也沒追蹤任何 LICENSE，
            所以宣稱 MIT 是無憑據的。真要開源就補 LICENSE 檔，
            否則不要在頁面上寫。
            MIT 授權的程式碼可以搭配付費服務，那沒問題；
            問題是「宣稱了但沒有對應的授權檔」。 */}
        <p className="text-[14px] leading-[1.6] text-white/60">
          直播互動工具。斗內、聊天室、即時字幕、疊加層、OBS 串接。<br />
          以<b className="text-white/85">子熙幣</b>儲值計費，不綁月費。
        </p>

        <div className="mt-4 flex w-full flex-col gap-3">
          <a href="/api/auth/twitch"
            className="flex items-center justify-center gap-3 rounded-[12px] bg-[#9146ff] px-6 py-3.5 text-[15px] font-[600] text-white no-underline transition-all hover:bg-[#7c3aed]">
            <Gamepad2 size={22} />
            使用 Twitch 帳號登入
          </a>
          <a href="/api/auth/youtube"
            className="flex items-center justify-center gap-3 rounded-[12px] bg-white px-6 py-3.5 text-[15px] font-[600] text-[#111] no-underline transition-all hover:bg-gray-100">
            <TvMinimalPlay size={22} className="text-[#ff0033]" />
            使用 Google 帳號登入
          </a>
        </div>

        <p className="text-[12px] text-white/30">
          子熙幣儲值・不綁月費・Twitch/Google 快速登入
        </p>
      </div>
    </div>
  );
}
