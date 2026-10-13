"use client";

import Link from "next/link";
import { Download } from "lucide-react";
import { Loading, ErrorBox, useAsync } from "@/components/ui";
import { formatPrice } from "@/lib/plans";

/**
 * Billing and invoices.
 *
 * Markup follows livio's `.member-*` family, like the rest of the membership
 * area.
 *
 * Two things this page used to claim that are no longer true:
 *
 *   - it rendered a "前往付款" button wired to `_meta=payInvoice`, which is now
 *     hard-blocked server-side with 501 because a client must not be able to
 *     settle its own invoice. The button could only ever produce
 *     "操作失敗 (501)", so it is gone rather than left to fail on click.
 *   - the footnote said the button "只會把帳單標記為已付款以便測試流程". That is
 *     exactly the entitlement hole that was closed. `.member-notice` now states
 *     what is actually true.
 */

type Invoice = {
  id: string; number: string; amount: number; tax: number;
  status: string; period: string; issuedAt: string;
};
type Payload = { invoices: Invoice[] };

const STATUS_LABEL: Record<string, string> = {
  paid: "已付款", pending: "待付款", failed: "付款失敗", refunded: "已退款",
};

/**
 * There is no payment provider wired up, so this is a text summary of a row,
 * not a tax document. Labelled as a sample in the button and in the file itself.
 */
function downloadInvoice(inv: Invoice) {
  const body = [
    "StreamFlow 發票（樣本，非正式稅務憑證）",
    "",
    `發票號碼：${inv.number}`,
    `計費期間：${inv.period}`,
    `開立日期：${new Date(inv.issuedAt).toLocaleDateString("zh-TW")}`,
    `金額：${formatPrice(inv.amount)}`,
    `稅額：${formatPrice(inv.tax)}`,
    `狀態：${STATUS_LABEL[inv.status] ?? inv.status}`,
    "",
    "本檔案由資料庫中的帳單資料產生，不是政府認可的發票。",
  ].join("\n");
  const url = URL.createObjectURL(new Blob(["﻿" + body], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${inv.number}-sample.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function BillingPage() {
  const { data, loading, error } = useAsync<Payload>(
    () => fetch("/api/v1/membership").then((r) => {
      if (!r.ok) throw new Error("載入失敗");
      return r.json();
    }),
    []
  );

  const invoices = data?.invoices ?? [];
  const paid = invoices.filter((i) => i.status === "paid");
  const pending = invoices.filter((i) => i.status === "pending");
  const sum = (xs: Invoice[]) => xs.reduce((a, i) => a + i.amount, 0);

  return (
    <div className="member-page">
      <header className="member-membership-head member-page-header">
        <div>
          <h1>付款與發票</h1>
          <p className="member-muted">查看每期帳單、付款狀態與發票。</p>
        </div>
        <div className="member-page-links">
          <span className="member-badge">
            {pending.length ? `${pending.length} 筆待付款` : "無待付款"}
          </span>
        </div>
      </header>

      {error && <ErrorBox message={error} />}

      <nav className="member-subnav">
        <Link href="/dashboard/membership">會員中心</Link>
        <Link href="/dashboard/membership/usage">用量與點數紀錄</Link>
        <Link href="/dashboard/subscription">訂閱方案</Link>
      </nav>

      <div className="member-notice">
        <strong>這裡無法付款。</strong>
        <p>
          金流閘道尚未串接，伺服器端也已經封鎖「客戶端自行結算帳單」的入口 ——
          沒有付款就不會有任何方案生效，所以待付款單在這裡只能查看，不能結算。
          要啟用收款請先到 <Link href="/dashboard/payment-settings">金流設定</Link>{" "}
          填入商店代號與金鑰。
        </p>
      </div>

      {loading ? (
        <Loading />
      ) : (
        <>
          <div className="member-plan-grid">
            <section className="member-card">
              <p className="member-plan-quota">帳單總數</p>
              <p className="member-balance">{invoices.length}</p>
            </section>
            <section className="member-card">
              <p className="member-plan-quota">已付款</p>
              <p className="member-balance">{formatPrice(sum(paid))}</p>
              <p className="member-muted">{paid.length} 張</p>
            </section>
            <section className="member-card">
              <p className="member-plan-quota">待付款</p>
              <p className="member-balance">{formatPrice(sum(pending))}</p>
              <p className="member-expiry">{pending.length ? "需處理" : "無待付款"}</p>
            </section>
          </div>

          <section className="member-ai-rates">
            <div className="member-page-links">
              <h2>帳單記錄</h2>
              <span className="member-muted">共 {invoices.length} 筆</span>
            </div>

            {invoices.length === 0 ? (
              <div className="member-card member-centered">
                <p style={{ margin: 0, fontSize: 16, fontWeight: 650, color: "var(--ic-ink)" }}>
                  還沒有任何帳單
                </p>
                <p className="member-muted">目前沒有付款管道，因此也不會產生帳單。</p>
              </div>
            ) : (
              <div className="member-table-scroll">
                <table className="member-table">
                  <thead>
                    <tr>
                      <th>單號</th>
                      <th>計費期間</th>
                      <th>開立日</th>
                      <th>金額</th>
                      <th>稅額</th>
                      <th>狀態</th>
                      <th>發票</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((inv) => (
                      <tr key={inv.id}>
                        <td>{inv.number}</td>
                        <td className="member-muted">{inv.period || "—"}</td>
                        <td>{new Date(inv.issuedAt).toLocaleDateString("zh-TW")}</td>
                        <td>{formatPrice(inv.amount)}</td>
                        <td className="member-muted">{formatPrice(inv.tax)}</td>
                        <td>{STATUS_LABEL[inv.status] ?? inv.status}</td>
                        <td>
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => downloadInvoice(inv)}
                          >
                            <Download size={14} /> 樣本
                          </button>
                        </td>
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
