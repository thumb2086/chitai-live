"use client";

import {
  PageHeader, Panel, Btn, Field, Input, SelectRow, Toggle, Badge, useFeature,
} from "@/components/ui";
import { OverlayOutput, OverlayTokenProvider } from "@/components/overlay-settings";
import { Video } from "lucide-react";

type Cfg = {
  enabled: boolean;
  requireApproval: boolean;
  amountPerUnit: string;
  unitsPerMinute: string;
  maxClipSeconds: string;
  maxQueue: string;
  autoPlayNext: boolean;
  showDonorMessage: boolean;
  showQueueList: boolean;
  playerWidth: string;
  accent: string;
  bgColor: string;
  allowPlatforms: string;
};

const DEFAULTS: Cfg = {
  enabled: true,
  requireApproval: true,
  amountPerUnit: "30",
  unitsPerMinute: "10",
  maxClipSeconds: "60",
  maxQueue: "10",
  autoPlayNext: true,
  showDonorMessage: true,
  showQueueList: false,
  playerWidth: "720",
  accent: "#059669",
  bgColor: "rgba(13,17,26,0.9)",
  allowPlatforms: "youtube",
};

export default function DonationVideoPage() {
  return (
    <OverlayTokenProvider overlayKey="donation-video">
      <DonationVideoInner />
    </OverlayTokenProvider>
  );
}

function DonationVideoInner() {
  const { value: c, set, save, saving, saved } = useFeature<Cfg>("donation-video", DEFAULTS);

  const perUnit = Number(c.amountPerUnit) || 1;
  const perMinute = Number(c.unitsPerMinute) || 1;
  const maxClip = Number(c.maxClipSeconds) || 60;

  const sampleAmounts = [30, 60, 150, 300];
  const secsFor = (amt: number) => Math.round((amt / perUnit) * perMinute);

  return (
    <>
      <PageHeader
        title="斗內影片"
        description="觀眾付費後可以在直播中播放指定的影片片段。你決定每單位金額換到多少秒數，以及單次最長能播多久。"
        actions={<Badge tone={c.enabled ? "ok" : "neutral"}>{c.enabled ? "已啟用" : "已停用"}</Badge>}
      />

      <div className="grid gap-[18px] lg:grid-cols-[minmax(0,460px)_minmax(0,1fr)]">
        <div className="flex flex-col gap-[18px]">
          <Panel title="規則">
            <div className="flex flex-col gap-[16px]">
              <Toggle
                label="啟用斗內影片"
                hint="關閉後觀眾無法在斗內頁送出影片需求。"
                checked={c.enabled}
                onChange={(v) => set("enabled", v)}
              />
              <Toggle
                label="需要人工審核"
                hint="關閉後觀眾付款即可直接排入播放佇列。"
                checked={c.requireApproval}
                onChange={(v) => set("requireApproval", v)}
              />
              <div className="h-px bg-[var(--ic-hairline)]" />
              <div className="grid grid-cols-2 gap-[14px]">
                <Field label="每單位金額" hint="每個計價單位需要的斗內金額。">
                  <Input type="number" min={1} value={c.amountPerUnit} onChange={(e) => set("amountPerUnit", e.target.value)} />
                </Field>
                <Field label="單位可換秒數" hint="每 1 單位可播放的秒數。">
                  <Input type="number" min={1} value={c.unitsPerMinute} onChange={(e) => set("unitsPerMinute", e.target.value)} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-[14px]">
                <Field label="單次最長秒數" hint="觀眾不能指定超過這個長度。">
                  <Input type="number" min={5} max={600} value={c.maxClipSeconds} onChange={(e) => set("maxClipSeconds", e.target.value)} />
                </Field>
                <Field label="佇列上限" hint="同時排隊的最大筆數。">
                  <Input type="number" min={1} max={50} value={c.maxQueue} onChange={(e) => set("maxQueue", e.target.value)} />
                </Field>
              </div>
              <SelectRow
                label="允許的來源平台"
                value={c.allowPlatforms}
                options={[
                  { value: "youtube", label: "YouTube" },
                  { value: "twitch", label: "Twitch" },
                  { value: "both", label: "YouTube + Twitch" },
                ]}
                onChange={(v) => set("allowPlatforms", v)}
              />
            </div>
          </Panel>

          <Panel title="播放行為">
            <div className="flex flex-col gap-[2px]">
              <Toggle label="自動播放下一段" checked={c.autoPlayNext} onChange={(v) => set("autoPlayNext", v)} />
              <Toggle label="顯示觀眾留言" checked={c.showDonorMessage} onChange={(v) => set("showDonorMessage", v)} />
              <Toggle label="顯示待播清單" hint="在播放器側邊列出接下來要播的片段。" checked={c.showQueueList} onChange={(v) => set("showQueueList", v)} />
              <div className="mt-[14px] grid grid-cols-2 gap-[14px]">
                <Field label="播放器寬度 (px)">
                  <Input type="number" min={240} max={1920} value={c.playerWidth} onChange={(e) => set("playerWidth", e.target.value)} />
                </Field>
                <Field label="強調色">
                  <Input type="color" value={c.accent} onChange={(e) => set("accent", e.target.value)} className="h-[42px] cursor-pointer p-[4px]" />
                </Field>
              </div>
              <Field label="背景顏色">
                <Input value={c.bgColor} onChange={(e) => set("bgColor", e.target.value)} className="font-mono text-[13px]" />
              </Field>
            </div>
          </Panel>

          {/* Real token URL from the overlay API, plus a reissue button.
              This used to copy the literal string "/overlay/donation-video/[token]",
              which pasted a URL that cannot resolve. */}
          <OverlayOutput title="OBS 輸出" />

          <Btn onClick={save} disabled={saving}>
            {saving ? "儲存中…" : saved ? "已儲存" : "儲存設定"}
          </Btn>
        </div>

        <div className="flex flex-col gap-[18px]">
          <Panel title="計價試算" description="觀眾輸入金額時，可以買到多少秒的播放時間。">
            <div className="grid grid-cols-2 gap-[10px] sm:grid-cols-4">
              {sampleAmounts.map((amt) => (
                <div key={amt} className="rounded-[var(--ic-radius-md)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-2)] p-[14px]">
                  <div className="text-[13px] font-[600] text-[var(--ic-ink-muted)]">{amt} 元</div>
                  <div className="mt-[4px] text-[24px] font-[800] leading-none tabular-nums" style={{ color: c.accent }}>
                    {secsFor(amt)}s
                  </div>
                  <div className="mt-[4px] text-[12px] text-[var(--ic-ink-tertiary)]">
                    約 {(secsFor(amt) / 60).toFixed(1)} 分鐘
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-[14px] text-[13px] leading-[1.6] text-[var(--ic-ink-muted)]">
              公式：秒數 = (斗內金額 ÷ 每單位金額 {perUnit}) × 單位秒數 {perMinute}，上限 {maxClip} 秒。
            </p>
          </Panel>

          <Panel title="播放器預覽">
            <div
              className="w-full overflow-hidden rounded-[var(--ic-radius-md)] border border-[var(--ic-hairline)]"
              style={{ background: c.bgColor }}
            >
              <div className="flex items-center gap-[10px] border-b border-white/10 px-[16px] py-[10px]">
                <Video size={16} style={{ color: c.accent }} />
                <span className="text-[15px] font-[700] text-white">阿花</span>
                <span className="rounded-full px-[8px] py-[2px] text-[12px] font-[700] text-white" style={{ background: c.accent }}>
                  已排播
                </span>
              </div>
              <div className="flex items-center justify-center bg-black/40" style={{ aspectRatio: "16 / 9", maxWidth: Number(c.playerWidth) || 720 }}>
                <div className="text-center text-[13px] text-white/50">
                  <div className="text-[28px]">▶</div>
                  影片播放器
                </div>
              </div>
              {c.showDonorMessage && (
                <div className="border-t border-white/10 px-[16px] py-[10px] text-[13px] text-white/75">
                  「支持你的頻道，繼續加油！」
                </div>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}