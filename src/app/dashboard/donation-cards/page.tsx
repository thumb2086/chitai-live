"use client";

import {
  PageHeader, Panel, Btn, Field, Input, SelectRow, Toggle, Badge, useFeature,
} from "@/components/ui";
import { OverlayOutput, OverlayTokenProvider } from "@/components/overlay-settings";
import { Layers2, Play } from "lucide-react";
import { useState } from "react";

type Card = {
  id: string;
  name: string;
  rarity: string;
  amount: number;
  emoji: string;
  multiplier: string;
  enabled: boolean;
};
type Cfg = {
  enabled: boolean;
  showOnOverlay: boolean;
  revealSeconds: string;
  layout: string;
  cards: Card[];
};

const DEFAULTS: Cfg = {
  enabled: true,
  showOnOverlay: true,
  revealSeconds: "8",
  layout: "3x2",
  cards: [
    { id: "c1", name: "感謝 supporter", rarity: "SR", amount: 100, emoji: "🌟", multiplier: "2", enabled: true },
    { id: "c2", name: "熬夜剪輯", rarity: "SSR", amount: 300, emoji: "⚡", multiplier: "3", enabled: true },
    { id: "c3", name: "今日運氣", rarity: "R", amount: 50, emoji: "🍀", multiplier: "1.5", enabled: true },
    { id: "c4", name: "年度好運", rarity: "UR", amount: 500, emoji: "🐉", multiplier: "5", enabled: false },
  ],
};

const uid = () => Math.random().toString(36).slice(2, 9);
const RARITY: Record<string, { bg: string; fg: string }> = {
  R: { bg: "#e6ebf2", fg: "#475569" },
  SR: { bg: "#dbeafe", fg: "#1d4ed8" },
  SSR: { bg: "#fef3c7", fg: "#b45309" },
  UR: { bg: "#fde68a", fg: "#92400e" },
};

export default function DonationCardsPage() {
  return (
    <OverlayTokenProvider overlayKey="donation-cards">
      <DonationCardsInner />
    </OverlayTokenProvider>
  );
}

function DonationCardsInner() {
  const { value: c, set, save, saving, saved } = useFeature<Cfg>("donation-cards", DEFAULTS);
  const [preview, setPreview] = useState<string | null>(null);

  const setCards = (cards: Card[]) => set("cards", cards);
  const patch = (id: string, p: Partial<Card>) => setCards(c.cards.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const add = () =>
    setCards([...c.cards, { id: uid(), name: `新卡牌 ${c.cards.length + 1}`, rarity: "R", amount: 50, emoji: "🎴", multiplier: "1", enabled: true }]);

  return (
    <>
      <PageHeader
        title="斗內卡牌"
        description="觀眾斗內後隨機抽到一張卡牌，卡牌稀有度與倍率由你設定。可直接疊在直播畫面上，讓每次斗內都有抽卡的儀式感。"
        actions={<Badge tone={c.enabled ? "ok" : "neutral"}>{c.enabled ? "已啟用" : "已停用"}</Badge>}
      />

      <div className="grid gap-[18px] lg:grid-cols-[minmax(0,520px)_minmax(0,1fr)]">
        <div className="flex flex-col gap-[18px]">
          <Panel title="抽卡設定">
            <div className="flex flex-col gap-[16px]">
              <Toggle label="啟用抽卡" checked={c.enabled} onChange={(v) => set("enabled", v)} />
              <Toggle
                label="直接顯示在疊加層"
                hint="關閉後只開放 API 抽卡，不自動跳出動畫。"
                checked={c.showOnOverlay}
                onChange={(v) => set("showOnOverlay", v)}
              />
              <div className="grid grid-cols-2 gap-[14px]">
                <Field label="翻牌秒數">
                  <Input type="number" min={2} max={30} value={c.revealSeconds} onChange={(e) => set("revealSeconds", e.target.value)} />
                </Field>
                <SelectRow
                  label="疊加層排列"
                  value={c.layout}
                  options={[
                    { value: "3x2", label: "3 × 2" },
                    { value: "4x2", label: "4 × 2" },
                    { value: "單排", label: "單排" },
                  ]}
                  onChange={(v) => set("layout", v)}
                />
              </div>
            </div>
          </Panel>

          <Panel
            title="卡牌清單"
            actions={
              <Btn variant="secondary" className="min-h-[34px] px-[14px] text-[14px]" onClick={add}>
                + 新增
              </Btn>
            }
          >
            <div className="flex flex-col gap-[10px]">
              {c.cards.map((card) => (
                <div key={card.id} className="flex flex-wrap items-center gap-[8px] rounded-[var(--ic-radius-md)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-2)] p-[10px]">
                  <Input
                    value={card.emoji}
                    onChange={(e) => patch(card.id, { emoji: e.target.value.slice(0, 2) })}
                    className="w-[54px] flex-shrink-0 text-center text-[18px]"
                  />
                  <Input
                    value={card.name}
                    onChange={(e) => patch(card.id, { name: e.target.value })}
                    className="min-w-[110px] flex-1"
                    placeholder="卡牌名稱"
                  />
                  <SelectRow
                    label=""
                    value={card.rarity}
                    options={Object.keys(RARITY).map((k) => ({ value: k, label: k }))}
                    onChange={(v) => patch(card.id, { rarity: v })}
                  />
                  <div className="flex items-center gap-[6px]">
                    <Input
                      type="number"
                      value={card.amount}
                      onChange={(e) => patch(card.id, { amount: Number(e.target.value) })}
                      className="w-[84px]"
                      title="門檻金額"
                    />
                    <span className="text-[13px] text-[var(--ic-ink-muted)]">元起</span>
                  </div>
                  <div className="flex items-center gap-[6px]">
                    <span className="text-[13px] text-[var(--ic-ink-muted)]">×</span>
                    <Input
                      value={card.multiplier}
                      onChange={(e) => patch(card.id, { multiplier: e.target.value })}
                      className="w-[62px]"
                      title="倍率"
                    />
                  </div>
                  <button
                    onClick={() => setCards(c.cards.filter((x) => x.id !== card.id))}
                    className="flex-shrink-0 px-[6px] text-[var(--ic-ink-tertiary)] hover:text-[var(--ic-danger)]"
                    title="刪除"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </Panel>

          {/* Real token URL from the overlay API, plus a reissue button.
              This used to copy the literal string "/overlay/donation-cards/[token]",
              which pasted a URL that cannot resolve. */}
          <OverlayOutput title="OBS 輸出" />

          <Btn onClick={save} disabled={saving}>
            {saving ? "儲存中…" : saved ? "已儲存" : "儲存設定"}
          </Btn>
        </div>

        <Panel title="預覽" description="點擊任一張卡牌可預覽抽中時的翻牌動畫。">
          <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-[var(--ic-radius-md)] border border-[var(--ic-hairline)] bg-[#101a2b]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_20%,rgba(29,78,216,.35),transparent_55%)]" />
            <div
              className="relative grid gap-[10px]"
              style={{
                gridTemplateColumns:
                  c.layout === "單排" ? "repeat(4, minmax(0,1fr))" : c.layout === "4x2" ? "repeat(4, minmax(0,1fr))" : "repeat(3, minmax(0,1fr))",
                opacity: c.enabled ? 1 : 0.3,
                width: c.layout === "單排" ? "100%" : "86%",
              }}
            >
              {c.cards.map((card) => {
                const r = RARITY[card.rarity] ?? RARITY.R;
                return (
                  <button
                    key={card.id}
                    onClick={() => setPreview(card.id)}
                    className="flex aspect-[3/4] flex-col items-center justify-center gap-[6px] rounded-[12px] border p-[8px] transition-transform hover:scale-[1.04]"
                    style={{
                      background: `linear-gradient(160deg, ${r.bg}, #ffffff)`,
                      borderColor: card.enabled ? "transparent" : "var(--ic-hairline)",
                      opacity: card.enabled ? 1 : 0.45,
                      boxShadow: "0 6px 18px rgba(15,23,42,.16)",
                    }}
                  >
                    <span className="text-[10px] font-[800]" style={{ color: r.fg }}>{card.rarity}</span>
                    <span className="text-[26px] leading-none">{card.emoji}</span>
                    <span className="line-clamp-2 text-center text-[11px] font-[700] text-[#0d111a]">{card.name}</span>
                    <span className="text-[10px] text-[#64748b]">×{card.multiplier}</span>
                  </button>
                );
              })}
            </div>
          </div>
          {preview && (
            <div className="mt-[14px] rounded-[var(--ic-radius-md)] border border-[var(--ic-brand-accent-border)] bg-[var(--ic-brand-accent-soft)] px-[16px] py-[14px]">
              <div className="flex items-center gap-2 text-[14px] font-[700] text-[var(--ic-brand-accent)]">
                <Play size={15} /> 抽卡結果預覽
              </div>
              <p className="mt-[6px] text-[14px] text-[var(--ic-ink-subtle)]">
                觀眾斗內 ≥ {c.cards.find((x) => x.id === preview)?.amount} 元時，有機會抽到「{c.cards.find((x) => x.id === preview)?.name}」，
                倍率 ×{c.cards.find((x) => x.id === preview)?.multiplier}，翻牌動畫 {c.revealSeconds} 秒。
              </p>
            </div>
          )}
          <div className="mt-[14px] flex items-center gap-2 text-[13px] text-[var(--ic-ink-muted)]">
            <Layers2 size={15} /> 共 {c.cards.length} 張卡牌，其中 {c.cards.filter((x) => x.enabled).length} 張啟用
          </div>
        </Panel>
      </div>
    </>
  );
}