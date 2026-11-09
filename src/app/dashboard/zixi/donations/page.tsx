"use client";

import { useState, useEffect } from "react";
import { ExternalLink, CheckCircle2, Clock, RefreshCw } from "lucide-react";

export default function ZixiDonationsPage() {
  const [donations, setDonations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [msg, setMsg] = useState("");

  const load = () => fetch("https://api.zixilive.dpdns.org/api/v1/zixi-donations").then(r => r.json()).then(d => setDonations(d.donations || [])).catch(() => {});

  useEffect(() => { load().finally(() => setLoading(false)); }, []);

  const checkTx = async () => {
    setChecking(true); setMsg("檢查區塊鏈中...");
    const r = await fetch("https://api.zixilive.dpdns.org/api/v1/zixi/check-tx", { method: "POST" }).then(r => r.json()).catch(() => null);
    if (r?.found > 0) setMsg(`✅ 發現 ${r.found} 筆新捐款！`);
    else if (r?.checked) setMsg("沒有新交易");
    else setMsg("檢查失敗");
    await load();
    setTimeout(() => setMsg(""), 5000);
    setChecking(false);
  };

  return (
    <div className="max-w-[1080px]">
      <div className="mb-4 text-[13px] text-[var(--ic-ink-subtle)]">
        <a href="/dashboard" className="text-[var(--ic-primary)] no-underline">控制中心</a>
        <span className="mx-2 text-[var(--ic-ink-muted)]">/</span>
        <a href="/dashboard/zixi" className="text-[var(--ic-primary)] no-underline">ZIXI 錢包</a>
        <span className="mx-2 text-[var(--ic-ink-muted)]">/</span>
        <span className="text-[var(--ic-ink-muted)]">捐款記錄</span>
      </div>
      <div className="mb-6 grid gap-2">
        <h1 className="text-[34px] font-[500] leading-[1.12] text-[var(--ic-ink)]">ZIXI 捐款記錄</h1>
        <p className="max-w-[520px] text-[14px] leading-[1.6] text-[var(--ic-ink-muted)]">所有透過 ZIXI 生態系的贊助記錄。每 5 分鐘自動檢查區塊鏈。</p>
      </div>

      {msg && <div className="mb-4 rounded-[var(--ic-radius-md)] border border-gray-200 bg-gray-50 p-3 text-[13px] text-gray-700">{msg}</div>}

      <div className="rounded-[var(--ic-radius-lg)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] p-5">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-[12px] font-[500] uppercase tracking-[0.04em] text-[var(--ic-ink-subtle)]">捐款記錄 ({donations.length})</span>
          <button onClick={checkTx} disabled={checking}
            className="flex items-center gap-1.5 rounded-[var(--ic-radius-md)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] px-3 py-1.5 text-[12px] font-[500] text-[var(--ic-ink)] transition-all hover:border-[var(--ic-hairline-strong)] disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${checking ? "animate-spin" : ""}`} />
            {checking ? "檢查中..." : "檢查區塊鏈"}
          </button>
        </div>
        {donations.length === 0 && (
          <div className="py-8 text-center text-[14px] text-[var(--ic-ink-muted)]">尚無捐款記錄</div>
        )}
        <div className="grid gap-2">
          {donations.map((d: any) => (
            <div key={d.id} className="flex items-center justify-between gap-4 rounded-[var(--ic-radius-md)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <strong className="text-[14px] font-[600] text-[var(--ic-ink)]">
                    {d.donorName || (d.donorAddress ? d.donorAddress.slice(0,6)+'...'+d.donorAddress.slice(-4) : '匿名')}
                  </strong>
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-[500] ${
                    d.status === "confirmed" ? "border-green-200 bg-green-50 text-green-700" : "border-yellow-200 bg-yellow-50 text-yellow-700"
                  }`}>
                    {d.status === "confirmed" ? <CheckCircle2 className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                    {d.status === "confirmed" ? "已確認" : "待確認"}
                  </span>
                </div>
                {d.message && <p className="m-0 text-[12px] text-[var(--ic-ink-muted)] truncate">{d.message}</p>}
                <p className="m-0 text-[11px] text-[var(--ic-ink-tertiary)]">{new Date(d.createdAt).toLocaleString()}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className={`text-[16px] font-[700] ${d.token === "YJC" ? "text-purple-400" : "text-[var(--ic-fin-orange)]"}`}>
                  {d.amount} {d.token}
                </span>
                {d.txHash && (
                  <a href={`https://sepolia.etherscan.io/tx/${d.txHash}`} target="_blank" rel="noopener noreferrer" className="text-[var(--ic-ink-tertiary)] hover:text-[var(--ic-ink)]">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
