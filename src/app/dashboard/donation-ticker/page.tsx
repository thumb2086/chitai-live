"use client";

import {
  PageHeader, Panel, Btn, Field, Input, SelectRow, Toggle, Badge, useFeature,
} from "@/components/ui";
import { OverlayOutput, OverlayTokenProvider } from "@/components/overlay-settings";
import { MoveHorizontal, Play } from "lucide-react";

type Cfg = {
  enabled: boolean;
  position: string;
  speed: string;
  direction: string;
  fontSize: string;
  showAmount: boolean;
  showMessage: boolean;
  showAvatar: boolean;
  background: string;
  textColor: string;
  accent: string;
  separator: string;
  maxItems: string;
};

const DEFAULTS: Cfg = {
  enabled: true,
  position: "底部",
  speed: "中",
  direction: "由右至左",
  fontSize: "中",
  showAmount: true,
  showMessage: true,
  showAvatar: false,
  background: "rgba(13,17,26,0.85)",
  textColor: "#ffffff",
  accent: "#059669",
  separator: "💛",
  maxItems: "5",
};

export default function DonationTickerPage() {
  return (
    <OverlayTokenProvider overlayKey="donation-ticker">
      <DonationTickerInner />
    </OverlayTokenProvider>
  );
}

function DonationTickerInner() {
  const { value: c, set, save, saving, saved } = useFeature<Cfg>("donation-ticker", DEFAULTS);

  const sample = [
    { name: "小明", amount: 100, msg: "繼續加油！" },
    { name: "阿花", amount: 300, msg: "GG" },
    { name: "Ghost", amount: 50, msg: "" },
  ];

  const speedMap: Record<string, number> = { 慢: 42, 中: 26, 快: 15 };
  const sizeMap: Record<string, number> = { 小: 13, 中: 16, 大: 20, 特大: 26 };

  return (
    <>
      <PageHeader
        title="斗內跑馬燈"
        description="把最新的斗內以橫向跑馬燈形式滾動顯示在直播畫面上。適合放在聊天視窗上方或版頭下方，補上靜態斗內榜單看不到的即時回饋。"
        actions={<Badge tone={c.enabled ? "ok" : "neutral"}>{c.enabled ? "已啟用" : "已停用"}</Badge>}
      />

      <div className="grid gap-[18px] lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)]">
        <div className="flex flex-col gap-[18px]">
          <Panel title="顯示設定">
            <div className="flex flex-col gap-[16px]">
              <Toggle label="啟用跑馬燈" checked={c.enabled} onChange={(v) => set("enabled", v)} />
              <div className="h-px bg-[var(--ic-hairline)]" />
              <div className="grid grid-cols-2 gap-[14px]">
                <SelectRow
                  label="位置"
                  value={c.position}
                  options={[
                    { value: "頂部", label: "螢幕頂部" },
                    { value: "底部", label: "螢幕底部" },
                  ]}
                  onChange={(v) => set("position", v)}
                />
                <SelectRow
                  label="方向"
                  value={c.direction}
                  options={[
                    { value: "由右至左", label: "由右至左" },
                    { value: "由左至右", label: "由左至右" },
                  ]}
                  onChange={(v) => set("direction", v)}
                />
              </div>
              <div className="grid grid-cols-2 gap-[14px]">
                <SelectRow
                  label="捲動速度"
                  value={c.speed}
                  options={[{ value: "慢", label: "慢" }, { value: "中", label: "中" }, { value: "快", label: "快" }]}
                  onChange={(v) => set("speed", v)}
                />
                <SelectRow
                  label="字級"
                  value={c.fontSize}
                  options={[{ value: "小", label: "小" }, { value: "中", label: "中" }, { value: "大", label: "大" }, { value: "特大", label: "特大" }]}
                  onChange={(v) => set("fontSize", v)}
                />
              </div>
              <Field label="最多顯示筆數" hint="同一時間在跑馬燈中出現的斗內數量。">
                <Input type="number" min={1} max={20} value={c.maxItems} onChange={(e) => set("maxItems", e.target.value)} />
              </Field>
            </div>
          </Panel>

          <Panel title="內容">
            <div className="flex flex-col gap-[2px]">
              <Toggle label="顯示金額" checked={c.showAmount} onChange={(v) => set("showAmount", v)} />
              <Toggle label="顯示觀眾留言" checked={c.showMessage} onChange={(v) => set("showMessage", v)} />
              <Toggle label="顯示頭像圓點" checked={c.showAvatar} onChange={(v) => set("showAvatar", v)} />
              <div className="mt-[14px] flex flex-col gap-[14px]">
                <Field label="項目分隔符號">
                  <Input value={c.separator} onChange={(e) => set("separator", e.target.value)} className="text-[16px]" />
                </Field>
                <div className="grid grid-cols-3 gap-[12px]">
                  <Field label="強調色">
                    <Input type="color" value={c.accent} onChange={(e) => set("accent", e.target.value)} className="h-[42px] cursor-pointer p-[4px]" />
                  </Field>
                  <Field label="文字色">
                    <Input type="color" value={c.textColor} onChange={(e) => set("textColor", e.target.value)} className="h-[42px] cursor-pointer p-[4px]" />
                  </Field>
                  <Field label="背景色">
                    <Input value={c.background} onChange={(e) => set("background", e.target.value)} className="font-mono text-[12px]" />
                  </Field>
                </div>
              </div>
            </div>
          </Panel>

          {/* Real token URL from the overlay API, plus a reissue button.
              This used to copy the literal string "/overlay/donation-ticker/[token]",
              which pasted a URL that cannot resolve. */}
          <OverlayOutput title="OBS 輸出" />

          <Btn onClick={save} disabled={saving}>
            {saving ? "儲存中…" : saved ? "已儲存" : "儲存設定"}
          </Btn>
        </div>

        <Panel title="預覽" description="跑馬燈會無限循環捲動，實際速度依畫面在 OBS 中的實際尺寸而定。">
          <div className="relative aspect-video w-full overflow-hidden rounded-[var(--ic-radius-md)] border border-[var(--ic-hairline)] bg-[#101a2b]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_20%,rgba(29,78,216,.35),transparent_55%)]" />
            <div
              className="absolute inset-x-0 flex overflow-hidden"
              style={{
                top: c.position === "頂部" ? "18px" : undefined,
                bottom: c.position === "底部" ? "18px" : undefined,
                background: c.background,
                padding: "8px 0",
                opacity: c.enabled ? 1 : 0.25,
                borderTop: c.position === "底部" ? `2px solid ${c.accent}` : undefined,
                borderBottom: c.position === "頂部" ? `2px solid ${c.accent}` : undefined,
              }}
            >
              <div
                className="flex flex-shrink-0 items-center gap-[22px] whitespace-nowrap"
                style={{
                  fontSize: sizeMap[c.fontSize] ?? 16,
                  animation: `none`,
                }}
              >
                {[0, 1].map((dup) => (
                  <span key={dup} className="flex items-center gap-[22px]">
                    {sample.map((s, i) => (
                      <span key={i} className="flex items-center gap-[7px]" style={{ color: c.textColor }}>
                        {c.showAvatar && (
                          <span
                            className="inline-block h-[10px] w-[10px] flex-shrink-0 rounded-full"
                            style={{ background: c.accent }}
                          />
                        )}
                        <strong>{s.name}</strong>
                        {c.showAmount && (
                          <span style={{ color: c.accent, fontWeight: 700 }}>{s.amount} 元</span>
                        )}
                        {c.showMessage && s.msg && <span style={{ opacity: 0.75 }}>{s.msg}</span>}
                        <span style={{ opacity: 0.45 }}>{c.separator}</span>
                      </span>
                    ))}
                  </span>
                ))}
              </div>
            </div>
            {!c.enabled && (
              <div className="absolute inset-0 flex items-center justify-center text-[14px] font-[600] text-white/70">
                跑馬燈已停用
              </div>
            )}
          </div>
          <div className="mt-[14px] flex items-center gap-2 text-[13px] text-[var(--ic-ink-muted)]">
            <MoveHorizontal size={15} /> 目前速度「{c.speed}」，方向「{c.direction}」
          </div>
        </Panel>
      </div>
    </>
  );
}