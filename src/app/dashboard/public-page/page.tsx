"use client";

import { useState, useEffect } from "react";
import { Link2, Copy, Check, Eye } from "lucide-react";
import { api } from "@/lib/api";

export default function PublicPage() {
  const [state, setState] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [origin, setOrigin] = useState("");
  const [live, setLive] = useState<{ connections?: any[] } | null>(null);
  useEffect(() => { setOrigin(window.location.origin); api.getUser().then(setState).catch(() => setError("載入失敗")).finally(() => setLoading(false)); }, []);

  // Live signal for the preview badge. Failure is silent on purpose: an
  // unreachable stats endpoint means "cannot tell", which must not read as
  // "live" nor as a page-level failure.
  useEffect(() => {
    fetch("/api/v1/stats")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => setLive(s))
      .catch(() => setLive({ connections: [] }));
  }, []);

  if (loading) return <div className="p-8 text-center text-[var(--ic-ink-muted)]">載入中...</div>;

  const update = async (partial: any) => {
    const merged = { ...state, ...partial };
    setState(merged);
    // Clear first and only on failure. `error` used to be set-on-failure and
    // never cleared, while the render below replaced the entire page with it --
    // so one failed keystroke-save destroyed the page with no way back except a
    // manual reload.
    setError(null);
    try {
      await api.updateUser(partial);
    } catch {
      setError("儲存失敗");
      // Roll back so the form stops showing a value the server rejected.
      setState((prev: any) => {
        const next = { ...prev };
        for (const k of Object.keys(partial)) next[k] = prev[k] && typeof prev[k] === "object" ? prev[k] : state[k];
        return next;
      });
    }
  };

  // A failed save is a banner, not the whole page.
  if (error && !state) return <div className="p-8 text-center text-red-500">{error}</div>;

  const avatarUrl = state.avatar || null;
  const previewUrl = `${origin}/@${state.username}`;
  const copyUrl = () => { navigator.clipboard.writeText(previewUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  // Live status comes from the platform connection, not from `publicPage`.
  // `publicPage` is a visibility switch, so keying the LIVE badge off it branded
  // every published page as live -- and contradicted the real /[username] page,
  // which renders an offline dot. /api/v1/stats already reports liveViewers and
  // liveUpdatedAt per platform.
  const liveConns = (live?.connections ?? []).filter((c: any) => (c.liveViewers ?? 0) > 0);
  const liveLine = !state.publicPage
    ? "🔴 頁面未公開"
    : liveConns.length > 0
      ? `🟢 直播中 · ${liveConns.map((c: any) => `${c.platform} ${c.liveViewers} 人`).join(" · ")}`
      : "⚪ 目前沒有直播中";

  return (
    <div className="max-w-[1180px]">
      <div className="mb-4 text-[13px] text-[var(--ic-ink-subtle)]">
        <a href="/dashboard" className="text-[var(--ic-primary)] no-underline">控制中心</a>
        <span className="mx-2 text-[var(--ic-ink-muted)]">/</span>
        <span className="text-[var(--ic-ink-muted)]">公開頁面</span>
      </div>
      <div className="mb-4 grid items-end gap-7 border-b border-[var(--ic-hairline)] pb-5 max-lg:grid-cols-1">
        <div>
          <h1 className="text-[clamp(30px,3vw,38px)] font-[500] leading-[1.12] text-[var(--ic-ink)]">公開頁面</h1>
          <p className="mt-2 max-w-[700px] text-[14px] leading-[1.6] text-[var(--ic-ink-muted)]">你的創作者個人頁面，觀眾可以在這裡看到你的直播資訊、贊助連結與精選內容。</p>
        </div>
      </div>
      <div className="mb-5 grid grid-cols-[1fr_310px] gap-[18px] items-start max-lg:grid-cols-1">
        <div className="rounded-[var(--ic-radius-lg)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <span className="text-[12px] font-[500] uppercase tracking-[0.04em] text-[var(--ic-ink-subtle)]">頁面預覽</span>
            <span className={`inline-flex items-center rounded-full border px-[10px] py-[2px] text-[11px] font-[500] ${state.publicPage ? "border-[rgba(11,223,80,.32)] bg-[rgba(11,223,80,.12)] text-[#075e28]" : "border-[var(--ic-hairline)] bg-[var(--ic-surface-3)] text-[var(--ic-ink-muted)]"}`}>
              {state.publicPage ? "已公開" : "未公開"}
            </span>
          </div>
          <div className="mb-4 rounded-[var(--ic-radius-lg)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-2)] p-4">
            <div className="mb-3 flex items-center gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--ic-surface-3)] overflow-hidden">
                {avatarUrl ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" /> : <span className="text-lg font-bold text-[var(--ic-fin-orange)]">{state.name?.charAt(0)}</span>}
              </div>
              <div>
                <div className="text-[18px] font-[600] text-[var(--ic-ink)]">{state.name}</div>
                <div className="text-[13px] text-[var(--ic-ink-muted)]">@{state.username}</div>
              </div>
            </div>
            <div className="text-[14px] text-[var(--ic-ink-subtle)]">{liveLine}</div>
          </div>
          <div className="mb-4 grid gap-3">
            <div className="grid gap-1">
              <span className="text-[12px] font-[500] text-[var(--ic-ink-muted)]">顯示名稱</span>
              <input value={state.name} onChange={e => update({ name: e.target.value })}
                className="rounded-[var(--ic-radius-md)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] px-3 py-2.5 text-[14px] text-[var(--ic-ink)] outline-none focus:border-[var(--ic-fin-orange)]" />
            </div>
            <div className="grid gap-1">
              <span className="text-[12px] font-[500] text-[var(--ic-ink-muted)]">使用者名稱</span>
              <div className="flex items-center gap-2">
                <span className="text-[14px] text-[var(--ic-ink-muted)]">@</span>
                <input value={state.username} onChange={e => update({ username: e.target.value.replace(/\s/g, "") })}
                  className="flex-1 rounded-[var(--ic-radius-md)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] px-3 py-2.5 text-[14px] text-[var(--ic-ink)] outline-none focus:border-[var(--ic-fin-orange)]" />
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-[var(--ic-radius-md)] border border-[var(--ic-hairline)] bg-[var(--ic-canvas)] px-3 py-2.5">
              <Link2 className="h-4 w-4 flex-shrink-0 text-[var(--ic-ink-muted)]" />
              {/* ★ 用 inline style，不是因為偷懶。
                  設計系統有 [data-...=dashboard] a { color:inherit; text-decoration:inherit }
                  特異度 0-1-1，會蓋掉任何工具類（0-1-0）。
                  實測：text-[#0b5fd0] 與 underline 都被吃掉，
                  連結看起來跟一般文字一樣，使用者不會知道能點。
                  inline style 只輸給 !important，這裡沒有正當理由用那麼重的手段。*/}
              <a href={previewUrl} target="_blank" rel="noopener noreferrer"
                style={{ color: "#0b5fd0", textDecoration: "underline", textUnderlineOffset: "2px" }}
                className="truncate text-[13px]"
                title="在新分頁開啟你的公開頁面">
                {previewUrl}
              </a>
            </div>
            {/* ★ 同時給一個明確的「看頁面」按鈕。
                只給複製鈕的話，使用者得自己開新分頁貼上網址 ——
                已經在設定頁了，按一下就看得到效果才對。*/}
            <a href={previewUrl} target="_blank" rel="noopener noreferrer"
              className="secondary-button inline-flex min-h-[36px] flex-shrink-0 items-center gap-1.5"
              title="在新分頁開啟你的公開頁面">
              <Eye className="h-4 w-4" /> 看頁面
            </a>
            <button onClick={copyUrl} className="flex min-h-[36px] flex-shrink-0 items-center gap-1.5 rounded-[var(--ic-radius-md)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] px-3 text-[13px] font-[500] text-[var(--ic-ink)] transition-all hover:border-[var(--ic-hairline-strong)]">
              {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
              {copied ? "已複製" : "複製"}
            </button>
          </div>
        </div>
        <div className="sticky top-[82px] grid gap-4 rounded-[var(--ic-radius-lg)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] p-[22px]">
          <span className="text-[12px] font-[500] uppercase tracking-[0.04em] text-[var(--ic-ink-subtle)]">頁面設定</span>
          <div className="flex items-center justify-between gap-4 border-t border-[var(--ic-hairline-tertiary)] pt-4">
            <span className="text-[15px] font-[650] text-[var(--ic-ink)]">公開頁面</span>
            <button onClick={() => update({ publicPage: !state.publicPage })}
              className={`relative h-6 w-11 rounded-full border p-0 transition-all ${state.publicPage ? "border-[var(--ic-fin-orange)] bg-[var(--ic-fin-orange)]" : "border-[var(--ic-hairline-strong)] bg-[var(--ic-surface-4)]"}`}>
              <span className={`absolute top-[2px] block h-[18px] w-[18px] rounded-full bg-white transition-all ${state.publicPage ? "left-[21px]" : "left-[2px]"}`} />
            </button>
          </div>
          <div className="flex items-center gap-2 rounded-[var(--ic-radius-md)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-3)] p-3">
            {state.publicPage ? <Check className="h-4 w-4 flex-shrink-0 text-green-600" /> : <Link2 className="h-4 w-4 flex-shrink-0 text-[var(--ic-ink-muted)]" />}
            {/* ★ 已公開時整句變成連結。
                只寫「觀眾可瀏覽」卻不給入口，使用者得自己從上面的網址框複製 ——
                明明一步就能點，卻要三步。
                ★ 用色碼而非 var(--ic-ink-muted)：那個是灰色文字，
                  配綠色勾在看起來像「已停用」。*/}
            {state.publicPage ? (
              <a href={previewUrl} target="_blank" rel="noopener noreferrer"
              style={{ color: "#075e28", textDecoration: "underline", textUnderlineOffset: "2px" }}
              className="text-[13px] font-[500]"
              title="在新分頁開啟你的公開頁面">
              頁面已公開 — 點這裡預覽觀眾看到的樣子
            </a>
            ) : (
              <span className="text-[13px] text-[var(--ic-ink-muted)]">開啟後觀眾即可瀏覽你的公開頁面</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
