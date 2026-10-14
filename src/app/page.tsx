"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import {
  Gamepad2, TvMinimalPlay, MessageSquare, Captions, Heart,
  Terminal, Trophy, Clapperboard, Monitor, Wallet, ArrowRight, Zap,
} from "lucide-react";
import { api } from "@/lib/api";

/**
 * 落地頁。
 *
 * ★ 為什麼要這頁（2026-10-14）：
 *   原本首頁就是一個登入框。訪客進來只看到「選 OAuth 按鈕」，
 *   不知道這是什麼、要做幾件事、要花多少錢。
 *   登入牆不等於介紹頁 —— 它把「這產品對我有什麼用」變成要註冊才知道。
 *
 * ★ 這頁寫的是**我們真的有的功能**（對照 Sidebar 那 15 條），
 *   不是競品的功能清單。少寫一個不存在的功能比多寫更誠實。
 *
 * ★ 沒有寫「免費開源」：專案沒有 LICENSE 檔，宣稱開源是無憑據的。
 */
const ORANGE = "var(--ic-fin-orange)";

const TOOLS = [
  {
    icon: Captions,
    title: "即時字幕",
    body: "逐句浮現的即時字幕，繁中、英文、混合都認得。OBS 放一個瀏覽來源就上線。",
    tag: "免費", tone: "orange",
  },
  {
    icon: MessageSquare,
    title: "聊天室",
    body: "把觀眾留言直接放進直播畫面，可調主題、字級與顯示筆數。",
    tag: "免費", tone: "orange",
  },
  {
    icon: Heart,
    title: "斗內通知與進度條",
    body: "收到子熙幣立刻在畫面彈出提示；想追募款就加一條進度條，觀眾看得到差多少。",
    tag: "子熙幣", tone: "purple",
  },
  {
    icon: Terminal,
    title: "直播指令與抽獎",
    body: "觀眾打 !簽到 !點歌 !抽獎 就會觸發。抽獎可設資格、亂數抽出並自動公布。",
    tag: "免費", tone: "orange",
  },
  {
    icon: Clapperboard,
    title: "回放分析",
    body: "丟一段回放上來，自動標出聊天室提問高峰與互動熱點，剪輯時不用從頭看到尾。",
    tag: "計點", tone: "slate",
  },
  {
    icon: Monitor,
    title: "OBS 輸出",
    body: "每個工具都是一個網址，貼進 OBS 的瀏覽來源就能用，不用安裝任何東西。",
    tag: "免費", tone: "orange",
  },
];

const STEPS = [
  { t: "用 Twitch 或 Google 帳號登入", d: "不用另外註冊，也不用填密碼。" },
  { t: "連接你的直播頻道", d: "授權之後就能讀取直播狀態與觀眾留言。" },
  { t: "把工具網址貼進 OBS", d: "聊天室、字幕、斗內提示各自一個來源，開台就能用。" },
];

const TONE: Record<string, { bg: string; fg: string }> = {
  orange: { bg: "rgba(255,107,0,0.10)", fg: "#ff6b00" },
  purple: { bg: "rgba(167,139,250,0.12)", fg: "#a78bfa" },
  slate: { bg: "rgba(100,116,139,0.10)", fg: "#94a3b8" },
};

export default function Home() {
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    api.getUser()
      .then((u) => { if (u?.id) window.location.href = "/dashboard"; })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--ic-canvas)]">
        <div className="text-[14px] text-[var(--ic-ink-muted)]">載入中...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--ic-canvas)]">

      {/* ── Hero ──
           ★ 背景加一層極淡的橘色光暈（radial-gradient），
             讓 hero 和下面的白區有過渡，不是一條硬切。
             ★ logo 加大並加橘色 glow —— 品牌名是「熾台」，橙色就是熾。*/}
      <header
        className="relative overflow-hidden px-5 pt-16 pb-24"
        style={{
          background:
            "radial-gradient(120% 90% at 50% -10%, rgba(255,107,0,0.22) 0%, rgba(255,107,0,0) 55%)," +
            "linear-gradient(150deg, #1c1130 0%, #16213e 45%, #0f3460 100%)",
        }}
      >
        <div className="mx-auto flex max-w-4xl flex-col items-center text-center">
          <div className="flex flex-col items-center gap-3">
            <Image
              src="/logo.svg"
              alt="熾台 CHITAI"
              width={96}
              height={96}
              priority
              style={{ filter: "drop-shadow(0 0 28px rgba(255,107,0,0.55))" }}
            />
            <div className="flex flex-col items-center gap-1">
              <span className="text-[30px] font-[750] tracking-tight text-white">熾台</span>
              <span className="text-[11px] font-semibold uppercase tracking-[0.34em] text-white/50">CHITAI</span>
            </div>
          </div>

          {/* ★ 這裡用 <br/> 而不是 {"\n"}。
               上次用 {"\n"} 換行結果三段文字黏成一行 ——
               JSX 裡的 \n 不是斷行，只是一個空白字元。*/}
          <h1 className="mt-9 text-[clamp(30px,6vw,52px)] font-[750] leading-[1.22] tracking-tight text-white">
            直播互動工具
            <br />
            <span style={{ color: ORANGE }}>一次設定，全部掛上畫面</span>
          </h1>

          <p className="mt-6 max-w-[600px] text-[15px] leading-[1.9] text-white/70">
            不用安裝。每一個工具都是一個網址，貼進 OBS 的瀏覽來源就會出現在你的直播畫面。
          </p>
          <p className="mt-2 max-w-[600px] text-[15px] leading-[1.9] text-white/70">
            計費以<b style={{ color: ORANGE }}>子熙幣</b>儲值扣點，沒有月費、不綁方案。
          </p>

          <div className="mt-9 flex w-full max-w-[380px] flex-col gap-3">
            <a
              href="/api/auth/twitch"
              className="flex items-center justify-center gap-3 rounded-[12px] px-6 py-3.5 text-[15px] font-[650] text-white no-underline transition-all hover:brightness-110"
              style={{ background: "#9146ff" }}
            >
              <Gamepad2 size={20} /> 使用 Twitch 帳號開始
            </a>
            <a
              href="/api/auth/youtube"
              className="flex items-center justify-center gap-3 rounded-[12px] px-6 py-3.5 text-[15px] font-[650] text-[#111] no-underline transition-all hover:brightness-95"
              style={{ background: "#fff" }}
            >
              <TvMinimalPlay size={20} style={{ color: "#ff0033" }} /> 使用 Google 帳號開始
            </a>
          </div>

          {/* ★ 三個小標記取代原本那行小字 ——
               「免費工具不扣點」是賣點，不該用 12px 灰字帶過。*/}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[12px] text-white/55">
            <span className="flex items-center gap-1.5"><Zap size={13} style={{ color: ORANGE }} />六項工具不扣點</span>
            <span>隨時停用沒有合約</span>
            <span>不用重裝 OBS</span>
          </div>
        </div>
      </header>

      {/* ── 功能 ── */}
      <section className="mx-auto max-w-5xl px-5 py-20">
        <h2 className="text-center text-[26px] font-[700] tracking-tight text-[var(--ic-ink)]">
          開台前後要的工具，都在這裡
        </h2>
        <p className="mx-auto mt-3 max-w-[560px] text-center text-[14px] leading-[1.8] text-[var(--ic-ink-muted)]">
          我們只做直播互動。不做電商、不做活動報名、不做一堆你不會開的功能。
        </p>

        <div className="mt-11 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TOOLS.map((t) => {
            const Icon = t.icon;
            const tone = TONE[t.tone] || TONE.orange;
            return (
              <div
                key={t.title}
                className="group rounded-[14px] border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] p-6 transition-all hover:border-[var(--ic-hairline-strong)]"
                style={{ boxShadow: "0 1px 2px rgba(15,23,42,0.04)" }}
              >
                <div className="flex items-center justify-between gap-3">
                  <span
                    className="flex h-11 w-11 items-center justify-center rounded-[11px] transition-transform group-hover:scale-105"
                    style={{ background: tone.bg, color: tone.fg }}
                  >
                    <Icon size={21} strokeWidth={2.1} />
                  </span>
                  <span
                    className="rounded-full px-2.5 py-1 text-[11px] font-[600]"
                    style={{ background: tone.bg, color: tone.fg }}
                  >
                    {t.tag}
                  </span>
                </div>
                <h3 className="mt-5 text-[16px] font-[700] tracking-tight text-[var(--ic-ink)]">{t.title}</h3>
                <p className="mt-2 text-[13px] leading-[1.8] text-[var(--ic-ink-muted)]">{t.body}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── 三步驟 ──
           ★ 背景用橘色極淡底，與上下白色區隔開，
             且呼應品牌色（不用灰色分隔線）。*/}
      <section
        className="px-5 py-20"
        style={{ background: "linear-gradient(180deg, rgba(255,107,0,0.045) 0%, rgba(255,107,0,0.02) 100%)" }}
      >
        <div className="mx-auto max-w-4xl">
          <h2 className="text-center text-[26px] font-[700] tracking-tight text-[var(--ic-ink)]">
            三步開始，不用重裝 OBS
          </h2>
          <div className="mt-11 grid gap-5 sm:grid-cols-3">
              {STEPS.map((s, i) => (
                <div
                  key={s.t}
                className="rounded-[14px] border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] p-7"
              >
                <span
                  className="flex h-9 w-9 items-center justify-center rounded-full text-[15px] font-[750] text-white"
                  style={{ background: ORANGE }}
                >
                  {i + 1}
                </span>
                <h3 className="mt-5 text-[15px] font-[700] leading-[1.5] text-[var(--ic-ink)]">{s.t}</h3>
                <p className="mt-2 text-[13px] leading-[1.8] text-[var(--ic-ink-muted)]">{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 計費 ── */}
      <section className="mx-auto max-w-3xl px-5 py-20">
        <h2 className="text-center text-[26px] font-[700] tracking-tight text-[var(--ic-ink)]">
          計費方式
        </h2>

        <div
          className="mt-9 overflow-hidden rounded-[16px] border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)]"
        >
          <div
            className="flex items-center gap-4 p-7"
            style={{ background: "linear-gradient(100deg, rgba(255,107,0,0.08) 0%, rgba(255,107,0,0.02) 100%)" }}
          >
            <span
              className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[11px]"
              style={{ background: "rgba(255,107,0,0.12)", color: ORANGE }}
            >
              <Wallet size={21} />
            </span>
            <div>
              <h3 className="text-[17px] font-[700] tracking-tight text-[var(--ic-ink)]">子熙幣儲值扣點</h3>
              <p className="mt-1.5 text-[14px] leading-[1.85] text-[var(--ic-ink-muted)]">
                充值多少就用多少，用完再充。
                <b className="text-[var(--ic-ink)]">沒有月費、沒有方案分級、不綁合約</b>，
                不想用了就是不再充值，餘額留在那裡。
              </p>
            </div>
          </div>

          {/* ★ 用清單而不是 <ul> 專案原本的風格 ——
               兩行「免費 / 計點」的可預期性比排版更該被看見。*/}
          <div className="border-t border-[var(--ic-hairline-tertiary)] px-7 py-6">
            <div className="space-y-3 text-[13px] leading-[1.7] text-[var(--ic-ink-muted)]">
              <div className="flex gap-3">
                <span className="font-[700] text-[#0f9d58]">免費</span>
                <span>聊天室、即時字幕、直播指令、抽獎、OBS 輸出</span>
              </div>
              <div className="flex gap-3">
                <span className="font-[700]" style={{ color: ORANGE }}>計點</span>
                <span>回放分析 —— 依影片長度計，用多少扣多少</span>
              </div>
              <div className="flex gap-3">
                <span className="font-[700] text-[#8b5cf6]">直接付</span>
                <span>觀眾的斗內直接用子熙幣支付，不經過第三方金流</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 結尾 CTA ──
           ★ 與 hero 同一個橘色光暈 + 深底，形成首尾呼應。*/}
      <section
        className="relative overflow-hidden px-5 py-24 text-center"
        style={{
          background:
            "radial-gradient(120% 100% at 50% 110%, rgba(255,107,0,0.24) 0%, rgba(255,107,0,0) 60%)," +
            "linear-gradient(150deg, #16213e 0%, #0f3460 100%)",
        }}
      >
        <h2 className="text-[clamp(24px,4.5vw,36px)] font-[750] tracking-tight text-white">
          下一場直播就用得上
        </h2>
        <p className="mx-auto mt-5 max-w-[460px] text-[14px] leading-[1.85] text-white/65">
          登入後馬上能取得 OBS 來源網址，先把聊天室和字幕掛上試一次。
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <a
            href="/api/auth/twitch"
            className="inline-flex items-center gap-2 rounded-[12px] px-7 py-3.5 text-[15px] font-[650] text-white no-underline transition-all hover:brightness-110"
            style={{ background: "#9146ff" }}
          >
            <Gamepad2 size={18} /> Twitch 登入 <ArrowRight size={16} />
          </a>
          <a
            href="/api/auth/youtube"
            className="inline-flex items-center gap-2 rounded-[12px] px-7 py-3.5 text-[15px] font-[650] text-[#111] no-underline transition-all hover:brightness-95"
            style={{ background: "#fff" }}
          >
            <TvMinimalPlay size={18} style={{ color: "#ff0033" }} /> Google 登入 <ArrowRight size={16} />
          </a>
        </div>
        <p className="mt-10 text-[12px] text-white/30">熾台 CHITAI · 直播互動工具</p>
      </section>
    </div>
  );
}
