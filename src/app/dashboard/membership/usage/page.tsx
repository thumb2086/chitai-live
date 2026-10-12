"use client";

import { useMemo } from "react";
import Link from "next/link";
import { RefreshCw, TrendingUp } from "lucide-react";
import { Loading, ErrorBox, useAsync } from "@/components/ui";

/**
 * Usage and credit history.
 *
 * Markup follows livio's `.member-*` family, same as the membership centre it
 * hangs off.
 *
 * The old page had a "加一筆測試用量" button that POSTed `recordUsage` with 10
 * fake AI credits. Those are not sandbox rows: the API sums every UsageEvent in
 * the period into `used`, so the button inflated the user's own consumption and
 * then displayed it back as real. Removed rather than relabelled -- if a seeding
 * tool is wanted it belongs on /dashboard/testing, not on a billing page.
 *
 * `.member-plan-grid` is reused for the three quota cards: it is the only 3
 * column grid in this family and the cards are the same shape.
 */

type Usage = { id: string; metric: string; quantity: number; note: string; createdAt: string };
type Payload = {
  quotas: { metric: string; label: string; limit: number; unit: string; used: number }[];
  usage: Usage[];
  periodStart: string;
};

const METRIC_LABEL: Record<string, string> = {
  overlay: "疊加層建立",
  caption_minutes: "字幕轉錄",
  ai_credits: "AI 點數消耗",
  replay_minutes: "回放分析",
};

/**
 * 數量格式化 —— 每種計量單位的小數位不同。
 *
 * ai_credits 是**點數**，單次呼叫的量極小（0.0007/秒），
 * 用 toLocaleString() 會顯示成 0.001，看起來像沒有在動 ——
 * 那正是「方案頁顯示已用 0」的同一種病，只是换了個scale。
 *
 * caption_minutes 一秒窗是 0.0167 分鐘，保留 0 位會把整串短窗
 * 全部顯示成 0（usage.ts 的註解記過這個坑）。
 *
 * 所以：按 metric 決定精度，而不是全站統一。
 */
const METRIC_DIGITS: Record<string, number> = {
  ai_credits: 4,
  caption_minutes: 1,
  replay_minutes: 1,
};

function fmtQty(metric: string, n: number): string {
  const digits = METRIC_DIGITS[metric] ?? 0;
  return Number(n).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

export default function UsagePage() {
  const { data, loading, error, reload } = useAsync<Payload>(
    () => fetch("/api/v1/membership").then((r) => {
      if (!r.ok) throw new Error("載入失敗");
      return r.json();
    }),
    []
  );

  const quotas = data?.quotas ?? [];
  const usage = data?.usage ?? [];

  const labelFor = (metric: string) =>
    METRIC_LABEL[metric] ?? quotas.find((q) => q.metric === metric)?.label ?? metric;

  // Per-metric totals over the trailing 30 days, for the trend line.
  const byMetric = useMemo(() => {
    const cutoff = Date.now() - 30 * 864e5;
    const acc: Record<string, number> = {};
    for (const u of usage) {
      if (new Date(u.createdAt).getTime() < cutoff) continue;
      acc[u.metric] = (acc[u.metric] ?? 0) + u.quantity;
    }
    return acc;
  }, [usage]);

  return (
    <div className="member-page">
      <header className="member-membership-head member-page-header">
        <div>
          <h1>用量與點數紀錄</h1>
          <p className="member-muted">
            逐筆查看這個計費週期消耗了哪些額度。資料來源包含字幕轉錄、疊加層建立與 AI 點數扣用。
          </p>
        </div>
        <div className="member-page-links">
          <span className="member-muted">
            週期自 {new Date(data?.periodStart ?? Date.now()).toLocaleDateString("zh-TW")} 起算
          </span>
        </div>
      </header>

      {error && <ErrorBox message={error} />}

      <nav className="member-subnav">
        <Link href="/dashboard/membership">會員中心</Link>
        <Link href="/dashboard/membership/billing">付款與發票</Link>
        <button type="button" onClick={() => void reload()}>
          <RefreshCw size={14} /> 重新整理
        </button>
      </nav>

      {loading ? (
        <Loading />
      ) : (
        <>
          <div className="member-plan-grid">
            {/* caption_minutes 不再是額度（只有 ai_credits 擋），所以不佔額度卡版面。
                它仍在 plans.ts 裡，被 getMembership 讀出來會顯示 ——
                這裡過濾掉，否則使用者會看到兩張都在講同一件事的卡片。 */}
            {quotas
              .filter((q) => q.metric !== "caption_minutes")
              .map((q) => {
              const pct = q.limit > 0 ? Math.min(100, Math.round((q.used / q.limit) * 100)) : 0;
              const over = q.used > q.limit;
              return (
                <section key={q.metric} className="member-card">
                  <div className="member-page-links">
                    <p className="member-plan-quota">{q.label}</p>
                    <span className="member-badge">{pct}%</span>
                  </div>

                  <p className="member-balance">
                    {fmtQty(q.metric, q.used)}
                    <span className="member-muted"> / {q.limit.toLocaleString()} {q.unit}</span>
                  </p>

                  {/* `.usage-progress-*` is the stylesheet's own quota meter. */}
                  <div className="usage-progress-track">
                    <div
                      className="usage-progress-fill"
                      style={{ width: `${pct}%`, ...(over ? { background: "var(--ic-danger)" } : {}) }}
                    />
                  </div>

                  {over ? (
                    q.metric === "overlay" ? (
                      /* Concurrency ceiling, not consumption: nothing is billed
                         and nothing is disabled here. See the membership page. */
                      <p className="member-expiry">同時層數，非用量</p>
                    ) : (
                      <p className="member-expiry">已超出目前方案額度</p>
                    )
                  ) : (
                    <p className="member-expiry">
                      <TrendingUp size={12} /> 近 30 天 {fmtQty(q.metric, byMetric[q.metric] ?? 0)} {q.unit}
                    </p>
                  )}
                </section>
              );
              })}
          </div>

          <section className="member-ai-rates">
            <div className="member-page-links">
              <h2>用量明細</h2>
              <span className="member-muted">
                共 {usage.length} 筆{usage.length >= 200 ? "（已達 200 筆上限，較早的紀錄未顯示）" : ""}
              </span>
            </div>

            {usage.length === 0 ? (
              <div className="member-card member-centered">
                <p style={{ margin: 0, fontSize: 16, fontWeight: 650, color: "var(--ic-ink)" }}>
                  尚無用量紀錄
                </p>
                <p className="member-muted">開始使用字幕或回放分析後，這裡會逐筆記錄每一筆扣用。</p>
              </div>
            ) : (
              <div className="member-table-scroll">
                <table className="member-table">
                  <thead>
                    <tr>
                      <th>時間</th>
                      <th>項目</th>
                      <th>用量</th>
                      <th>備註</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* caption_minutes 是 ai_credits 的「同一筆呼叫的另一種單位」，
                        不是第二次扣費。顯示兩行會讓人以為扣了兩次，
                        而「同一件事記兩筆帳」正是最難向使用者解釋的那種 bug。
                        這裡只顯示真正的扣費項（點數 / 疊加層 / 回放分鐘）。 */}
                    {usage
                      .filter((u) => u.metric !== "caption_minutes")
                      .map((u) => (
                        <tr key={u.id}>
                          <td>{new Date(u.createdAt).toLocaleString("zh-TW")}</td>
                          <td>{labelFor(u.metric)}</td>
                          <td>{fmtQty(u.metric, u.quantity)}</td>
                          <td className="member-muted">{u.note || "—"}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}