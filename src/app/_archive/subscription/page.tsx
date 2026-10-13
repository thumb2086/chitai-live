"use client";

import { useState } from "react";
import Link from "next/link";
import { PLANS, QUOTAS, planByKey, formatPrice } from "@/lib/plans";
import { Check, Minus, Sparkles } from "lucide-react";
import { Loading, ErrorBox, useAsync } from "@/components/ui";

/**
 * Subscription plans.
 *
 * Markup follows livio's `.subscription-*` family.
 *
 * There is NO payment gateway wired up, so nothing here can take money:
 *   - paid plans render a disabled state, never a buy button
 *   - only the Free plan has a live action, and `changePlan` to free is real
 * The comparison table is built from `PLANS` + `QUOTAS`, which are the same
 * constants the server uses to enforce limits -- not marketing copy.
 */

type Payload = {
  subscription: { planKey: string; billingMode: string; status: string; currentPeriodEnd: string | null };
  effectivePlan: string;
  pendingUpgrade: boolean;
  quotas: { metric: string; label: string; limit: number; unit: string; used: number }[];
};

type Mode = "monthly" | "yearly";

/** One row of the comparison grid: a label plus each plan's value. */
type Row = { label: string; get: (key: string) => { text: string; unavailable?: boolean } };

export default function SubscriptionPage() {
  const [mode, setMode] = useState<Mode>("monthly");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const { data, loading, error, reload } = useAsync<Payload>(
    () => fetch("/api/v1/membership").then((r) => { if (!r.ok) throw new Error("載入失敗"); return r.json(); }),
    []
  );

  // `planKey` is what was *requested*; `effectivePlan` is what is actually
  // granted. An unpaid plan must not be labelled as the current tier.
  const granted = data?.effectivePlan ?? "free";
  const chosen = data?.subscription?.planKey ?? "free";
  const paid = data?.subscription?.status === "active" || data?.subscription?.status === "trialing";

  const changePlan = async (planKey: string) => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/v1/membership", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ _meta: "changePlan", planKey, billingMode: mode }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `操作失敗 (${res.status})`);
      await reload();
    } catch (e: any) { setErr(e?.message || "操作失敗"); }
    finally { setBusy(false); }
  };

  const limitOf = (planKey: string, metric: string) =>
    (QUOTAS[planKey] ?? QUOTAS.free).find((q) => q.metric === metric)?.limit ?? 0;

  const metricRows: Row[] = (QUOTAS.free ?? []).map((q) => ({
    label: q.label,
    get: (key) => {
      const limit = limitOf(key, q.metric);
      return { text: limit >= 999 ? "無限制" : `${limit.toLocaleString()} ${q.unit}` };
    },
  }));

  const groups: { label: string; rows: Row[] }[] = [
    {
      label: "價格",
      rows: [
        { label: "月繳", get: (k) => ({ text: planByKey(k).monthly === 0 ? "免費" : formatPrice(planByKey(k).monthly) }) },
        { label: "年繳", get: (k) => ({ text: planByKey(k).yearly === 0 ? "免費" : formatPrice(planByKey(k).yearly) }) },
        { label: "可否購買", get: (k) => (planByKey(k).monthly === 0 ? { text: "可切換" } : { text: "付費未開放", unavailable: true }) },
      ],
    },
    { label: "本期額度", rows: metricRows },
    {
      label: "資料保存",
      rows: [{ label: "事件紀錄保存", get: (k) => ({ text: planByKey(k).retention }) }],
    },
  ];

  return (
    <div className="subscription-page">
      <nav className="subscription-breadcrumb">
        <Link href="/dashboard/membership">會員中心</Link>{" "}
        <span>/ 訂閱方案</span>
      </nav>

      <header className="subscription-hero">
        <p className="eyebrow">方案與額度</p>
        <h1>
          選一個適合<span className="subscription-brand-word">你的</span>方案
        </h1>
        <p className="subtitle">
          目前尚未開放付費，所有功能皆可在 Free 方案下使用。這裡列出各方案的額度差異，
          供未來付費開放後參考 —— 選擇付費方案不會產生費用，也不會立即生效。
        </p>
      </header>

      <div className="subscription-tabs">
        {(["monthly", "yearly"] as const).map((m) => (
          <button
            key={m}
            type="button"
            className={`subscription-tab ${mode === m ? "is-active" : ""}`}
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
          >
            {m === "monthly" ? "月繳" : "年繳"}
            {m === "yearly" && <span className="subscription-tab-badge">省 2 個月</span>}
          </button>
        ))}
      </div>

      {error && <ErrorBox message={error} />}
      {err && <ErrorBox message={err} />}

      {loading ? (
        <Loading />
      ) : (
        <>
          {/* Only shown when a plan was picked but never paid for. */}
          {chosen !== "free" && !paid && (
            <div className="subscription-status-panel">
              <div>
                <span>已選擇</span>
                <strong>{chosen.toUpperCase()}</strong>
              </div>
              <div>
                <span>目前生效</span>
                <strong>{granted.toUpperCase()}</strong>
              </div>
              <div>
                <span>狀態</span>
                <strong>尚未付款</strong>
              </div>
              <div>
                <span>可付款</span>
                <strong>尚未開放</strong>
              </div>
              <div className="subscription-status-actions">
                <button
                  type="button"
                  className="ghost-button"
                  disabled={busy}
                  onClick={() => changePlan("free")}
                >
                  改回免費方案
                </button>
              </div>
              <p style={{ gridColumn: "1 / -1" }}>
                你的額度仍是 {granted.toUpperCase()}。這不是顯示錯誤 —— 未結清的方案不會取得任何額度。
              </p>
            </div>
          )}

          <div className="subscription-plan-grid">
            {PLANS.map((p) => {
              const isCurrent = p.key === granted;
              const isSelected = p.key === chosen;
              const price = mode === "yearly" ? p.yearly : p.monthly;
              const freePlan = p.monthly === 0;
              const cls = [
                "subscription-plan-card",
                isCurrent ? "is-current" : "",
                p.key === "creator" ? "is-featured" : "",
                isSelected && !isCurrent ? "is-selected" : "",
              ].filter(Boolean).join(" ");

              return (
                <article key={p.key} className={cls}>
                  <div className="subscription-plan-head">
                    <div className="subscription-plan-title-row">
                      <h3>{p.name}</h3>
                      {isCurrent ? (
                        <span className="subscription-plan-badge">目前方案</span>
                      ) : isSelected ? (
                        <span className="subscription-badge">已選擇 · 未生效</span>
                      ) : p.key === "creator" ? (
                        <span className="subscription-badge">最受歡迎</span>
                      ) : null}
                    </div>

                    <p className="subscription-plan-description">
                      {freePlan
                        ? "完整功能都在這個層級，不需要信用卡。"
                        : `在 Free 之上多給額度，適合已經穩定开播的頻道。`}
                    </p>

                    <div className="subscription-price-row">
                      <span className="subscription-price">
                        {formatPrice(price)}
                      </span>
                      {mode === "yearly" && !freePlan && (
                        <span className="subscription-price-saving">
                          省 {formatPrice(p.monthly * 12 - p.yearly)}
                        </span>
                      )}
                    </div>

                    <span className="subscription-period">
                      {freePlan
                        ? "永久免費"
                        : `每 ${mode === "yearly" ? "年" : "月"} · 付費尚未開放`}
                    </span>
                  </div>

                  <p className="subscription-plan-quota">
                    {metricRows.map((r) => `${r.label} ${r.get(p.key).text}`).join(" · ")}
                  </p>

                  <ul className="subscription-feature-list">
                    {p.features.map((f) => <li key={f}>{f}</li>)}
                    <li>事件紀錄保存 {p.retention}</li>
                  </ul>

                  {freePlan ? (
                    <button
                      type="button"
                      className="primary-button"
                      disabled={isCurrent || busy}
                      onClick={() => changePlan("free")}
                    >
                      {busy ? "處理中…" : isCurrent ? "使用中" : "改用 Free"}
                    </button>
                  ) : (
                    /* No payment rail exists, so do not offer a purchase that
                       cannot complete. */
                    <button type="button" className="ghost-button" disabled>
                      付費尚未開放
                    </button>
                  )}
                </article>
              );
            })}
          </div>

          {/* Comparison grid. Column count matches PLANS (4), which is what
              `.subscription-compare-row` is laid out for. */}
          <section className="subscription-compare-section">
            <div className="subscription-section-heading">
              <h2>完整比較</h2>
              <p>下表直接讀取伺服器用來計算額度的同一份常數，與實際限制一致。</p>
            </div>

            <div className="subscription-compare-table">
              <div className="subscription-compare-head">
                <span>項目</span>
                {PLANS.map((p) => (
                  <strong key={p.key}>{p.name}</strong>
                ))}
              </div>

              {groups.map((g) => (
                <div key={g.label}>
                  <div className="subscription-compare-group">
                    <span>{g.label}</span>
                  </div>
                  {g.rows.map((row) => (
                    <div key={row.label} className="subscription-compare-row">
                      <span>{row.label}</span>
                      {PLANS.map((p) => {
                        const v = row.get(p.key);
                        return (
                          <strong key={p.key} className={`subscription-compare-cell ${v.unavailable ? "is-unavailable" : ""}`}>
                            <i>{v.unavailable ? <Minus /> : <Check />}</i>
                            <span>{v.text}</span>
                          </strong>
                        );
                      })}
                    </div>
                  ))}
                </div>
              ))}

              <div className="subscription-compare-row">
                <span><Sparkles size={14} /> 目前用量</span>
                {PLANS.map((p) => (
                  <strong key={p.key} className="subscription-compare-cell">
                    <i><Check /></i>
                    <span>
                      {p.key === granted
                        ? `${(data?.quotas ?? []).filter((q) => q.used > 0).length} 項已有消耗`
                        : "—"}
                    </span>
                  </strong>
                ))}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}