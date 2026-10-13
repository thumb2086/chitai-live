"use client";

import { useState, useEffect } from "react";
import { Gift, Plus, Trash2, Users, Dices, Eraser, Trophy } from "lucide-react";
import { api } from "@/lib/api";

/**
 * 抽獎活動
 *
 * 這個頁面補上 livio 有、我們缺的「抽獎活動」。
 * 後端 13 個端點早就在 /api/v1/giveaways（這次才 migrate 完 Neon HTTP），
 * 但前端一直沒有頁面 —— API 做了等於沒做。
 *
 * ── 為什麼 UI 不做抽獎邏輯 ──────────────────────────────────
 *
 * · 中獎隨機數**必須**在伺服器端產生。
 *   前端抽的話，使用者可以重複抽、或直接改結果。
 *   （後端 route.ts:65 用 crypto.getRandomValues + 整數除法）
 * · 所有權（join / draw / clear 只能操作自己的抽獎）在伺服器端。
 * · 所以這裡只是按鈕 → 呼叫 API → 重新渲染。
 *   前端不做任何「決定」。
 */

type Entrant = { id: string; name: string; createdAt: string };
type Giveaway = {
  id: string;
  title: string;
  keyword: string;
  enabled: boolean;
  winner: string;
  createdAt: string;
  entrants: Entrant[];
};

export default function GiveawaysPage() {
  const [giveaways, setGiveaways] = useState<Giveaway[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [keyword, setKeyword] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [joinName, setJoinName] = useState<Record<string, string>>({});

  const refresh = async () => {
    try {
      const r = await api.getGiveaways();
      setGiveaways(r.giveaways || []);
    } catch {
      setError("載入失敗");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const apply = (r: { giveaways?: any[] } | null) => {
    if (r?.giveaways) setGiveaways(r.giveaways);
  };

  const add = async () => {
    setError(null);
    try {
      apply(await api.addGiveaway({ title: title.trim(), keyword: keyword.trim() }));
      setTitle("");
      setKeyword("");
    } catch (e: any) {
      setError(e?.message || "新增失敗（標題必填）");
    }
  };

  const toggle = async (g: Giveaway) => {
    setBusy(g.id);
    apply(await api.toggleGiveaway(g.id, !g.enabled).catch(() => null));
    setBusy(null);
  };

  const remove = async (g: Giveaway) => {
    if (!confirm(`刪除抽獎「${g.title}」？參與名單也會一起刪除。`)) return;
    setBusy(g.id);
    apply(await api.deleteGiveaway(g.id).catch(() => null));
    setBusy(null);
  };

  const join = async (g: Giveaway) => {
    const name = (joinName[g.id] || "").trim();
    if (!name) return;
    setBusy(g.id);
    try {
      apply(await api.joinGiveaway(g.id, name));
      setJoinName((s) => ({ ...s, [g.id]: "" }));
    } catch (e: any) {
      setError(e?.message || "加入失敗（抽獎可能已停用）");
    } finally {
      setBusy(null);
    }
  };

  // ⚠️ 中獎在伺服器端抽，這裡只是觸發。
  const draw = async (g: Giveaway) => {
    if (!confirm(`從 ${g.entrants.length} 位參與者中抽出中獎者？`)) return;
    setBusy(g.id);
    try {
      apply(await api.drawGiveaway(g.id));
    } catch (e: any) {
      setError(e?.message || "抽獎失敗（可能沒有參與者）");
    } finally {
      setBusy(null);
    }
  };

  const clear = async (g: Giveaway) => {
    if (!confirm(`清空「${g.title}」的參與名單與中獎者？`)) return;
    setBusy(g.id);
    apply(await api.clearGiveaway(g.id).catch(() => null));
    setBusy(null);
  };

  if (loading) return <div className="p-8 text-center text-[var(--ic-ink-muted)]">載入中...</div>;

  return (
    <div className="max-w-[1080px]">
      <div className="mb-4 text-[13px] text-[var(--ic-ink-subtle)]">
        <a href="/dashboard" className="text-[var(--ic-primary)] no-underline">控制中心</a>
        <span className="mx-2 text-[var(--ic-ink-muted)]">/</span>
        <span className="text-[var(--ic-ink-muted)]">抽獎活動</span>
      </div>

      <div className="mb-6 grid gap-2">
        <h1 className="text-[34px] font-[500] leading-[1.12] text-[var(--ic-ink)]">抽獎活動</h1>
        <p className="max-w-[520px] text-[14px] leading-[1.6] text-[var(--ic-ink-muted)]">
          建立抽獎並收集觀眾報名。關鍵字可留空；中獎由伺服器抽出，無法在前端重複操作。
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-[var(--ic-radius-md)] border border-red-200 bg-red-50 p-3 text-[13px] text-red-600">
          {error}
        </div>
      )}

      <div className="grid gap-3.5 rounded-[var(--ic-radius-lg)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] p-6">
        <div className="grid grid-cols-[1fr_180px_auto] gap-2 max-md:grid-cols-1">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") add(); }}
            placeholder="抽獎名稱（最多 80 字）"
            className="rounded-[var(--ic-radius-md)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] px-3 py-2.5 text-[14px] text-[var(--ic-ink)] outline-none"
          />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") add(); }}
            placeholder="關鍵字（選填）"
            className="rounded-[var(--ic-radius-md)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] px-3 py-2.5 text-[14px] text-[var(--ic-ink)] outline-none"
          />
          <button
            onClick={add}
            className="flex min-h-[36px] items-center justify-center gap-1.5 rounded-[var(--ic-radius-md)] border border-transparent bg-[var(--ic-primary)] px-3.5 text-[13px] font-[500] text-white"
          >
            <Plus className="h-4 w-4" /> 新增
          </button>
        </div>

        <div className="grid gap-2">
          {giveaways.length === 0 && (
            <p className="py-6 text-center text-[14px] text-[var(--ic-ink-muted)]">尚無抽獎活動</p>
          )}

          {giveaways.map((g) => {
            const open = expanded === g.id;
            return (
              <div
                key={g.id}
                className="rounded-[var(--ic-radius-md)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)]"
              >
                <div className="flex items-center gap-3 p-3">
                  <Gift className="h-4 w-4 flex-shrink-0 text-[var(--ic-ink-tertiary)]" />

                  <div className="min-w-0 flex-1">
                    <strong className="block truncate text-[13px] text-[var(--ic-ink)]">{g.title}</strong>
                    <span className="text-[12px] text-[var(--ic-ink-muted)]">
                      {g.keyword && <>關鍵字「{g.keyword}」 · </>}
                      <Users className="mb-0.5 inline h-3 w-3" /> {g.entrants.length} 人
                      {g.winner && <> · 中獎：<span className="font-[600] text-[var(--ic-primary)]">{g.winner}</span></>}
                    </span>
                  </div>

                  <button
                    onClick={() => toggle(g)}
                    disabled={busy === g.id}
                    className={`rounded-full px-2.5 py-0.5 text-[11px] disabled:opacity-50 ${
                      g.enabled ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {g.enabled ? "啟用" : "停用"}
                  </button>

                  <button
                    onClick={() => setExpanded(open ? null : g.id)}
                    title="參與名單"
                    className="rounded p-1 text-[var(--ic-ink-tertiary)] hover:text-[var(--ic-ink)]"
                  >
                    <Users className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => draw(g)}
                    disabled={busy === g.id || g.entrants.length === 0}
                    title={g.entrants.length === 0 ? "沒有參與者" : "抽出中獎者"}
                    className="rounded p-1 text-[var(--ic-ink-tertiary)] hover:text-[var(--ic-primary)] disabled:opacity-30"
                  >
                    <Dices className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => clear(g)}
                    disabled={busy === g.id || g.entrants.length === 0}
                    title="清空名單"
                    className="rounded p-1 text-[var(--ic-ink-tertiary)] hover:text-amber-600 disabled:opacity-30"
                  >
                    <Eraser className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => remove(g)}
                    disabled={busy === g.id}
                    className="rounded p-1 text-[var(--ic-ink-tertiary)] hover:text-red-500"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                {open && (
                  <div className="border-t border-[var(--ic-hairline)] p-3">
                    <div className="mb-3 grid grid-cols-[1fr_auto] gap-2 max-sm:grid-cols-1">
                      <input
                        value={joinName[g.id] || ""}
                        onChange={(e) => setJoinName((s) => ({ ...s, [g.id]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === "Enter") join(g); }}
                        placeholder="手動加入報名（最多 40 字）"
                        disabled={!g.enabled}
                        className="rounded-[var(--ic-radius-md)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] px-3 py-2 text-[13px] outline-none disabled:opacity-50"
                      />
                      <button
                        onClick={() => join(g)}
                        disabled={busy === g.id || !g.enabled || !(joinName[g.id] || "").trim()}
                        className="min-h-[34px] rounded-[var(--ic-radius-md)] border border-[var(--ic-hairline)] px-3 text-[13px] disabled:opacity-40"
                      >
                        加入
                      </button>
                    </div>

                    {g.entrants.length === 0 ? (
                      <p className="py-3 text-center text-[13px] text-[var(--ic-ink-muted)]">尚無參與者</p>
                    ) : (
                      <ul className="grid gap-1">
                        {g.entrants.map((e) => (
                          <li
                            key={e.id}
                            className={`flex items-center gap-2 rounded px-2 py-1 text-[13px] ${
                              e.name === g.winner
                                ? "bg-amber-50 text-amber-800"
                                : "text-[var(--ic-ink-muted)]"
                            }`}
                          >
                            {e.name === g.winner && <Trophy className="h-3.5 w-3.5 flex-shrink-0" />}
                            <span className="truncate">{e.name}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}