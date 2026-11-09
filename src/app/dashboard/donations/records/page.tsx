"use client";

import {
  PageHeader, Panel, Btn, Badge, EmptyState, Loading, ErrorBox, StatCard, useAsync,
} from "@/components/ui";
import { RefreshCw, Download, ScrollText } from "lucide-react";
import { useState } from "react";

type Record_ = {
  id: string;
  source: string;
  sourceLabel: string;
  donorName: string;
  amount: number;
  currency: string;
  message: string;
  status: string;
  tradeNo: string;
  createdAt: string;
};

const RANGES = [
  { value: "", label: "全部時間" },
  { value: "7", label: "最近 7 天" },
  { value: "30", label: "最近 30 天" },
  { value: "90", label: "最近 90 天" },
];

const statusTone = (s: string) =>
  s === "succeeded" || s === "confirmed" ? "ok" : s === "pending" ? "warn" : "danger";

export default function DonationRecordsPage() {
  const [range, setRange] = useState("");
  const [source, setSource] = useState("");

  const { data, loading, error, reload } = useAsync<{ records: Record_[] }>(
    () => {
      const qs = new URLSearchParams();
      if (range) qs.set("since", new Date(Date.now() - Number(range) * 864e5).toISOString());
      if (source) qs.set("source", source);
      return fetch(`https://api.zixilive.dpdns.org/api/v1/donation-records?${qs}`).then(async (r) => {
        if (!r.ok) throw new Error("載入失敗");
        const j = await r.json();
        return j?.data ?? j;
      });
    },
    [range, source]
  );

  const records = data?.records ?? [];
  const totalTwd = records.filter((r) => r.currency === "TWD").reduce((a, r) => a + r.amount, 0);
  const totalCrypto = records.filter((r) => r.currency !== "TWD").reduce((a, r) => a + r.amount, 0);
  const donors = new Set(records.map((r) => r.donorName)).size;

  const exportCsv = () => {
    const head = ["時間", "來源", "斗內者", "金額", "幣別", "狀態", "留言", "交易編號"];
    const rows = records.map((r) => [
      new Date(r.createdAt).toLocaleString("zh-TW"),
      r.sourceLabel, r.donorName, r.amount, r.currency, r.status,
      r.message.replace(/"/g, '""'), r.tradeNo,
    ]);
    const csv = [head, ...rows].map((r) => r.map((c) => `"${String(c)}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `donation-records-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHeader
        title="斗內紀錄"
        description="所有斗內的統一帳本，ZIXI 鏈上捐款與金流捐款都會彙整在這裡，可依時間範圍與來源篩選並匯出 CSV 對帳。"
        actions={
          <div className="flex gap-2">
            <Btn variant="secondary" onClick={reload}>
              <RefreshCw size={15} /> 重新整理
            </Btn>
            <Btn variant="secondary" onClick={exportCsv} disabled={records.length === 0}>
              <Download size={15} /> 匯出 CSV
            </Btn>
          </div>
        }
      />

      {error && <ErrorBox message={error} />}

      <div className="mb-[18px] grid gap-[14px] sm:grid-cols-3">
        <StatCard label="紀錄筆數" value={String(records.length)} />
        <StatCard label="新台幣總額" value={`NT$ ${totalTwd.toLocaleString()}`} />
        <StatCard label="加密貨幣總額" value={totalCrypto.toLocaleString()} sub={`${donors} 位斗內者`} />
      </div>

      <div className="mb-[18px] flex flex-wrap gap-2">
        {RANGES.map((r) => (
          <button
            key={r.value}
            onClick={() => setRange(r.value)}
            className={`min-h-[36px] rounded-[var(--ic-radius-md)] border px-[14px] text-[14px] font-[600] transition-colors ${
              range === r.value
                ? "border-[var(--ic-brand-accent)] bg-[var(--ic-brand-accent-soft)] text-[var(--ic-brand-accent)]"
                : "border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] text-[var(--ic-ink-subtle)] hover:border-[var(--ic-hairline-strong)]"
            }`}
          >
            {r.label}
          </button>
        ))}
        <span className="mx-[6px] w-px self-stretch bg-[var(--ic-hairline)]" />
        {[
          { v: "", l: "全部來源" },
          { v: "zixi", l: "ZIXI" },
          { v: "card", l: "金流" },
        ].map((s) => (
          <button
            key={s.v}
            onClick={() => setSource(s.v)}
            className={`min-h-[36px] rounded-[var(--ic-radius-md)] border px-[14px] text-[14px] font-[600] transition-colors ${
              source === s.v
                ? "border-[var(--ic-brand-accent)] bg-[var(--ic-brand-accent-soft)] text-[var(--ic-brand-accent)]"
                : "border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] text-[var(--ic-ink-subtle)] hover:border-[var(--ic-hairline-strong)]"
            }`}
          >
            {s.l}
          </button>
        ))}
      </div>

      {loading && <Loading />}

      {!loading && records.length === 0 && (
        <EmptyState
          title="沒有符合條件的斗內紀錄"
          description="調整上方的時間範圍或來源篩選，或等待新的斗內進帳。"
        />
      )}

      {!loading && records.length > 0 && (
        <Panel>
          <div className="-mx-[22px] -my-[22px] overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-left">
              <thead>
                <tr className="border-b border-[var(--ic-hairline)] bg-[var(--ic-surface-2)]">
                  {["時間", "來源", "斗內者", "金額", "狀態", "留言", "交易編號"].map((h) => (
                    <th key={h} className="px-[22px] py-[11px] text-[13px] font-[600] text-[var(--ic-ink-muted)]">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id} className="border-b border-[var(--ic-hairline-tertiary)] last:border-b-0 hover:bg-[var(--ic-surface-2)]">
                    <td className="px-[22px] py-[13px] text-[14px] whitespace-nowrap text-[var(--ic-ink-subtle)]">
                      {new Date(r.createdAt).toLocaleString("zh-TW")}
                    </td>
                    <td className="px-[22px] py-[13px]">
                      <Badge tone="neutral">{r.sourceLabel}</Badge>
                    </td>
                    <td className="px-[22px] py-[13px] text-[14px] font-[600] text-[var(--ic-ink)]">{r.donorName}</td>
                    <td className="px-[22px] py-[13px] text-[14px] font-[700] whitespace-nowrap tabular-nums text-[var(--ic-brand-accent)]">
                      {r.amount.toLocaleString()} {r.currency}
                    </td>
                    <td className="px-[22px] py-[13px]">
                      <Badge tone={statusTone(r.status) as any}>{r.status}</Badge>
                    </td>
                    <td className="max-w-[240px] px-[22px] py-[13px] text-[14px] text-[var(--ic-ink-subtle)]">
                      <span className="line-clamp-1">{r.message || "—"}</span>
                    </td>
                    <td className="px-[22px] py-[13px] font-mono text-[12px] text-[var(--ic-ink-tertiary)]">
                      {r.tradeNo ? `${r.tradeNo.slice(0, 14)}…` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <p className="mt-[14px] flex items-center gap-2 text-[13px] text-[var(--ic-ink-muted)]">
        <ScrollText size={15} /> 最多顯示最近 500 筆。完整對帳請用匯出的 CSV。
      </p>
    </>
  );
}