"use client";

import { useState, useEffect } from "react";
import { Trophy } from "lucide-react";

export default function LeaderboardPage() {
  const [range, setRange] = useState<"week" | "month" | "all">("month");
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/v1/leaderboard?range=${range}`)
      .then((r) => r.json())
      .then((d) => setRows(d.ranking || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [range]);

  return (
    <div className="max-w-[1080px]">
      <div className="mb-4 text-[13px] text-[var(--ic-ink-subtle)]">
        <a href="/dashboard" className="text-[var(--ic-primary)] no-underline">控制中心</a>
        <span className="mx-2 text-[var(--ic-ink-muted)]">/</span>
        <span className="text-[var(--ic-ink-muted)]">排行榜</span>
      </div>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div className="grid gap-2">
          <h1 className="text-[34px] font-[500] leading-[1.12] text-[var(--ic-ink)]">排行榜</h1>
          <p className="max-w-[520px] text-[14px] leading-[1.6] text-[var(--ic-ink-muted)]">依已確認贊助統計 Top 10，不含未付款與測試外的手動加總。</p>
        </div>
        <div className="flex gap-1 rounded-[var(--ic-radius-md)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] p-1">
          {(["week", "month", "all"] as const).map((r) => (
            <button key={r} onClick={() => setRange(r)} className={`rounded px-3 py-1.5 text-[12px] font-[500] ${range === r ? "bg-[var(--ic-primary)] text-white" : "text-[var(--ic-ink-muted)]"}`}>
              {r === "week" ? "本週" : r === "month" ? "本月" : "全部"}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-3.5 rounded-[var(--ic-radius-lg)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] p-6">
        {loading ? (
          <p className="py-6 text-center text-[14px] text-[var(--ic-ink-muted)]">載入中...</p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-[14px] text-[var(--ic-ink-muted)]">此區間尚無已確認贊助</p>
        ) : (
          rows.map((r: any) => (
            <div key={r.rank} className="flex items-center gap-3 rounded-[var(--ic-radius-md)] border border-[var(--ic-hairline)] p-3">
              <span className="w-8 text-center text-[14px] font-[700] text-[var(--ic-ink)]">{r.rank}</span>
              {r.rank === 1 && <Trophy className="h-4 w-4 text-yellow-500" />}
              <span className="min-w-0 flex-1 truncate text-[14px] text-[var(--ic-ink)]">{r.name}</span>
              <span className="text-[12px] text-[var(--ic-ink-muted)]">{r.count} 筆</span>
              <strong className="text-[14px] text-[var(--ic-ink)]">{Number(r.amount).toLocaleString()}</strong>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
