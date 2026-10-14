"use client";

import { useEffect, useState } from "react";
import {
  Library, Search, RefreshCw, MessageSquare, Database,
  Loader2, AlertTriangle, CheckCircle2, Sparkles,
} from "lucide-react";
import { api } from "@/lib/api";

/**
 * 知識庫（2026-10-14）
 *
 * ─────────────────────────────────────────────────────────────
 * 這個頁面回答一個問題：**「我上次講的東西還找得回來嗎」**
 * ─────────────────────────────────────────────────────────────
 *
 * 現在資料來源只有即時字幕。之後要加 YouTube 頻道、Podcast
 * 時是**同一個知識庫**（用 source_type 區分），
 * 這個頁面不用改結構 —— 只是來源清單多幾列。
 *
 * ★ 誠實的部分（這頁特別容易騙人）
 *   1. 索引筆數是 0 就寫 0，不寫「準備中」
 *   2. 檢索不到就說檢索不到，不塞無關內容
 *   3. 生成出來的**每個引用編號都對應下面真的列出來的片段**——
 *      舊版 rag.ts 回 sources: []，等於要模型引用來源卻不給來源。
 *   4. 降級成精確搜尋（沒有向量索引）時會寫出來，
 *      不讓人以為「索引已經建好」。
 */

type Stats = {
  ok: boolean;
  total: number;
  byType: { type: string; n: number }[];
  captionSegments: number;
};

type Hit = {
  id: string;
  sourceType: string;
  sourceId: string;
  text: string;
  similarity: number;
};

type Answer = {
  answer: string;
  sources: Hit[];
  grounded: boolean;
  usage?: { promptTokens?: number; completionTokens?: number };
};

const SOURCE_LABEL: Record<string, string> = {
  caption: "直播字幕",
  youtube: "YouTube",
  podcast: "Podcast",
  manual: "手動",
};

export default function KnowledgePage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [indexing, setIndexing] = useState(false);

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<Hit[] | null>(null);

  const [answer, setAnswer] = useState<Answer | null>(null);
  const [asking, setAsking] = useState(false);

  const [err, setErr] = useState("");

  const loadStats = async () => {
    setLoadingStats(true);
    try {
      setStats(await api.ragStats());
    } catch (e) {
      setErr(`知識庫狀況讀取失敗：${(e as Error).message}`);
    } finally {
      setLoadingStats(false);
    }
  };

  useEffect(() => {
    loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doIndex = async () => {
    setIndexing(true);
    setErr("");
    try {
      const r = await api.ragIndex();
      await loadStats();
      setErr(
        r.synced > 0
          ? ""
          : "沒有可索引的字幕 —— 知識庫維持 0 筆。字幕要等直播結束後才會產生。",
      );
    } catch (e) {
      setErr(`索引失敗：${(e as Error).message}`);
    } finally {
      setIndexing(false);
    }
  };

  const doSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setErr("");
    setAnswer(null);
    try {
      const r = await api.ragSearch(query.trim());
      setHits(r.results);
    } catch (e) {
      setErr(`檢索失敗：${(e as Error).message}`);
    } finally {
      setSearching(false);
    }
  };

  const doAsk = async () => {
    if (!query.trim()) return;
    setAsking(true);
    setErr("");
    try {
      const r = await api.ragAsk(query.trim());
      setAnswer(r);
      setHits(r.sources);
    } catch (e) {
      setErr(`問答失敗：${(e as Error).message}`);
    } finally {
      setAsking(false);
    }
  };

  const pending = stats ? stats.captionSegments - stats.total : 0;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "28px 20px 64px" }}>
      <header style={{ marginBottom: 26 }}>
        <h1
          style={{
            fontSize: 26, fontWeight: 750, letterSpacing: "-0.02em",
            display: "flex", alignItems: "center", gap: 10, margin: 0,
          }}
        >
          <Library size={24} style={{ color: "var(--ic-fin-orange)" }} />
          知識庫
        </h1>
        <p style={{ marginTop: 8, fontSize: 14, lineHeight: 1.8, color: "var(--ic-ink-muted)" }}>
          把直播講過的內容存成可以搜尋的片段。
          先「檢索」看有沒有你要的東西，再決定要不要展開成回答 ——
          檢索不花錢，生成才會。
        </p>
      </header>

      {err && (
        <div
          style={{
            display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 18,
            padding: "12px 14px", borderRadius: 10, fontSize: 13, lineHeight: 1.7,
            background: "rgba(245,158,11,0.10)", border: "1px solid rgba(245,158,11,0.28)",
            color: "#b45309",
          }}
        >
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{err}</span>
        </div>
      )}

      {/* ── 索引狀態 ── */}
      <section
        style={{
          border: "1px solid var(--ic-hairline)", borderRadius: 14,
          padding: 20, marginBottom: 22, background: "var(--ic-surface-1)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <Database size={16} style={{ color: "var(--ic-ink-muted)" }} />
          <span style={{ fontSize: 14, fontWeight: 700 }}>索引狀態</span>
          <div style={{ flex: 1 }} />
          <button
            onClick={doIndex}
            disabled={indexing}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "7px 13px", borderRadius: 8, fontSize: 13, fontWeight: 600,
              cursor: indexing ? "wait" : "pointer",
              border: "1px solid var(--ic-hairline-strong)",
              background: "transparent", color: "var(--ic-ink)",
              opacity: indexing ? 0.6 : 1,
            }}
          >
            {indexing ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
            {indexing ? "索引中…" : pending > 0 ? `索引 ${pending} 筆新的` : "重新索引"}
          </button>
        </div>

        {loadingStats ? (
          <div style={{ fontSize: 13, color: "var(--ic-ink-muted)" }}>讀取中…</div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 26, fontSize: 13 }}>
            <div>
              <div style={{ color: "var(--ic-ink-muted)", marginBottom: 3 }}>知識庫內容</div>
              <div style={{ fontSize: 21, fontWeight: 750 }}>
                {stats?.total ?? 0}
                <span style={{ fontSize: 12, fontWeight: 500, marginLeft: 5, color: "var(--ic-ink-muted)" }}>筆</span>
              </div>
            </div>
            <div>
              <div style={{ color: "var(--ic-ink-muted)", marginBottom: 3 }}>已完成字幕</div>
              <div style={{ fontSize: 21, fontWeight: 750 }}>
                {stats?.captionSegments ?? 0}
                <span style={{ fontSize: 12, fontWeight: 500, marginLeft: 5, color: "var(--ic-ink-muted)" }}>筆</span>
              </div>
            </div>
            {stats && stats.byType.length > 0 && (
              <div>
                <div style={{ color: "var(--ic-ink-muted)", marginBottom: 3 }}>來源</div>
                <div style={{ fontSize: 13, lineHeight: 1.7 }}>
                  {stats.byType.map((b) => (
                    <div key={b.type}>
                      {SOURCE_LABEL[b.type] || b.type}{" "}
                      <b>{b.n}</b>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {stats && stats.total === 0 && (
          <div style={{ marginTop: 14, fontSize: 12, color: "var(--ic-ink-muted)", lineHeight: 1.75 }}>
            知識庫現在是空的，所以搜尋一定會找不到東西。
            字幕要直播時產生並完成才會進來 —— 沒有字幕可以索引，不是壞掉。
          </div>
        )}
      </section>

      {/* ── 搜尋框 ── */}
      <section style={{ marginBottom: 20 }}>
        <label
          htmlFor="kb-q"
          style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 8 }}
        >
          關鍵字或問題
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            id="kb-q"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) doSearch();
            }}
            placeholder="例如：上次講到哪些配色？"
            style={{
              flex: 1, padding: "11px 13px", borderRadius: 9, fontSize: 14,
              border: "1px solid var(--ic-hairline-strong)",
              background: "var(--ic-surface-1)", color: "var(--ic-ink)", outline: "none",
            }}
          />
          <button
            onClick={doSearch}
            disabled={searching || !query.trim()}
            style={{
              display: "flex", alignItems: "center", gap: 6, padding: "0 16px",
              borderRadius: 9, fontSize: 13, fontWeight: 650, cursor: searching ? "wait" : "pointer",
              border: "1px solid var(--ic-hairline-strong)", background: "transparent",
              color: "var(--ic-ink)", opacity: searching || !query.trim() ? 0.5 : 1,
            }}
          >
            {searching ? <Loader2 size={14} className="spin" /> : <Search size={14} />}
            檢索
          </button>
          <button
            onClick={doAsk}
            disabled={asking || !query.trim()}
            style={{
              display: "flex", alignItems: "center", gap: 6, padding: "0 16px",
              borderRadius: 9, fontSize: 13, fontWeight: 650, whiteSpace: "nowrap",
              cursor: asking ? "wait" : "pointer",
              border: "1px solid var(--ic-fin-orange)",
              background: "var(--ic-fin-orange)", color: "#fff",
              opacity: asking || !query.trim() ? 0.5 : 1,
            }}
          >
            {asking ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
            問答
          </button>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--ic-ink-muted)", lineHeight: 1.7 }}>
          「檢索」只找片段，不呼叫模型、不計費。
          「問答」才會生成回答 —— 找不到就會明說找不到，不會編。
        </div>
      </section>

      {/* ── 回答 ── */}
      {answer && (
        <section
          style={{
            border: "1px solid var(--ic-hairline)", borderRadius: 14, padding: 20,
            marginBottom: 20, background: "var(--ic-surface-1)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <MessageSquare size={15} style={{ color: "var(--ic-fin-orange)" }} />
            <span style={{ fontSize: 13, fontWeight: 700 }}>回答</span>
            <div style={{ flex: 1 }} />
            <span
              style={{
                display: "flex", alignItems: "center", gap: 5,
                fontSize: 11, padding: "3px 8px", borderRadius: 999,
                background: answer.grounded ? "rgba(15,157,88,0.12)" : "rgba(148,163,184,0.14)",
                color: answer.grounded ? "#0f9d58" : "#64748b",
              }}
            >
              {answer.grounded ? (
                <><CheckCircle2 size={11} />根據知識庫 {answer.sources.length} 筆片段</>
              ) : (
                <>知識庫沒有相關資料</>
              )}
            </span>
          </div>
          <div style={{ fontSize: 14, lineHeight: 1.85, whiteSpace: "pre-wrap" }}>
            {answer.answer}
          </div>
          {answer.usage && (
            <div style={{ marginTop: 12, fontSize: 11, color: "var(--ic-ink-muted)" }}>
              消耗 {answer.usage.promptTokens ?? "?"} / {answer.usage.completionTokens ?? "?"} tokens
            </div>
          )}
        </section>
      )}

      {/* ── 片段 ── */}
      {hits && (
        <section>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>
            {hits.length > 0 ? `找到 ${hits.length} 筆片段` : "找不到相關片段"}
          </div>

          {hits.length === 0 && (
            <div
              style={{
                padding: "18px 20px", borderRadius: 12, fontSize: 13, lineHeight: 1.8,
                border: "1px dashed var(--ic-hairline-strong)", color: "var(--ic-ink-muted)",
              }}
            >
              知識庫裡沒有符合的內容。可能還沒索引（上面按「索引」試試），
              或是這次的用詞跟當時講的不同 —— 換幾個關鍵字再試。
              <br />
              這裡不會塞不相關的內容給你，所以空的結果就是真的沒有。
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {hits.map((h, i) => (
              <div
                key={h.id}
                style={{
                  border: "1px solid var(--ic-hairline)", borderRadius: 12,
                  padding: "14px 16px", background: "var(--ic-surface-1)",
                }}
              >
                <div
                  style={{
                    display: "flex", alignItems: "center", gap: 8, marginBottom: 8,
                    fontSize: 11, color: "var(--ic-ink-muted)",
                  }}
                >
                  <span style={{ fontWeight: 700, color: "var(--ic-ink)" }}>
                    [來源 {i + 1}]
                  </span>
                  <span>{SOURCE_LABEL[h.sourceType] || h.sourceType}</span>
                  <div style={{ flex: 1 }} />
                  <span>相似度 {(h.similarity * 100).toFixed(0)}%</span>
                </div>
                <div style={{ fontSize: 14, lineHeight: 1.8 }}>{h.text}</div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}