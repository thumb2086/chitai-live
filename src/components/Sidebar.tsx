"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Globe, Cable, Clapperboard, UserCog, Monitor,
  Bell, ScrollText, Target, Trophy,
  MessageSquare, Captions, Terminal,
  Wallet, Heart,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/lib/api";

type Section = { title: string; links: { label: string; href: string; icon: LucideIcon }[] };

/* ★ 2026-10-14：31 條砍成 15 條。
 *
 * 砍掉的理由不是「功能壞了」，是我們決定不做（過多功能、過於花俏，
 * 或與「金流全面改子熙幣」衝突）。頁面本身沒有刪，搬到
 * src/app/_archive/ —— Next.js 的私有資料夾，自動脫離路由。
 *
 * 分組也重排了：原本 6 組 31 條，沒有人能在裡面找到自己要的東西。
 * 現在按「開台前 → 直播中 → 收錢 → 事後」這個實際順序排。
 */
const SECTIONS: Section[] = [
  {
    title: "開台前",
    links: [
      { label: "觀眾斗內頁", href: "/dashboard/public-page", icon: Globe },
      { label: "平台授權", href: "/dashboard/connections", icon: Cable },
      { label: "OBS 輸出", href: "/dashboard/obs", icon: Monitor },
    ],
  },
  {
    title: "直播中",
    links: [
      { label: "聊天室", href: "/dashboard/chat", icon: MessageSquare },
      { label: "即時字幕", href: "/dashboard/subtitles", icon: Captions },
      { label: "直播指令", href: "/dashboard/commands", icon: Terminal },
      // ★ 抽獎本來就有頁面，但從來沒出現在選單裡 ——
      //   做了卻沒人進得去。2026-10-14 補上。
      { label: "抽獎活動", href: "/dashboard/giveaways", icon: Trophy },
    ],
  },
  {
    title: "斗內",
    links: [
      { label: "斗內通知", href: "/dashboard/donations/alerts", icon: Bell },
      { label: "斗內進度條", href: "/dashboard/donations", icon: Target },
      { label: "斗內紀錄", href: "/dashboard/donations/records", icon: ScrollText },
    ],
  },
  {
    title: "事後與帳戶",
    links: [
      { label: "回放分析", href: "/dashboard/replay-analysis", icon: Clapperboard },
      { label: "子熙幣錢包", href: "/dashboard/zixi", icon: Wallet },
      { label: "捐款記錄", href: "/dashboard/zixi/donations", icon: Heart },
      { label: "帳戶設定", href: "/dashboard/account", icon: UserCog },
    ],
  },
];

const MENU_LINKS = [
  { label: "子熙幣錢包", href: "/dashboard/zixi" },
  { label: "帳戶設定", href: "/dashboard/account" },
];

export default function Sidebar() {
  const pathname = usePathname();
  // Two sources on purpose: /api/v1/user for identity, /api/v1/membership for
  // the plan that is actually GRANTED plus real quota.
  //
  // The previous version read User.chosenPlan -- a legacy column whose default is
  // the localized string for "starter" and which nothing updates when a
  // subscription is paid -- and read `aiPoints`, a field that does not exist on
  // the model at all. So the ribbon always rendered its fallback and the plan
  // label always read "<chosenPlan> · <localized legacy>".
  const [user, setUser] = useState<{
    name?: string;
    avatar?: string;
    plan?: string;
    captionMinutes?: string;
  }>({});
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    api.getUser()
      .then((u) => setUser((prev) => ({ ...prev, name: u?.name, avatar: u?.avatar })))
      .catch(() => {});

    fetch("/api/v1/membership")
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => {
        if (!m) return;
        const caption = (m.quotas ?? []).find((q: any) => q.metric === "caption_minutes");
        setUser((prev) => ({
          ...prev,
          plan: String(m.effectivePlan ?? "free").toUpperCase(),
          captionMinutes: caption
            ? `${Math.round(caption.used)} / ${caption.limit.toLocaleString()}`
            : undefined,
        }));
      })
      .catch(() => {});
  }, []);

  // Close the account popover whenever the route changes.
  useEffect(() => setMenuOpen(false), [pathname]);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
  };

  return (
    <>
      <div className="member-sidebar-scroll">
        {SECTIONS.map((section) => (
          <section className="sidebar-section" key={section.title}>
            <p className="sidebar-section-title">
              <span className="sidebar-section-dot" aria-hidden="true" />
              {section.title}
            </p>
            <div className="sidebar-link-list">
              {section.links.map((link) => {
                const active = isActive(link.href);
                const Icon = link.icon;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    data-link=""
                    className={`sidebar-link${active ? " is-active" : ""}`}
                    aria-current={active ? "page" : undefined}
                  >
                    <span className="sidebar-link-icon" aria-hidden="true">
                      <Icon size={18} strokeWidth={2.15} />
                    </span>
                    <span className="sidebar-link-label">{link.label}</span>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <div className="member-account">
        // ★ 會員制在 2026-10-14 砍掉了（金流改子熙幣儲值扣點），
//   所以這顆選單的名字跟 aria 標籤都不能再寫「會員」。
<div id="member-account-menu" className="member-account-menu" hidden={!menuOpen}>
          <p>帳戶</p>
          <nav aria-label="帳戶">
            {MENU_LINKS.map((l) => (
              <Link key={l.href} href={l.href} data-link="">
                {l.label}
              </Link>
            ))}
            <button type="button" onClick={logout}>
              登出
            </button>
          </nav>
        </div>

        <button
          type="button"
          className="member-account-trigger"
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
          aria-controls="member-account-menu"
          aria-label={menuOpen ? "關閉帳戶選單" : "開啟帳戶選單"}
        >
          <span className="member-account-identity">
            <span className="member-avatar" aria-hidden="true">
              {user.avatar ? <img src={user.avatar} alt="" /> : user.name?.charAt(0) || "?"}
            </span>
            <span>
              <strong>{user.name || "未登入"}</strong>
              <small>{user.plan || "Free"}</small>
            </span>
            <span className="member-chevron" aria-hidden="true">
              ⌃
            </span>
          </span>
          <span className="member-points-ribbon">
            <span>字幕分鐘數</span>
            <span>
              <strong>{user.captionMinutes ?? "—"}</strong>
            </span>
          </span>
          <small className="member-expiry">新制點數尚未啟用</small>
        </button>
      </div>
    </>
  );
}
