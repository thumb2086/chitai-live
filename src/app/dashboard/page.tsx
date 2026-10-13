"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Globe, Cable, MessageSquare, Target, Bell, Monitor, FlaskConical,
  BarChart3, Terminal, Trophy, Wallet, Check, ArrowRight, Gift, type LucideIcon,
} from "lucide-react";
import { api } from "@/lib/api";
import { Loading, Badge } from "@/components/ui";

type Feature = {
  label: string;
  href: string;
  icon: LucideIcon;
  status: (d: any) => { ready: boolean; text: string };
};

const FEATURES: Feature[] = [
  { label: "觀眾斗內頁設定", href: "/dashboard/public-page", icon: Globe, status: (d) => ({ ready: !!d?.publicPage, text: d?.publicPage ? "已啟用" : "未啟用" }) },
  { label: "平台串接", href: "/dashboard/connections", icon: Cable, status: (d) => {
      const on = ["twitch", "youtube"].filter((p) => d?.conn?.[p]?.connected);
      return { ready: on.length > 0, text: on.length ? on.join(" / ") : "未串接" };
    } },
  { label: "聊天室", href: "/dashboard/chat", icon: MessageSquare, status: (d) => ({ ready: !!overlayOn(d, "chat"), text: overlayOn(d, "chat") ? "已啟用" : "已停用" }) },
  { label: "斗內進度條", href: "/dashboard/donations", icon: Target, status: (d) => {
      const n = d?.don?.goals?.length ?? 0;
      return { ready: n > 0, text: n ? `${n} 個目標` : "未設定" };
    } },
  { label: "斗內通知", href: "/dashboard/donations/alerts", icon: Bell, status: (d) => ({ ready: !!overlayOn(d, "donation-alert"), text: overlayOn(d, "donation-alert") ? "已啟用" : "已停用" }) },
  { label: "即時字幕", href: "/dashboard/subtitles", icon: MessageSquare, status: (d) => ({ ready: !!overlayOn(d, "captions"), text: overlayOn(d, "captions") ? "已啟用" : "已停用" }) },
  { label: "同時觀看人數", href: "/dashboard/live-viewers", icon: BarChart3, status: (d) => ({ ready: !!overlayOn(d, "live-viewers"), text: overlayOn(d, "live-viewers") ? "已啟用" : "已停用" }) },
  { label: "即時比分板", href: "/dashboard/scoreboard", icon: Trophy, status: (d) => ({ ready: !!overlayOn(d, "scoreboard"), text: overlayOn(d, "scoreboard") ? "已啟用" : "已停用" }) },
  { label: "OBS 輸出", href: "/dashboard/obs", icon: Monitor, status: (d) => {
      const on = (d?.obs ?? []).filter((s: any) => s.enabled).length;
      return { ready: on > 0, text: `${on} 個啟用` };
    } },
  { label: "直播指令機器人", href: "/dashboard/commands", icon: Terminal, status: (d) => {
      const n = d?.commands?.length ?? 0;
      return { ready: n > 0, text: n ? `${n} 個指令` : "尚未建立" };
    } },
  { label: "抽獎活動", href: "/dashboard/giveaways", icon: Gift, status: (d) => {
      const gs = d?.giveaways ?? [];
      const open = gs.filter((g: any) => g.enabled).length;
      const total = gs.reduce((n: number, g: any) => n + (g.entrants?.length ?? 0), 0);
      return { ready: open > 0, text: open > 0 ? `${open} 個進行中 · ${total} 報名` : gs.length ? "全部停用" : "尚未建立" };
    } },
  { label: "斗內紀錄", href: "/dashboard/donations/records", icon: Trophy, status: () => ({ ready: true, text: "查看" }) },
  { label: "ZIXI 錢包", href: "/dashboard/zixi", icon: Wallet, status: (d) => ({ ready: !!d?.user?.zixiWallet, text: d?.user?.zixiWallet ? "已設定" : "未設定" }) },
];

const STEPS = [
  { num: 1, title: "串接你的平台", desc: "連結 Twitch 或 YouTube 帳號", href: "/dashboard/connections" },
  { num: 2, title: "設定疊加層", desc: "聊天室、字幕、斗內進度條", href: "/dashboard/chat" },
  { num: 3, title: "串接 ZIXI 錢包", desc: "接收 ZXC / YJC 贊助", href: "/dashboard/zixi" },
  { num: 4, title: "輸出到 OBS", desc: "取得 Browser Source 網址", href: "/dashboard/obs" },
];

function overlayOn(d: any, key: string) {
  return (d?.obs ?? []).find((s: any) => s.key === key)?.enabled === true;
}

export default function DashboardPage() {
  const [data, setData] = useState<any>(null);
  const [onboard, setOnboard] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.getOnboard().catch(() => null),
      api.getUser().catch(() => null),
      api.getConnections().catch(() => ({})),
      api.getDonations().catch(() => null),
      api.getCommands().catch(() => null),
      fetch("/api/v1/obs").then((r) => r.json()).catch(() => ({ sources: [] })),
      api.getGiveaways().catch(() => null),
    ])
      .then(([o, u, c, don, cmd, obs, gw]) => {
        setOnboard(o);
        setData({
          user: u,
          conn: c,
          don,
          commands: cmd?.commands ?? [],
          obs: (obs as any).sources ?? [],
          giveaways: gw?.giveaways ?? [],
        });
      })
      .finally(() => setLoading(false));
  }, []);

  const toggleStep = async (idx: number) => {
    if (!onboard) return;
    const key = `step${idx + 1}`;
    const next = { ...onboard, [key]: !onboard[key] };
    setOnboard(next);
    const saved = await api.saveOnboard(next).catch(() => next);
    setOnboard(saved);
  };

  if (loading) return <Loading />;

  const doneCount = onboard
    ? [onboard.step1, onboard.step2, onboard.step3, onboard.step4].filter(Boolean).length
    : 0;
  const allDone = doneCount === STEPS.length;
  const name = data?.user?.name;

  return (
    <>
      <header className="creator-profile-header">
        <div>
          <h1>控制中心</h1>
          <p className="subtitle">
            {name ? `${name}，歡迎回來。` : "歡迎回來。"}
            {allDone ? "所有功能都已就緒，可以開始直播了。" : "完成下面的快速開始，就可以開始直播。"}
          </p>
        </div>
        {allDone ? (
          <Badge tone="ok">
            <Check size={13} /> 全部就緒
          </Badge>
        ) : (
          <Badge tone="neutral">進行中 {doneCount}/{STEPS.length}</Badge>
        )}
      </header>

      <section className="feature-locked-page">
        <div className="section-heading">
          <h2>快速開始</h2>
          <span className="settings-note">{doneCount} / {STEPS.length}</span>
        </div>

        <div className="feature-grid-mini">
          {STEPS.map((step, idx) => {
            const done = onboard ? onboard[`step${idx + 1}`] : false;
            return (
              <div className={`feature-card ${done ? "is-complete" : ""}`} key={step.num}>
                <div className="section-title-row">
                  <span className={`member-badge ${done ? "status-ok" : ""}`}>
                    {done ? <Check size={13} /> : step.num}
                  </span>
                  <button
                    type="button"
                    className="ghost-link"
                    onClick={() => toggleStep(idx)}
                  >
                    {done ? "取消完成" : "標記完成"}
                  </button>
                </div>
                <Link href={step.href} className="feature-card-link">
                  <strong>{step.title}</strong>
                  <span className="row-subtitle">{step.desc}</span>
                  <span className="row-meta">
                    <ArrowRight size={14} />
                  </span>
                </Link>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <div className="section-heading">
          <h2>功能總覽</h2>
          <span className="settings-note">{FEATURES.length} 個模組</span>
        </div>

        <div className="feature-grid">
          {FEATURES.map((f) => {
            const st = f.status(data);
            const Icon = f.icon;
            return (
              <Link key={f.href} href={f.href} className="feature-card-link">
                <article className="feature-card">
                  <div className="section-title-row">
                    <span className="member-badge">
                      <Icon size={16} />
                    </span>
                    <Badge tone={st.ready ? "ok" : "neutral"}>{st.text}</Badge>
                  </div>
                  <strong className="row-title">{f.label}</strong>
                  <span className="row-subtitle">{f.href}</span>
                </article>
              </Link>
            );
          })}
        </div>
      </section>
    </>
  );
}