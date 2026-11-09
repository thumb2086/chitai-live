"use client";

import { useMemo, useState } from "react";
import { Clapperboard, Play, Trash2, Plus, Sparkles, Search, AlertTriangle, Film } from "lucide-react";
import { Loading, ErrorBox, useAsync } from "@/components/ui";

/**
 * Replay analysis.
 *
 * Markup follows livio's `.replay-analysis-*` family (plus the `.replay-*`
 * launch-form primitives the stylesheet scopes under `.replay-analysis-page`).
 *
 * The pipeline is real: `advance` downloads the source, decodes it, then
 * transcribes and scores it one bounded chunk per call. It is NOT a preview,
 * so nothing on this page is labelled as one.
 */

type Segment = {
  id: string; startSec: number; endSec: number; transcript: string;
  score: number; hook: number; peak: number;
};
type Job = {
  id: string; title: string; replayUrl: string; language: string;
  status: string; progress: number; summary: string;
  createdAt: string; completedAt: string | null; segments: Segment[];
};

const MAX_CONCURRENT = 3; // enforced server-side in the route handler

const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
const STATUS: Record<string, string> = {
  queued: "排隊中", running: "分析中", completed: "已完成", failed: "失敗",
};
const isLive = (s: string) => s === "queued" || s === "running";

/** YouTube exposes a public thumbnail endpoint; anything else gets the placeholder. */
function thumbnailFor(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    let id = "";
    if (host === "youtu.be") {
      id = u.pathname.slice(1);
    } else if (host === "youtube.com" || host === "m.youtube.com") {
      id = u.searchParams.get("v") ?? "";
      if (!id) id = u.pathname.match(/\/(?:embed|shorts|v)\/([^/?#]+)/)?.[1] ?? "";
    }
    return /^[A-Za-z0-9_-]{6,}$/.test(id) ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
  } catch {
    return null;
  }
}

export default function ReplayAnalysisPage() {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [language, setLanguage] = useState("zh");
  const [q, setQ] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const { data, loading, error, reload } = useAsync<{ jobs: Job[] }>(
    () => fetch("https://api.zixilive.dpdns.org/api/v1/replay-jobs").then((r) => {
      if (!r.ok) throw new Error("載入失敗");
      return r.json();
    }),
    []
  );

  const jobs = data?.jobs ?? [];
  const running = jobs.filter((j) => isLive(j.status)).length;

  const call = async (payload: Record<string, unknown>) => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("https://api.zixilive.dpdns.org/api/v1/replay-jobs", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `操作失敗 (${res.status})`);
      await reload();
      if (payload._meta === "create") { setTitle(""); setUrl(""); }
    } catch (e: any) { setErr(e?.message || "操作失敗"); }
    finally { setBusy(false); }
  };

  const matched = useMemo(() => {
    const kw = q.trim().toLowerCase();
    if (!kw) return null;
    const map = new Map<string, Segment[]>();
    for (const j of jobs) map.set(j.id, j.segments.filter((s) => s.transcript.toLowerCase().includes(kw)));
    return map;
  }, [jobs, q]);

  const hits = matched ? [...matched.values()].reduce((a, s) => a + s.length, 0) : 0;

  return (
    <div className="replay-analysis-page">
      {/* ------------------------------------------------ header */}
      <header className="replay-analysis-page-header">
        <div className="replay-analysis-page-title">
          <span className="replay-analysis-page-icon">
            <Clapperboard />
          </span>
          <div>
            <h1>回放分析</h1>
            <p className="subtitle">
              丟一段直播回放進來，系統會轉錄語音、切成可用的片段，並標出鉤子與高潮的位置——
              讓你剪精華不用從頭看到尾。
            </p>
          </div>
        </div>
        <span className="replay-analysis-quota-chip">
          <Film />
          {running} / {MAX_CONCURRENT} 個進行中
        </span>
      </header>

      {error && <ErrorBox message={error} />}
      {err && <ErrorBox message={err} />}

      {/* ------------------------------------------------ launch form */}
      <section className="replay-analysis-hero">
        <div className="replay-launch-panel">
          <form
            className="replay-launch-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!title.trim() || !url.trim()) return;
              void call({ _meta: "create", title, replayUrl: url, language });
            }}
          >
            <div className="replay-source-row">
              <label className="replay-source-field">
                <span className="mini-label">回放網址</span>
                <span className="replay-source-input-shell">
                  <textarea
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://www.youtube.com/watch?v=…"
                    aria-label="回放網址"
                  />
                </span>
              </label>

              <label className="field">
                <span>主要語言</span>
                <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                  <option value="zh">中文</option>
                  <option value="en">English</option>
                  <option value="ja">日本語</option>
                </select>
                <small>影響切詞與關鍵詞評分。</small>
              </label>
            </div>

            <label className="field">
              <span>回放標題</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例如：11/28 晚間場"
              />
            </label>

            <div className="replay-analysis-consent-row">
              <label className="replay-analysis-acknowledgement">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />
                <span>
                  我了解建立工作後，系統會抓取這個網址的音訊，並把音訊送到我的字幕供應商進行轉錄。
                </span>
              </label>
            </div>

            <div className="action-row">
              <button
                type="submit"
                className="replay-analysis-submit-button"
                disabled={busy || !title.trim() || !url.trim() || !acknowledged || running >= MAX_CONCURRENT}
              >
                <Plus size={17} /> 建立分析工作
              </button>

              <details className="replay-analysis-rules">
                <summary>什麼樣的網址可以用？</summary>
                <div>
                  <p>
                    必須是<strong>不需要登入</strong>就能取到的 http(s) 直連內容。已加密、需要登入、
                    或設有 DRM 的來源會在抓取時失敗，工作狀態會變成「失敗」並記下原因。
                  </p>
                  <p style={{ marginTop: 7 }}>
                    內網與 localhost 位址會被拒絕（SSRF 防護）。同一時間最多 {MAX_CONCURRENT} 個工作。
                  </p>
                </div>
              </details>
            </div>
          </form>
        </div>

        <div className="replay-analysis-warning">
          <strong>這不是預覽，建立後會真的跑</strong>
          <ul>
            <li>每按一次「推進一格」就會實際下載音訊、解碼、呼叫字幕供應商轉錄並評分，會消耗你的額度。</li>
            <li>工作不會在背景自動跑完 —— 需要你回來按「推進一格」直到 100%，每次處理一段。</li>
            <li>逐字稿會完整保存，可用下方搜尋比對所有已完成工作。</li>
          </ul>
        </div>
      </section>

      {/* ------------------------------------------------ jobs */}
      <section className="replay-analysis-recent">
        <div className="replay-analysis-page-header">
          <h2>最近的分析</h2>
          <div className="replay-analysis-list-actions">
            <label className="field">
              <span className="mini-label">搜尋逐字稿</span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="輸入關鍵字"
              />
            </label>
          </div>
        </div>

        {matched && (
          <p className="replay-analysis-card-copy">
            <span className="replay-analysis-highlight-count">{hits} 個片段命中</span>
          </p>
        )}

        {loading ? (
          <Loading />
        ) : jobs.length === 0 ? (
          <div className="replay-analysis-empty">
            <strong>還沒有分析工作</strong>
            <span>貼上一段回放網址，系統就會開始轉錄與切段。</span>
          </div>
        ) : (
          <div className="replay-analysis-card-list">
            {jobs.map((j) => {
              const thumb = thumbnailFor(j.replayUrl);
              const segs = matched ? matched.get(j.id) ?? [] : j.segments;
              const failed = j.status === "failed";
              return (
                <article key={j.id} className="replay-analysis-card">
                  <div className="replay-analysis-thumbnail">
                    {thumb ? (
                      <img src={thumb} alt="" loading="lazy" />
                    ) : (
                      <span className="replay-analysis-thumbnail-placeholder">
                        <Film />
                      </span>
                    )}
                    <span className="replay-analysis-play-mark">
                      <Play />
                    </span>
                  </div>

                  <div className="replay-analysis-card-copy">
                    <h3>{j.title}</h3>

                    <div className="replay-analysis-card-meta">
                      <span>{new Date(j.createdAt).toLocaleString("zh-TW")}</span>
                      <span>{STATUS[j.status] ?? j.status}</span>
                      <span>逐字稿 {j.segments.length} 段</span>
                      {isLive(j.status) && <span className="tabular-nums">{j.progress}%</span>}
                    </div>

                    <a
                      className="replay-analysis-list-link"
                      href={j.replayUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <span className="replay-analysis-list-row">
                        <span className="row-meta">{j.replayUrl}</span>
                      </span>
                    </a>

                    {isLive(j.status) && (
                      <div className="replay-analysis-card-progress">
                        <span style={{ width: `${Math.max(0, Math.min(100, j.progress))}%` }} />
                      </div>
                    )}

                    {/* `summary` is overloaded server-side: an AI summary when the
                        job completed, the thrown error message when it failed.
                        Never render a failure through the success treatment. */}
                    {failed && j.summary && (
                      <p className="replay-analysis-card-error" title={j.summary}>
                        {j.summary}
                      </p>
                    )}
                    {j.status === "completed" && j.summary && (
                      <p className="replay-analysis-card-copy">
                        <Sparkles size={15} /> {j.summary}
                      </p>
                    )}
                  </div>

                  <span className="replay-analysis-highlight-count">
                    {j.segments.length ? `${j.segments.length} 段` : "—"}
                  </span>

                  <div className="replay-analysis-card-action">
                    {j.status !== "completed" && (
                      <button
                        type="button"
                        className="replay-analysis-result-button"
                        disabled={busy}
                        onClick={() => void call({ _meta: "advance", id: j.id })}
                      >
                        <Play size={15} /> {failed ? "重試" : "推進一格"}
                      </button>
                    )}
                    <button
                      type="button"
                      className="replay-delete-button"
                      disabled={busy}
                      onClick={() => void call({ _meta: "delete", id: j.id })}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>

                  {segs.length > 0 && (
                    <div className="replay-analysis-card-copy">
                      <div className="replay-analysis-layout">
                        <div className="replay-analysis-list-row">
                          <strong className="replay-analysis-highlight-count">
                            精華片段 ({segs.length})
                          </strong>
                        </div>
                        {segs.map((s) => (
                          <div key={s.id} className="replay-analysis-result">
                            <div className="replay-analysis-card-meta">
                              <span className="tabular-nums">{fmt(s.startSec)} – {fmt(s.endSec)}</span>
                              <span>重點 {s.score}</span>
                              <span>鉤子 {s.hook}</span>
                              <span>高潮 {s.peak}</span>
                            </div>
                            <p>{s.transcript}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}