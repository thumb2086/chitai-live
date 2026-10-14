"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import {
  Gamepad2, TvMinimalPlay, MessageSquare, Captions, Heart,
  Terminal, Trophy, Clapperboard, Monitor, Wallet, ArrowRight,
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
 * ★ 這頁寫的是**我們真的有的功能**（對照 Sidebar 的 15 條），
 *   不是競品的功能清單。少寫一個不存在的功能，比多寫一個更誠實。
 *
 * ★ 沒有寫「免費開源」：專案沒有 LICENSE 檔，宣稱開源是無憑據的。
 */
const TOOLS = [
  {
    icon: Captions,
    title: "即時字幕",
    body: "逐句浮現的即時字幕，繁中、英文、混合都認得。OBS 放一個瀏覽來源就上線。",
    tag: "免費",
  },
  {
    icon: MessageSquare,
    title: "聊天室",
    body: "把觀眾留言直接放進直播畫面，可調主題、字級與顯示筆數。",
    tag: "免費",
  },
  {
    icon: Heart,
    title: "斗內通知與進度條",
    body: "收到子熙幣立刻在畫面彈出提示；想追募款就加一條進度條，觀眾看得到差多少。",
    tag: "子熙幣",
  },
  {
    icon: Terminal,
    title: "直播指令與抽獎",
    body: "觀眾打 !簽到 !點歌 !抽獎 就會觸發。抽獎可設資格、亂數抽出並自動公布。",
    tag: "免費",
  },
  {
    icon: Clapperboard,
    title: "回放分析",
    body: "丟一段回放上來，自動標出聊天室提問高峰與互動熱點，剪輯時不用從頭看到尾。",
    tag: "計點",
  },
  {
    icon: Monitor,
    title: "OBS 輸出",
    body: "每個工具都是一個網址，貼進 OBS 的瀏覽來源就能用，不用安裝任何東西。",
    tag: "免費",
  },
];

const STEPS = [
  { n: "1", t: "用 Twitch 或 Google 帳號登入", d: "不用另外註冊，也不用填密碼。" },
  { n: "2", t: "連接你的直播頻道", d: "授權之後就能讀取直播狀態與觀眾留言。" },
  { n: "3", t: "把工具網址貼進 OBS", d: "聊天室、字幕、斗內提示各自一個來源，開台就能用。" },
];

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
      {/* ── Hero ── */}
      <header
        className="px-5 pt-14 pb-20"
        style={{ background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)" }}
      >
        <div className="mx-auto flex max-w-4xl flex-col items-center text-center">
          <div className="flex flex-col items-center gap-2">
            <Image
              src="/logo.svg"
              alt="熾台 CHITAI"
              width={72}
              height={72}
              priority
              className="drop-shadow-[0_0_20px_theme(colors.orange.500/0.5)]"
            />
            <span className="text-[26px] font-[650] tracking-tight text-white">熾台</span>
            <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/45">CHITAI</span>
          </div>

          <h1 className="mt-7 text-[clamp(28px,5.5vw,46px)] font-[650] leading-[1.15] text-white">直播互動工具，一次設定{"\n"}聊天室、字幕、斗內都在畫面上</h1>

          {/* ★ JSX 裡文字和元素之間的換行會被折成一個空格。
              原本寫成
                計費以<b>子熙幣</b>儲值扣點
              三行，畫面上變成「計費以 子熙幣儲值扣點」，多一個空格。
              用 {"\n"} 明確斷行，或把整句放同一行。*/}
          <p className="mt-5 max-w-[620px] text-[15px] leading-[1.75] text-white/70">不用安裝。每一個工具都是一個網址，貼進 OBS 的瀏覽來源就會出現在你的直播畫面。{"\n"}計費以<b className="text-white/90">子熙幣</b>儲值扣點，沒有月費、不綁方案。</p>

          <div className="mt-8 flex w-full max-w-[360px] flex-col gap-3">
            <a
              href="/api/auth/twitch"
              className="flex items-center justify-center gap-3 rounded-[12px] bg-[#9146ff] px-6 py-3.5 text-[15px] font-[600] text-white no-underline transition-all hover:bg-[#7c3aed]"
            >
              <Gamepad2 size={20} /> 使用 Twitch 帳號開始
            </a>
            <a
              href="/api/auth/youtube"
              className="flex items-center justify-center gap-3 rounded-[12px] bg-white px-6 py-3.5 text-[15px] font-[600] text-[#111] no-underline transition-all hover:bg-gray-100"
            >
              <TvMinimalPlay size={20} className="text-[#ff0033]" /> 使用 Google 帳號開始
            </a>
          </div>

          <p className="mt-5 text-[12px] text-white/35">
            免費工具不扣點 · 進階功能才計點 · 隨時停用沒有合約
          </p>
        </div>
      </header>

      {/* ── 功能 ── */}
      <section className="mx-auto max-w-5xl px-5 py-16">
        <h2 className="text-center text-[24px] font-[650] text-[var(--ic-ink)]">
          開台前後要的工具，都在這裡
        </h2>
        <p className="mx-auto mt-3 max-w-[560px] text-center text-[14px] leading-[1.7] text-[var(--ic-ink-muted)]">
          我們只做直播互動。不做電商、不做活動報名、不做一堆你不會開的功能。
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TOOLS.map((t) => {
            const Icon = t.icon;
            return (
              <div
                key={t.title}
                className="rounded-[14px] border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] p-5"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-[var(--ic-surface-3)]">
                    <Icon size={20} className="text-[var(--ic-fin-orange)]" />
                  </span>
                  <span className="rounded-full border border-[var(--ic-hairline)] bg-[var(--ic-surface-3)] px-2.5 py-1 text-[11px] font-[500] text-[var(--ic-ink-muted)]">
                    {t.tag}
                  </span>
                </div>
                <h3 className="mt-4 text-[16px] font-[650] text-[var(--ic-ink)]">{t.title}</h3>
                <p className="mt-2 text-[13px] leading-[1.7] text-[var(--ic-ink-muted)]">{t.body}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── 三步驟 ── */}
      <section
        className="px-5 py-16"
        style={{ background: "linear-gradient(135deg, #f5f7fb 0%, #eef2f7 100%)" }}
      >
        <div className="mx-auto max-w-4xl">
          <h2 className="text-center text-[24px] font-[650] text-[var(--ic-ink)]">
            三步開始，不用重裝 OBS
          </h2>
          <div className="mt-10 grid gap-5 sm:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n} className="rounded-[14px] border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] p-6">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--ic-fin-orange)] text-[14px] font-[700] text-white">
                  {s.n}
                </span>
                <h3 className="mt-4 text-[15px] font-[650] text-[var(--ic-ink)]">{s.t}</h3>
                <p className="mt-2 text-[13px] leading-[1.7] text-[var(--ic-ink-muted)]">{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 計費 ── */}
      <section className="mx-auto max-w-4xl px-5 py-16">
        <h2 className="text-center text-[24px] font-[650] text-[var(--ic-ink)]">
          計費方式
        </h2>
        <div className="mt-8 rounded-[16px] border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] p-7">
          <div className="flex items-start gap-4">
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[10px] bg-[var(--ic-surface-3)]">
              <Wallet size={20} className="text-[var(--ic-fin-orange)]" />
            </span>
            <div>
              <h3 className="text-[16px] font-[650] text-[var(--ic-ink)]">子熙幣儲值扣點</h3>
              <p className="mt-2 text-[14px] leading-[1.75] text-[var(--ic-ink-muted)]">
                充值多少就用多少，用完再充。<b className="text-[var(--ic-ink)]">沒有月費、沒有方案分級、不綁合約</b>，
                不想用了就是不再充值，餘額留在那裡。
              </p>
              <ul className="mt-4 space-y-2 text-[13px] leading-[1.7] text-[var(--ic-ink-muted)]">
                <li>· 聊天室、即時字幕、直播指令、抽獎、OBS 輸出 —— <b className="text-[var(--ic-ink)]">不扣點</b></li>
                <li>· 回放分析 —— 依影片長度計點，用多少扣多少</li>
                <li>· 觀眾的斗內直接用子熙幣支付，不經過第三方金流</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── 結尾 CTA ── */}
      <section
        className="px-5 py-20 text-center"
        style={{ background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)" }}
      >
        <h2 className="text-[clamp(22px,4vw,32px)] font-[650] text-white">
          下一場直播就用得上
        </h2>
        <p className="mx-auto mt-4 max-w-[480px] text-[14px] leading-[1.7] text-white/65">
          登入後馬上能取得 OBS 來源網址，先把聊天室和字幕掛上試一次。
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <a
            href="/api/auth/twitch"
            className="inline-flex items-center gap-2 rounded-[12px] bg-[#9146ff] px-7 py-3.5 text-[15px] font-[600] text-white no-underline transition-all hover:bg-[#7c3aed]"
          >
            <Gamepad2 size={19} /> Twitch 登入 <ArrowRight size={17} />
          </a>
          <a
            href="/api/auth/youtube"
            className="inline-flex items-center gap-2 rounded-[12px] bg-white px-7 py-3.5 text-[15px] font-[600] text-[#111] no-underline transition-all hover:bg-gray-100"
          >
            <TvMinimalPlay size={19} className="text-[#ff0033]" /> Google 登入 <ArrowRight size={17} />
          </a>
        </div>
        <p className="mt-8 text-[12px] text-white/30">熾台 CHITAI · 直播互動工具</p>
      </section>
    </div>
  );
}