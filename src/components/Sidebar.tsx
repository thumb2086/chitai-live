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
  // ★ 2026-10-14：兩個來源。
//   · /api/v1/user            → 身分（名字、頭像）
//   · /api/v1/zixi/proxy     → 子熙幣餘額（wallet-summary）
//
//   原本的第二個來源是 /api/v1/membership。會員制砍掉之後那三行
//   （方案名／字幕分鐘數／新制點數）沒有對應的計價方式，
//   顯示的是沒有意義的殘骸，不是「還沒接上」的狀態。
//
//   為什麼餘額要另外抓而不是從 user 帶出來：餘額在 ZIXI 那邊的 D1，
//   我們這邊只有 OAuth access token，要透過 proxy 才拿得到。
type WalletState =
  | { state: "loading" }
  | { state: "disconnected" }
  | { state: "error" }
  | { state: "ok"; zxc: number; yjc: number };

const [user, setUser] = useState<{
    name?: string;
    avatar?: string;
  }>({});
  const [wallet, setWallet] = useState<WalletState>({ state: "loading" });
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    api.getUser()
      .then((u) => setUser((prev) => ({ ...prev, name: u?.name, avatar: u?.avatar })))
      .catch(() => {});

    // ★ 原本這裡抓 /api/v1/membership，顯示「方案名 + 字幕分鐘數」。
    //   會員制在 2026-10-14 砍掉了，那三行（FREE／0/120／新制點數尚未啟用）
    //   全是沒有意義的殘骸。
    //
    //   換成「子熙幣餘額」—— 那是使用者真正會想知道的事，
    //   而且對應到我們實際的計價方式（儲值扣點）。
    fetch("/api/v1/zixi/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "wallet-summary" }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((w) => {
        if (!w) return;
        if (w.connected === false || !w.summary?.balances) {
          setWallet({ state: "disconnected" });
          return;
        }
        const zxc = Number(w.summary.balances.ZXC ?? 0);
        const yjc = Number(w.summary.balances.YJC ?? 0);
        setWallet({ state: "ok", zxc, yjc });
      })
      .catch(() => setWallet({ state: "error" }));
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
        {/* ★ 會員制在 2026-10-14 砍掉了（金流改子熙幣儲值扣點），
            所以這顆選單的名字跟 aria 標籤都不能再寫「會員」。

            ★ 這裡必須是 JSX 註解語法，不能用雙斜線：
              JSX children 位置的雙斜線不是註解，是**文字**。
              之前寫錯的時候，這段字整句出現在線上畫面上，
              而且建置完全不會報錯 —— JSX 裡的雙斜線是合法文字內容。
              只能執行才看得到，跟那次的 route() 一模一樣。*/}
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
              {/* ★ 原本這裡是方案名（FREE / PRO / ULTRA）。會員制砍掉後
                  它沒有對應的計價方式 —— 顯示一個永遠不會變的字串
                  只會讓人以為「方案」還存在。改成連線狀態。*/}
              <small>
                {wallet.state === "ok"
                  ? "子熙幣已連線"
                  : wallet.state === "loading"
                    ? "載入中"
                    : wallet.state === "disconnected"
                      ? "子熙幣未連線"
                      : wallet.state === "error"
                        ? "餘額查詢失敗"
                        : ""}
              </small>
            </span>
            <span className="member-chevron" aria-hidden="true">
              ⌃
            </span>
          </span>
          {/* ★ 原本是「字幕分鐘數 0/120」+「新制點數尚未啟用」。
              兩行都在講一個已經不存在的會員制。
              現在顯示的是使用者真正會想知道的事：我還有多少子熙幣。*/}
          <span className="member-points-ribbon">
            <span>子熙幣餘額</span>
            <span>
              {wallet.state === "ok" ? (
                <strong>
                  ZXC {wallet.zxc.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </strong>
              ) : wallet.state === "loading" ? (
                <strong>—</strong>
              ) : wallet.state === "disconnected" ? (
                /* 這個連結的顏色不需要另外指定：
                   .member-points-ribbon 本身就是 color:#c8f7e9（淺色配深青底），
                   而全站的 a{color:inherit} 會讓它繼承那個顏色 —— 可讀。
                   只有「看起來不像連結」需要處理，所以補下劃線（inline，
                   原因同 public-page 那次：工具類輸給 0-1-1 的 a{color:inherit}）。*/
                <strong>
                  <Link href="/dashboard/zixi" data-link=""
                    style={{ textDecoration: "underline", textUnderlineOffset: "2px" }}>
                    去連線 ›
                  </Link>
                </strong>
              ) : (
                <strong>
                  <Link href="/dashboard/zixi" data-link=""
                    style={{ textDecoration: "underline", textUnderlineOffset: "2px" }}>
                    重試 ›
                  </Link>
                </strong>
              )}
            </span>
          </span>
          {wallet.state === "ok" && wallet.yjc > 0 && (
            <small className="member-expiry">
              YJC {wallet.yjc.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </small>
          )}
        </button>
      </div>
    </>
  );
}
