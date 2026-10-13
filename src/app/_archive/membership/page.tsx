"use client";

import { useState } from "react";
import Link from "next/link";
import { Crown, Gauge, Receipt, CreditCard, ChevronDown, LogOut, User as UserIcon, RefreshCw } from "lucide-react";
import { Loading, ErrorBox, useAsync } from "@/components/ui";
import { formatPrice } from "@/lib/plans";

/**
 * Membership centre.
 *
 * Markup follows livio's `.member-*` family.
 *
 * Deliberately absent: `.member-balance` (wallet), `.member-points-ribbon`,
 * `.member-point-split`, `.member-plan-points`. Those need a points ledger and
 * a payment rail, neither of which exists here -- rendering them would be a
 * number on screen that nothing can ever move. `.member-ai-rates` is reused
 * for the real per-event usage table instead.
 *
 * The header shows `effectivePlan`, NOT `subscription.planKey`. A stored planKey
 * is a *request*; until payment settles it grants nothing, so showing the stored
 * key here would tell an unpaid user they are on the tier they are paying for.
 */

type Quota = { metric: string; label: string; limit: number; unit: string; used: number };
type Invoice = { id: string; number: string; amount: number; tax: number; status: string; period: string; issuedAt: string };
type UsageEvent = { id: string; metric: string; quantity: number; note: string; createdAt: string };

type Payload = {
  subscription: { planKey: string; billingMode: string; status: string; currentPeriodEnd: string | null };
  effectivePlan: string;
  pendingUpgrade: boolean;
  quotas: Quota[];
  invoices: Invoice[];
  usage: UsageEvent[];
  account: { name: string; username: string; email: string; avatar: string };
  periodStart: string;
};

const INVOICE_STATUS: Record<string, string> = {
  paid: "已付款", pending: "待付款", failed: "付款失敗", refunded: "已退款",
};

export default function MembershipPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { data, loading, error, reload } = useAsync<Payload>(
    () => fetch("/api/v1/membership").then((r) => { if (!r.ok) throw new Error("載入失敗"); return r.json(); }),
    []
  );

  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} />;

  const sub = data?.subscription;
  const activePlan = data?.effectivePlan ?? "free";
  const pendingUpgrade = data?.pendingUpgrade ?? false;
  const invoices = data?.invoices ?? [];
  const usage = data?.usage ?? [];
  const account = data?.account;

  const paid = invoices.filter((i) => i.status === "paid");
  const outstanding = invoices.filter((i) => i.status === "pending");
  const paidTotal = paid.reduce((a, i) => a + i.amount, 0);

  const initial = (account?.name || account?.username || "?").trim().charAt(0).toUpperCase();

  return (
    <div className="member-page">
      {/* ------------------------------------------------ head */}
      <header className="member-membership-head member-page-header">
        <div>
          <h1>會員中心</h1>
          <p className="member-muted">
            查看目前的方案狀態、用量額度與帳務記錄。
          </p>
        </div>
        <div className="member-page-links">
          <span className="member-badge">{activePlan.toUpperCase()}</span>
          {activePlan === "free" ? (
            <span className="member-expiry">免費方案無續約日</span>
          ) : (
            sub?.currentPeriodEnd && (
              <span className="member-expiry">
                到期 {new Date(sub.currentPeriodEnd).toLocaleDateString("zh-TW")}
              </span>
            )
          )}
        </div>
      </header>

      {/* An unpaid upgrade must read as "not granted", never as the new tier. */}
      {pendingUpgrade && (
        <div className="member-notice">
          <strong>方案變更尚未完成付款，目前仍使用免費方案的額度。</strong>
          <p>
            你選擇的是 <strong>{sub?.planKey?.toUpperCase()}</strong>，但在款項結清之前，
            疊加層數、字幕分鐘數與 AI 點數都還是按 Free 計算。
            {outstanding.length > 0 && (
              <>
                {" "}待付金額 {formatPrice(outstanding[0].amount)}（單號 {outstanding[0].number}）。
              </>
            )}
          </p>
          <Link href="/dashboard/membership/billing">前往付款</Link>
        </div>
      )}

      <nav className="member-subnav">
        <Link href="/dashboard/subscription">訂閱方案</Link>
        <Link href="/dashboard/membership/usage">用量與點數紀錄</Link>
        <Link href="/dashboard/membership/billing">付款與發票</Link>
        <button type="button" onClick={() => void reload()}>
          <RefreshCw size={14} /> 重新整理
        </button>
      </nav>

      {/* ------------------------------------------------ body */}
      <div className="member-balance-grid">
        <section className="member-card">
          <div className="member-page-links">
            <h2>本期用量</h2>
            <span className="member-muted">
              計費週期自 {new Date(data?.periodStart ?? Date.now()).toLocaleDateString("zh-TW")} 起算
            </span>
          </div>

          {(data?.quotas ?? []).map((q) => {
            const pct = q.limit > 0 ? Math.min(100, Math.round((q.used / q.limit) * 100)) : 0;
            const over = q.used > q.limit;
            return (
              <div key={q.metric} style={{ marginTop: 18 }}>
                <div className="member-page-links" style={{ marginBottom: 7 }}>
                  <strong>{q.label}</strong>
                  <span className={over ? "replay-analysis-card-error" : "member-muted"}>
                    {q.used.toLocaleString()} / {q.limit.toLocaleString()} {q.unit}
                  </span>
                </div>
                {/* `.usage-progress-*` is the stylesheet's own quota meter -- track, fill and
                    header are all defined there, so no inline geometry is needed.
                    `.is-empty` is its muted state; over-quota keeps the danger
                    colour so an over-limit meter still reads as a problem. */}
                <div className="usage-progress-track">
                  <div
                    className="usage-progress-fill"
                    style={{ width: `${pct}%`, ...(over ? { background: "var(--ic-danger)" } : {}) }}
                  />
                </div>
                {over && q.metric === "overlay" && (
                  /* Not a billing state. Nobody is being charged and nothing is
                     blocked -- the catalogue simply holds more overlays than the
                     free plan nominally allows. Say so instead of "upgrade". */
                  <p className="member-expiry">
                    疊加層數是「同時存在」的上限，不是用量。系統目前提供 11 種疊加層，
                    而 {activePlan.toUpperCase()} 方案的額度是 {q.limit}。目前全部都可用，
                    沒有因為超過數字而停用任何功能。
                  </p>
                )}
                {over && q.metric !== "overlay" && (
                  <p className="replay-analysis-card-error">已超出目前方案額度，請升級方案。</p>
                )}
              </div>
            );
          })}
        </section>

        <aside className="member-side-cards">
          <div className="member-card member-sidebar-scroll">
            <div className="member-memberships">
              <div>
                <span className="member-muted">已付款單</span>
                <strong className="member-balance">{formatPrice(paidTotal)}</strong>
                <small className="member-muted">{paid.length} 張</small>
              </div>
              <div>
                <span className="member-muted">待付款單</span>
                <strong className="member-balance">{outstanding.length}</strong>
                <small className="member-muted">{outstanding.length ? "需處理" : "無待付款"}</small>
              </div>
            </div>

            <p className="member-muted" style={{ marginTop: 16 }}>
              字幕轉錄與回放分析都算在「字幕分鐘數」與「AI 點數」額度內，超過後會暫停服務直到下個計費週期。
            </p>

            <div className="action-row" style={{ marginTop: 14 }}>
              <Link href="/dashboard/subscription"><CreditCard size={15} /> 比較方案</Link>
              <Link href="/dashboard/membership/usage"><Gauge size={15} /> 用量明細</Link>
              <Link href="/dashboard/membership/billing"><Receipt size={15} /> 帳務</Link>
            </div>
          </div>

          {/* Account menu: real DB identity, read-only. */}
          <div className="member-account">
            <button
              type="button"
              className="member-account-trigger"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
            >
              <span className="member-avatar">
                {account?.avatar ? <img src={account.avatar} alt="" /> : initial}
              </span>
              <span className="member-account-identity">
                <span />
                <span>
                  <strong>{account?.name || "未設定名稱"}</strong>
                  <small className="member-muted">@{account?.username || "—"}</small>
                </span>
              </span>
              <ChevronDown className="member-chevron" />
            </button>

            {menuOpen && (
              <div className="member-account-menu">
                <p>
                  <UserIcon size={13} /> {account?.email || "尚未設定 Email"}
                </p>
                <p>
                  <Crown size={13} /> 目前額度依 <strong>{activePlan.toUpperCase()}</strong> 計算
                </p>
                <Link href="/dashboard/account"><UserIcon size={13} /> 帳號設定</Link>
                <Link href="/"><LogOut size={13} /> 回首頁</Link>
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* ------------------------------------------------ usage table */}
      <section className="member-ai-rates">
        <h2>用量明細</h2>
        <p className="member-muted">
          最近 {usage.length} 筆額度消耗（最多顯示 200 筆，只涵蓋目前的資料庫紀錄）。
        </p>

        {usage.length === 0 ? (
          <p className="member-muted" style={{ marginTop: 12 }}>還沒有任何用量紀錄。</p>
        ) : (
          <div className="member-table-scroll">
            <table className="member-table">
              <thead>
                <tr>
                  <th>時間</th>
                  <th>項目</th>
                  <th>數量</th>
                  <th>備註</th>
                </tr>
              </thead>
              <tbody>
                {usage.map((u) => (
                  <tr key={u.id}>
                    <td>{new Date(u.createdAt).toLocaleString("zh-TW")}</td>
                    <td>{data?.quotas.find((q) => q.metric === u.metric)?.label ?? u.metric}</td>
                    <td>{u.quantity.toLocaleString()}</td>
                    <td className="member-muted">{u.note || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {invoices.length > 0 && (
        <section className="member-ai-rates">
          <h2>發票紀錄</h2>
          <div className="member-table-scroll">
            <table className="member-table">
              <thead>
                <tr>
                  <th>單號</th>
                  <th>金額</th>
                  <th>稅額</th>
                  <th>狀態</th>
                  <th>開立日</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((i) => (
                  <tr key={i.id}>
                    <td>{i.number}</td>
                    <td>{formatPrice(i.amount)}</td>
                    <td>{formatPrice(i.tax)}</td>
                    <td>{INVOICE_STATUS[i.status] ?? i.status}</td>
                    <td>{new Date(i.issuedAt).toLocaleDateString("zh-TW")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}