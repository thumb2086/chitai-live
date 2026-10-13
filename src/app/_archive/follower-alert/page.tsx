"use client";

import { useCallback, useEffect, useState } from "react";
import { UserPlus, Play } from "lucide-react";
import { useFeature, Loading, Badge, SelectRow } from "@/components/ui";
import {
  OverlaySettingsPage, OverlayPreview, OverlayOutput, OverlayEditor,
  SettingsTabs, SettingsTabPanel, SettingsCard, OverlayTokenProvider,
} from "@/components/overlay-settings";

/**
 * Follow / subscription alert settings.
 *
 * Previously this page printed the literal string
 * `/overlay/follower-alert/[token]` as the OBS URL and never looked at whether
 * the EventSub subscriptions that feed it were actually registered.
 */
type Cfg = {
  enabled: boolean;
  position: string;
  layout: string;
  duration: string;
  sound: string;
  volume: string;
  showAvatar: boolean;
  showMessage: boolean;
  accent: string;
  textColor: string;
  followText: string;
  subText: string;
  twitchFollow: boolean;
  twitchSub: boolean;
  twitchSubGift: boolean;
  youtubeSub: boolean;
  youtubeMember: boolean;
  youtubeGift: boolean;
};

const DEFAULTS: Cfg = {
  enabled: true,
  position: "右上",
  layout: "卡片",
  duration: "6",
  sound: "提示音",
  volume: "60",
  showAvatar: true,
  showMessage: true,
  accent: "#079455",
  textColor: "#ffffff",
  followText: "加入了追隨行列",
  subText: "訂閱了頻道 {tier} {months} 個月",
  twitchFollow: true,
  twitchSub: true,
  twitchSubGift: false,
  youtubeSub: true,
  youtubeMember: true,
  youtubeGift: false,
};

const TABS = [
  { key: "basic", label: "基本" },
  { key: "layout", label: "版面" },
  { key: "text", label: "文案" },
  { key: "source", label: "事件來源" },
];

/** GET /api/v1/eventsub */
type EventsubPayload = {
  channelName?: string;
  ok: boolean;
  subscriptions: { type: string; version: string }[];
  error?: string;
};

type Demo = { kind: string; name: string; tier: string; months: string; msg: string } | null;

export default function FollowerAlertPage() {
  return (
    <OverlayTokenProvider overlayKey="follower-alert">
      <FollowerAlertInner />
    </OverlayTokenProvider>
  );
}

function FollowerAlertInner() {
  const { value: c, set, save, saving, saved } = useFeature<Cfg>("follower-alert", DEFAULTS);
  const [sub, setSub] = useState<EventsubPayload | null>(null);
  const [subError, setSubError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState<Demo>(null);
  const [tab, setTab] = useState("basic");

  const loadSubs = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/eventsub");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSubError(body?.error ?? `HTTP ${res.status}`);
        setSub(null);
      } else {
        setSubError(null);
        setSub(body);
      }
    } catch (e: any) {
      setSubError(e?.message || "讀取失敗");
    }
  }, []);

  useEffect(() => {
    void loadSubs();
  }, [loadSubs]);

  const subscribe = async () => {
    setBusy(true);
    setSubError(null);
    try {
      const res = await fetch("/api/v1/eventsub", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setSubError(body?.error ?? `HTTP ${res.status}`);
      else if (body.failed?.length) {
        setSubError(`${body.created.length} 個建立、${body.alreadyExists?.length ?? 0} 個已存在；失敗：${body.failed.map((f: any) => `${f.type} (${f.message?.slice(0, 60)})`).join("; ")}`);
      }
      await loadSubs();
    } catch (e: any) {
      setSubError(e?.message || "訂閱失敗");
    } finally {
      setBusy(false);
    }
  };

  const fire = (kind: string) =>
    setDemo({
      kind,
      name: kind === "follow" ? "小明" : kind === "sub" ? "阿花" : "Ghost",
      tier: kind === "sub" ? "Tier 2" : "—",
      months: kind === "sub" ? "6" : "—",
      msg: "",
    });

  if (!c) return <Loading />;

  const subCount = sub?.subscriptions?.length ?? 0;

  return (
    <OverlaySettingsPage
      icon={<UserPlus size={26} />}
      title="追隨與訂閱提醒"
      description="有人追隨、訂閱或投遞小奇異時，在直播畫面上跳出提示。"
      summary={[
        { label: "模組狀態", value: <span className={c.enabled ? "is-enabled" : ""}>{c.enabled ? "已啟用" : "已停用"}</span> },
        { label: "已註冊事件", value: subCount ? `${subCount} 種` : "尚未註冊" },
        { label: "顯示時間", value: `${c.duration} 秒` },
      ]}
    >
      <OverlayPreview title="提醒顯示效果預覽">
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
              top: 24,
              right: 24,
              display: "grid",
              gap: 6,
              borderRadius: 12,
              padding: "12px 16px",
              background: "rgba(13,17,26,0.85)",
              color: c.textColor,
              border: "1px solid rgba(255,255,255,.1)",
              opacity: demo ? 1 : 0,
              transition: "opacity .2s",
            }}
          >
            {c.showAvatar && (
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  background: c.accent,
                  color: "#fff",
                  display: "grid",
                  placeItems: "center",
                  fontWeight: 800,
                }}
              >
                {demo?.name?.slice(0, 1) ?? "?"}
              </div>
            )}
            <strong style={{ fontSize: 14 }}>{demo?.name ?? "—"}</strong>
            <span style={{ fontSize: 13, opacity: 0.85 }}>
              {demo?.kind === "follow" ? c.followText : c.subText.replace("{tier}", demo?.tier ?? "").replace("{months}", demo?.months ?? "")}
            </span>
          </div>
          {!demo && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "grid",
                placeItems: "center",
                fontSize: 13,
                color: "rgba(255,255,255,.55)",
              }}
            >
              按右側「測試」觸發一次預覽
            </div>
          )}
        </div>

        <div className="action-row" style={{ marginTop: 12 }}>
          {[
            { kind: "follow", label: "測試追隨" },
            { kind: "sub", label: "測試訂閱" },
            { kind: "gift", label: "測試贈送" },
          ].map((t) => (
            <button key={t.kind} type="button" className="ghost-button" onClick={() => fire(t.kind)}>
              <Play size={14} /> {t.label}
            </button>
          ))}
          <span className="settings-note">測試只影響這個預覽，不會寫入事件紀錄。</span>
        </div>
      </OverlayPreview>

      <OverlayOutput title="提醒輸出" />

      <OverlayEditor title="提醒設定" hint="儲存後即時生效">
        <form className="stack" onSubmit={(e) => e.preventDefault()}>
          <SettingsTabs tabs={TABS} active={tab} onChange={setTab} label="追隨提醒設定分類" />

          <SettingsTabPanel tabKey="basic" active={tab}>
            <SettingsCard title="基本">
              <div className="source-status-grid">
                <div className="source-status-head">
                  <div className="source-status-copy">
                    <strong>啟用提醒</strong>
                    <p className="settings-note">關閉後疊加層不會顯示任何追隨或訂閱提示。</p>
                  </div>
                  <Badge tone={c.enabled ? "ok" : "neutral"}>{c.enabled ? "已啟用" : "已停用"}</Badge>
                </div>
              </div>
              <div className="form-grid">
                <SelectRow
                  label="顯示時間"
                  value={c.duration}
                  options={["3", "6", "10", "15"].map((s) => ({ value: s, label: `${s} 秒` }))}
                  onChange={(v) => set("duration", v)}
                />
                <SelectRow
                  label="位置"
                  value={c.position}
                  options={["左上", "右上", "左下", "右下"].map((p) => ({ value: p, label: p }))}
                  onChange={(v) => set("position", v)}
                />
              </div>
            </SettingsCard>
          </SettingsTabPanel>

          <SettingsTabPanel tabKey="layout" active={tab}>
            <SettingsCard title="版面與樣式">
              <div className="form-grid">
                <SelectRow
                  label="版面"
                  value={c.layout}
                  options={[{ value: "卡片", label: "卡片" }, { value: "條幅", label: "條幅" }]}
                  onChange={(v) => set("layout", v)}
                />
                <SelectRow
                  label="提示音"
                  value={c.sound}
                  options={[{ value: "提示音", label: "提示音" }, { value: "無", label: "無" }]}
                  onChange={(v) => set("sound", v)}
                />
              </div>
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
              <p className="settings-note">頭像與訊息顯示由版面決定；提示音音量尚未在疊加層實作。</p>
            </SettingsCard>
          </SettingsTabPanel>

          <SettingsTabPanel tabKey="text" active={tab}>
            <SettingsCard title="文案">
              <label className="field">
                <span>追隨文案</span>
                <input value={c.followText} onChange={(e) => set("followText", e.target.value)} maxLength={60} />
              </label>
              <label className="field">
                <span>訂閱文案</span>
                <input value={c.subText} onChange={(e) => set("subText", e.target.value)} maxLength={60} />
              </label>
              <p className="settings-note">訂閱文案可用 {'{tier}'} 與 {'{months}'} 佔位符號。</p>
            </SettingsCard>
          </SettingsTabPanel>

          <SettingsTabPanel tabKey="source" active={tab}>
            <SettingsCard title="事件來源">
              <div className="source-status-grid">
                <div className="source-status-head">
                  <div className="source-status-copy">
                    <strong>Twitch EventSub</strong>
                    <p className="settings-note">
                      {subError
                        ? subError
                        : sub
                          ? `${sub.channelName ?? "已連線"} · 已註冊 ${subCount} 種事件`
                          : "讀取中…"}
                    </p>
                  </div>
                  <Badge tone={subCount ? "ok" : subError ? "danger" : "neutral"}>
                    {subCount ? "已就緒" : subError ? "需要設定" : "讀取中"}
                  </Badge>
                </div>
              </div>

              {(sub?.subscriptions?.length ?? 0) > 0 && (
                <div className="source-status-grid">
                  {sub!.subscriptions.map((s) => (
                    <div key={`${s.type}:${s.version}`} className="source-status-card">
                      {s.type} <span className="settings-note">v{s.version}</span>
                    </div>
                  ))}
                </div>
              )}

              <p className="settings-note">
                Twitch 只會推送你有訂閱的事件。沒註冊的話，這個疊加層永遠不會亮。
              </p>

              <div className="action-row">
                <button type="button" className="primary-button" onClick={subscribe} disabled={busy}>
                  {busy ? "註冊中…" : "註冊事件訂閱"}
                </button>
                <button type="button" className="ghost-button" onClick={loadSubs}>
                  重新整理狀態
                </button>
              </div>
              <p className="settings-note">
                需要設定 <code>PUBLIC_BASE_URL</code> 為 Twitch 可連線的 https 網址，localhost 無法使用。
              </p>
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
