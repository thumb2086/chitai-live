"use client";

import {
  PageHeader, Crumbs, Panel, Btn, Badge, EmptyState, Loading, ErrorBox, useAsync, Textarea,
} from "@/components/ui";
import { Check, X, Trash2, ExternalLink, Play, Clock } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Video = {
  id: string;
  donorName: string;
  amount: number;
  videoUrl: string;
  startSec: number;
  endSec: number;
  message: string;
  status: string;
  rejectNote: string;
  createdAt: string;
};

const FILTERS = [
  { value: "pending_review", label: "待審核" },
  { value: "approved", label: "已核准" },
  { value: "played", label: "已播畢" },
  { value: "rejected", label: "已拒絕" },
  { value: "", label: "全部" },
];

const toneFor = (s: string) =>
  s === "pending_review" ? "warn" : s === "rejected" ? "danger" : s === "played" ? "neutral" : "ok";
const labelFor = (s: string) =>
  s === "pending_review" ? "待審核" : s === "approved" ? "已核准" : s === "played" ? "已播畢" : "已拒絕";

const fmtTime = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

export default function VideoReviewPage() {
  const router = useRouter();
  const [filter, setFilter] = useState("pending_review");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});

  const { data, loading, error, reload } = useAsync<{ videos: Video[] }>(
    () =>
      fetch(`/api/v1/donation-videos${filter ? `?status=${filter}` : ""}`).then((r) => {
        if (!r.ok) throw new Error("載入失敗");
        return r.json();
      }),
    [filter]
  );

  const videos = data?.videos ?? [];

  const act = async (id: string, payload: Record<string, unknown>) => {
    setBusy(id);
    try {
      const res = await fetch("/api/v1/donation-videos", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...payload }),
      });
      if (!res.ok) throw new Error("操作失敗");
      await reload();
    } catch {
      /* surfaced via list refresh */
    } finally {
      setBusy(null);
    }
  };

  const counts = {
    pending: videos.filter((v) => v.status === "pending_review").length,
  };

  return (
    <>
      <Crumbs
        items={[
          { label: "控制中心", href: "/dashboard" },
          { label: "斗內影片", href: "/dashboard/donation-video" },
          { label: "影片審核佇列" },
        ]}
      />
      <PageHeader
        title="影片審核佇列"
        description="觀眾送出的影片片段會先進入這裡。你核准後才會進入 OBS 的播放佇列，拒絕時可以附上理由給觀眾。"
        actions={
          <Badge tone={counts.pending ? "warn" : "ok"}>
            {filter === "pending_review" ? `${counts.pending} 筆待審核` : "篩選中"}
          </Badge>
        }
      />

      <div className="mb-[18px] flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`min-h-[36px] rounded-[var(--ic-radius-md)] border px-[14px] text-[14px] font-[600] transition-colors ${
              filter === f.value
                ? "border-[var(--ic-brand-accent)] bg-[var(--ic-brand-accent-soft)] text-[var(--ic-brand-accent)]"
                : "border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] text-[var(--ic-ink-subtle)] hover:border-[var(--ic-hairline-strong)]"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && <ErrorBox message={error} />}
      {loading && <Loading />}

      {!loading && videos.length === 0 && (
        <EmptyState
          title="目前沒有影片需求"
          description={
            filter === "pending_review"
              ? "所有觀眾送出的片段都已處理完畢。新需求會即時出現在這裡。"
              : "切換上方的篩選條件看看其他狀態的紀錄。"
          }
        />
      )}

      {!loading && videos.length > 0 && (
        <div className="flex flex-col gap-[14px]">
          {videos.map((v) => (
            <Panel key={v.id}>
              <div className="flex flex-wrap gap-[18px]">
                <div className="min-w-[220px] flex-1">
                  <div className="flex flex-wrap items-center gap-[10px]">
                    <span className="text-[18px] font-[800] text-[var(--ic-ink)]">{v.donorName}</span>
                    <Badge tone={toneFor(v.status)}>{labelFor(v.status)}</Badge>
                    {v.amount > 0 && (
                      <Badge tone="brand">{v.amount} 元</Badge>
                    )}
                  </div>
                  {v.message && (
                    <p className="mt-[8px] text-[14px] leading-[1.6] text-[var(--ic-ink-subtle)]">「{v.message}」</p>
                  )}
                  {v.rejectNote && (
                    <p className="mt-[8px] text-[13px] text-[var(--ic-danger)]">拒絕理由：{v.rejectNote}</p>
                  )}
                  <div className="mt-[10px] flex flex-wrap items-center gap-[14px] text-[13px] text-[var(--ic-ink-muted)]">
                    <a
                      href={v.videoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-[6px] text-[var(--ic-brand-accent)] no-underline hover:underline"
                    >
                      <ExternalLink size={14} /> 開啟來源影片
                    </a>
                    <span className="inline-flex items-center gap-[6px]">
                      <Clock size={14} /> {fmtTime(v.startSec)} – {fmtTime(v.endSec)}
                    </span>
                    <span>{new Date(v.createdAt).toLocaleString("zh-TW")}</span>
                  </div>
                </div>

                <div className="flex w-full flex-col gap-[10px] sm:w-[280px]">
                  {v.status === "pending_review" ? (
                    <>
                      <Textarea
                        rows={2}
                        placeholder="拒絕理由（選填）"
                        value={note[v.id] || ""}
                        onChange={(e) => setNote((n) => ({ ...n, [v.id]: e.target.value }))}
                        className="text-[13px]"
                      />
                      <div className="flex gap-2">
                        <Btn
                          className="min-h-[38px] flex-1 px-[12px]"
                          disabled={busy === v.id}
                          onClick={() => act(v.id, { _meta: "approve" })}
                        >
                          <Check size={15} /> 核准
                        </Btn>
                        <Btn
                          variant="danger"
                          className="min-h-[38px] flex-1 px-[12px]"
                          disabled={busy === v.id}
                          onClick={() => act(v.id, { _meta: "reject", rejectNote: note[v.id] || "" })}
                        >
                          <X size={15} /> 拒絕
                        </Btn>
                      </div>
                    </>
                  ) : v.status === "approved" ? (
                    <div className="flex flex-col gap-[8px]">
                      <Btn
                        variant="secondary"
                        className="min-h-[38px]"
                        disabled={busy === v.id}
                        onClick={() => act(v.id, { _meta: "played" })}
                      >
                        <Play size={15} /> 標記為已播畢
                      </Btn>
                      <Btn
                        variant="ghost"
                        className="min-h-[38px]"
                        disabled={busy === v.id}
                        onClick={() => act(v.id, { _meta: "delete" })}
                      >
                        <Trash2 size={15} /> 刪除
                      </Btn>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-[8px]">
                      {v.status === "rejected" && (
                        <Btn
                          variant="secondary"
                          className="min-h-[38px]"
                          disabled={busy === v.id}
                          onClick={() => act(v.id, { _meta: "approve" })}
                        >
                          <Check size={15} /> 改為核准
                        </Btn>
                      )}
                      <Btn
                        variant="ghost"
                        className="min-h-[38px]"
                        disabled={busy === v.id}
                        onClick={() => act(v.id, { _meta: "delete" })}
                      >
                        <Trash2 size={15} /> 刪除
                      </Btn>
                    </div>
                  )}
                  <button
                    onClick={() => router.push("/dashboard/donation-video")}
                    className="text-[13px] font-[600] text-[var(--ic-ink-muted)] underline-offset-2 hover:text-[var(--ic-brand-accent)] hover:underline"
                  >
                    調整播放規則
                  </button>
                </div>
              </div>
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}