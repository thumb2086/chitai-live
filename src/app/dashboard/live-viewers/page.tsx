"use client";

import { useCallback, useEffect, useState } from "react";
import { Eye } from "lucide-react";
import { useFeature, Loading, Badge, SelectRow } from "@/components/ui";
import {
  OverlaySettingsPage, OverlayPreview, OverlayOutput, OverlayEditor,
  SettingsTabs, SettingsTabPanel, SettingsCard, OverlayTokenProvider,
} from "@/components/overlay-settings";

/**
 * Live viewer counter settings.
 *
 * The count comes from /api/v1/live-viewers, which reads Twitch Helix. This page
 * previously rendered a hardcoded 1284 with a "simulate a change" button, and
 * showed the literal string `/overlay/live-viewers/[token]` as the OBS URL.
 */
type Cfg = {
  enabled: boolean;
  title: string;
  position: string;
  size: string;
  showLabel: boolean;
  animate: boolean;
  source: string;
  refreshSeconds: string;
  accent: string;
  bgColor: string;
  textColor: string;
  labelText: string;
  thousands: boolean;
  knownLabel: string;
};

const DEFAULTS: Cfg = {
  enabled: true,
  title: "同時觀看人數",
  position: "右上",
  size: "中",
  showLabel: true,
  animate: true,
  source: "both",
  refreshSeconds: "60",
  accent: "#079455",
  bgColor: "rgba(13,17,26,0.82)",
  textColor: "#ffffff",
  labelText: "人氣",
  thousands: true,
  knownLabel: "--",
};

/** GET /api/v1/live-viewers */
type LivePayload = {
  viewers: number | null;
  known: boolean;
  connections: {
    platform: string;
    connected: boolean;
    channelName: string | null;
    liveViewers: number | null;
    tokenExpired: boolean;
  }[];
};

const TABS = [
  { key: "basic", label: "基本" },
  { key: "style", label: "樣式" },
  { key: "position", label: "位置" },
  { key: "source", label: "數據來源" },
];

const SIZES = ["小", "中", "大", "特大"];
const FONT_PX: Record<string, number> = { 小: 34, 中: 52, 大: 76, 特大: 104 };
const POSITIONS = ["左上", "右上", "左下", "右下", "置中"];

export default function LiveViewersPage() {
  return (
    <OverlayTokenProvider overlayKey="live-viewers">
      <LiveViewersInner />
    </OverlayTokenProvider>
  );
}

function LiveViewersInner() {
  const { value: c, set, save, saving, saved } = useFeature<Cfg>("live-viewers", DEFAULTS);
  const [live, setLive] = useState<LivePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState("basic");

  const refreshSeconds = Math.max(5, Number(c.refreshSeconds) || 60);

  const load = useCallback(async () => {
    try {
      const res = await fetch("https://api.zixilive.dpdns.org/api/v1/live-viewers");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      setLive(j?.data ?? j);
    } catch (e: any) {
      setError(`讀取觀看人數失敗：${e?.message || e}`);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, refreshSeconds * 1000);
    return () => clearInterval(t);
  }, [load, refreshSeconds]);

  if (!c) return <Loading />;

  const known = live?.known === true;
  const count = known ? (live?.viewers ?? 0) : null;
  const display = known
    ? c.thousands
      ? Number(count).toLocaleString()
      : String(count)
    : c.knownLabel || "--";

  const connected = (live?.connections ?? []).filter((x) => x.connected);
  const expired = connected.some((x) => x.tokenExpired);
  const px = FONT_PX[c.size] ?? 52;

  return (
    <OverlaySettingsPage
      icon={<Eye size={26} />}
      title="同時觀看人數"
      description="在直播畫面顯示此刻同時觀看的人數，數據來自已串接的平台。"
      summary={[
        {
          label: "模組狀態",
          value: <span className={c.enabled ? "is-enabled" : ""}>{c.enabled ? "已啟用" : "已停用"}</span>,
        },
        { label: "目前人數", value: display },
        {
          label: "數據來源",
          value: expired ? "憑證過期" : connected.length ? `${connected.length} 個平台` : "未串接",
        },
      ]}
    >
      <OverlayPreview title="整體顯示效果預覽">
        <div
          style={{
            position: "relative",
            aspectRatio: "16/9",
            borderRadius: "var(--ic-radius-md)",
            overflow: "hidden",
            background: "#101a2b",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "radial-gradient(circle at 70% 20%, rgba(29,78,216,.35), transparent 55%)",
            }}
          />
          <div
            style={{
              position: "absolute",
              display: "flex",
              flexDirection: "column",
              gap: 2,
              borderRadius: 14,
              padding: "10px 18px",
              background: c.bgColor,
              color: c.textColor,
              top: c.position === "左上" || c.position === "置中" ? 24 : undefined,
              bottom: c.position === "左下" || c.position === "右下" ? 24 : undefined,
              left:
                c.position === "右上" || c.position === "左上" || c.position === "左下"
                  ? 24
                  : c.position === "置中"
                    ? "50%"
                    : undefined,
              right: c.position === "右上" || c.position === "右下" ? 24 : undefined,
              transform: c.position === "置中" ? "translateX(-50%)" : undefined,
              opacity: c.enabled ? 1 : 0.25,
            }}
          >
            {c.title && (
              <span style={{ fontSize: 13, fontWeight: 700, color: c.accent }}>{c.title}</span>
            )}
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              {c.showLabel && c.labelText && <span style={{ fontSize: 14, opacity: 0.8 }}>{c.labelText}</span>}
              <span
                style={{
                  fontSize: px,
                  fontWeight: 800,
                  lineHeight: 1.05,
                  color: c.accent,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {display}
              </span>
            </div>
          </div>
          {!c.enabled && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "grid",
                placeItems: "center",
                fontSize: 14,
                fontWeight: 600,
                color: "rgba(255,255,255,.7)",
              }}
            >
              疊加層已停用
            </div>
          )}
        </div>

        <p className="settings-note" style={{ marginTop: 12 }}>
          {known
            ? `平台回報的同時在線人數，每 ${refreshSeconds} 秒更新一次。`
            : "尚未取得數據：需要串接平台。確認「未知」而不是顯示 0，因為 0 代表「確認離線」。"}
        </p>
        {error && <p className="settings-note">{error}</p>}
      </OverlayPreview>

      <OverlayOutput title="OBS 輸出" />

      <OverlayEditor title="顯示設定" hint="儲存後即時生效">
        <form className="stack" onSubmit={(e) => e.preventDefault()}>
          <SettingsTabs tabs={TABS} active={tab} onChange={setTab} label="同時觀看人數設定分類" />

          <SettingsTabPanel tabKey="basic" active={tab}>
            <SettingsCard title="基本">
              <div className="source-status-grid">
                <div className="source-status-head">
                  <div className="source-status-copy">
                    <strong>啟用疊加層</strong>
                    <p className="settings-note">關閉後 OBS 疊加層會顯示為空白。</p>
                  </div>
                  <Badge tone={c.enabled ? "ok" : "neutral"}>{c.enabled ? "已啟用" : "已停用"}</Badge>
                </div>
              </div>

              <div className="form-grid">
                <label className="field">
                  <span>顯示名稱</span>
                  <input value={c.title} onChange={(e) => set("title", e.target.value)} placeholder="同時觀看人數" />
                </label>
                <label className="field">
                  <span>標籤文字</span>
                  <input value={c.labelText} onChange={(e) => set("labelText", e.target.value)} />
                </label>
              </div>

              <label className="field">
                <span>無法取得數據時顯示</span>
                <input value={c.knownLabel} onChange={(e) => set("knownLabel", e.target.value)} maxLength={8} />
                <span className="settings-note">
                  顯示 0 會被看成「沒人看」，但實際情況可能只是沒串接平台或憑證失效。
                </span>
              </label>
            </SettingsCard>
          </SettingsTabPanel>

          <SettingsTabPanel tabKey="style" active={tab}>
            <SettingsCard title="數字與顏色">
              <div className="form-grid">
                <label className="field">
                  <span>強調色</span>
                  <input type="color" value={c.accent} onChange={(e) => set("accent", e.target.value)} />
                </label>
                <label className="field">
                  <span>文字顏色</span>
                  <input type="color" value={c.textColor} onChange={(e) => set("textColor", e.target.value)} />
                </label>
              </div>
              <label className="field">
                <span>背景顏色</span>
                <input value={c.bgColor} onChange={(e) => set("bgColor", e.target.value)} />
              </label>
              <div className="form-grid">
                <SelectRow
                  label="尺寸"
                  value={c.size}
                  options={SIZES.map((s) => ({ value: s, label: s }))}
                  onChange={(v) => set("size", v)}
                />
              </div>
              <p className="settings-note">數字變動動畫與千分位顯示由疊加層依樣式自動處理。</p>
            </SettingsCard>
          </SettingsTabPanel>

          <SettingsTabPanel tabKey="position" active={tab}>
            <SettingsCard title="畫面位置">
              {/* The `.chat-settings-choice` cards are scoped to
                  `.chat-settings-page`, so they would render unstyled here.
                  `.field` / `.form-grid` are defined for this page family. */}
              <div className="form-grid">
                {POSITIONS.map((p) => (
                  <label key={p} className="field">
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input
                        type="radio"
                        name="lv-position"
                        checked={c.position === p}
                        onChange={() => set("position", p)}
                        style={{ width: 16, height: 16, margin: 0 }}
                      />
                      {p}
                    </span>
                  </label>
                ))}
              </div>
            </SettingsCard>
          </SettingsTabPanel>

          <SettingsTabPanel tabKey="source" active={tab}>
            <SettingsCard title="數據來源">
              <div className="form-grid">
                <SelectRow
                  label="更新頻率"
                  value={c.refreshSeconds}
                  options={[
                    { value: "15", label: "每 15 秒" },
                    { value: "30", label: "每 30 秒" },
                    { value: "60", label: "每分鐘" },
                    { value: "300", label: "每 5 分鐘" },
                  ]}
                  onChange={(v) => set("refreshSeconds", v)}
                />
              </div>

              <div className="source-status-grid">
                {(live?.connections ?? []).map((conn) => (
                  <div key={conn.platform} className="source-status-card">
                    <div className="source-status-head">
                      <div className="source-status-copy">
                        <strong>{conn.platform}</strong>
                        <p className="settings-note">
                          {conn.channelName ?? "尚未取得頻道名稱"}
                          {conn.tokenExpired ? " · 憑證已過期，請重新授權" : ""}
                        </p>
                      </div>
                      <Badge tone={conn.connected ? (conn.tokenExpired ? "danger" : "ok") : "neutral"}>
                        {conn.connected ? (conn.tokenExpired ? "需重新授權" : "已串接") : "未串接"}
                      </Badge>
                    </div>
                  </div>
                ))}
                {connected.length === 0 && (
                  <p className="settings-note">
                    尚未串接任何平台。YouTube 沒有公開的同時觀看人數 API，即使串接也只會顯示 Twitch 的數字。
                  </p>
                )}
              </div>

              <div className="action-row">
                <button type="button" className="ghost-button" onClick={load}>
                  立即重新整理
                </button>
                <a className="ghost-link" href="/dashboard/connections">
                  前往平台授權
                </a>
              </div>
            </SettingsCard>
          </SettingsTabPanel>

          <footer className="overlay-settings-footer">
            <span className="settings-note">
              {saving ? "儲存中…" : saved ? "已儲存" : "設定會自動儲存"}
            </span>
            <button type="button" className="primary-button" onClick={save} disabled={saving}>
              儲存設定
            </button>
          </footer>
        </form>
      </OverlayEditor>
    </OverlaySettingsPage>
  );
}

