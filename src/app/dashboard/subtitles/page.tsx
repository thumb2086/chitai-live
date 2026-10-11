"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Mic, MicOff, Send, Gauge, Cpu, Radio } from "lucide-react";
import { api } from "@/lib/api";
import { useFeature, Badge, Loading, ErrorBox, Toggle, SelectRow } from "@/components/ui";
import {
  OverlaySettingsPage, OverlayPreview, OverlayOutput, OverlayEditor,
  SettingsTabs, SettingsTabPanel, SettingsCard, OverlayTokenProvider,
} from "@/components/overlay-settings";
import { createLiveCaptions, type Engine, type LiveCaptions } from "@/lib/captions-live";
import { probeLocalDaemon, LOCAL_WS_DEFAULT, LOCAL_FAILURE_HINT, type LocalHealth } from "@/lib/captions-local";

type EngineCfg = {
  engine: Engine;
  model: "whisper-large-v3-turbo" | "whisper-large-v3";
  language: string;
  /** Latency profile: window length and how often a new window is sent. */
  windowMs: number;
  stepMs: number;
  /** Daemon endpoint for the local engine. */
  wsUrl?: string;
};

const DEFAULTS: EngineCfg = {
  engine: "groq",
  model: "whisper-large-v3-turbo",
  language: "zh-TW",
  windowMs: 2400,
  stepMs: 1200,
  wsUrl: LOCAL_WS_DEFAULT,
};

/** Named latency profiles so the trade-off is explicit rather than numeric. */
const PROFILES: { key: string; label: string; windowMs: number; stepMs: number; note: string }[] = [
  { key: "low", label: "最低延遲", windowMs: 2000, stepMs: 900, note: "字幕最快跟得上，邊界處偶爾會重聽成別的字。" },
  { key: "balanced", label: "平衡", windowMs: 2400, stepMs: 1200, note: "預設。延遲約 3 秒，穩定度與速度兼顧。" },
  { key: "accurate", label: "穩定優先", windowMs: 3200, stepMs: 2000, note: "邊界較少、錯字較低，延遲約 4 秒。" },
];

const LANGS = [
  { value: "zh-TW", label: "中文（台灣）" },
  { value: "zh-CN", label: "中文（中國）" },
  { value: "en-US", label: "English" },
  { value: "ja-JP", label: "日本語" },
  { value: "ko-KR", label: "한국어" },
];

const MODELS = [
  { value: "whisper-large-v3-turbo", label: "whisper-large-v3-turbo（快，日常直播建議）" },
  { value: "whisper-large-v3", label: "whisper-large-v3（慢，準確度較高）" },
];

const TABS = [
  { key: "basic", label: "基本" },
  { key: "style", label: "樣式" },
  { key: "layout", label: "版面" },
  { key: "mic", label: "收音" },
];

const STATE_LABEL: Record<string, string> = {
  idle: "已閒置",
  listening: "收音中",
  transcribing: "轉寫中",
  error: "錯誤",
};

/** Shape of GET /api/v1/captions/transcribe. */
type ProviderInfo = {
  configured: boolean;
  provider: string | null;
  order: string[];
  direct: boolean;
  router: boolean;
  routerHost: string | null;
};

const PROVIDER_LABEL: Record<string, string> = {
  direct: "Groq 直連",
  router: "Groq 路由器",
};

type Metrics = {
  provider: string;
  latencyMs: number;
  windowMs?: number;
  fellBack?: boolean;
  failReason?: string;
  firstTokenMs?: number;
};

export default function CaptionsPage() {
  return (
    <OverlayTokenProvider overlayKey="captions">
      <CaptionsInner />
    </OverlayTokenProvider>
  );
}

function CaptionsInner() {
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const { value: ec, set, saving, saved } = useFeature<EngineCfg>("captions", DEFAULTS);

  const [tab, setTab] = useState("basic");
  const [state, setState] = useState<string>("idle");
  const [detail, setDetail] = useState("");
  const [level, setLevel] = useState(0);
  const [latency, setLatency] = useState<number | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [lastText, setLastText] = useState("");
  const [textInput, setTextInput] = useState("");
  const [router, setRouter] = useState<ProviderInfo | null>(null);
  const [previewKey, setPreviewKey] = useState(0);
  /** Live preview of whatever the engine has produced so far this take. */
  const [preview, setPreview] = useState("");
  const [local, setLocal] = useState<LocalHealth | null>(null);
  const [probing, setProbing] = useState(false);

  const handle = useRef<LiveCaptions | null>(null);

  // The daemon runs on the viewer's machine, so only ask about it when the
  // local engine is actually selected. Probing on mount would fire a request
  // to localhost for everyone, including people who will never use it.
  useEffect(() => {
    if (ec.engine !== "local") return;
    let cancelled = false;
    setProbing(true);
    probeLocalDaemon(ec.wsUrl || LOCAL_WS_DEFAULT)
      .then((h) => {
        if (!cancelled) setLocal(h);
      })
      .finally(() => {
        if (!cancelled) setProbing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ec.engine, ec.wsUrl]);

  useEffect(() => {
    Promise.all([
      api.getSubtitles(),
      fetch("/api/v1/captions/transcribe").then((r) => r.json()).catch(() => null),
    ])
      .then(([s, r]) => {
        setConfig(s);
        setRouter(r);
      })
      .catch((e) => setLoadError(e?.message || "載入失敗"))
      .finally(() => setLoading(false));
    return () => handle.current?.stop();
  }, []);

  const saveConfig = useCallback(
    async (patch: any) => {
      const next = { ...config, ...patch };
      setConfig(next);
      await api.saveSubtitles(next).catch(() => setLoadError("儲存失敗"));
    },
    [config]
  );

  const postSegment = useCallback(async (text: string) => {
    const t = text.trim();
    if (!t) return;
    setLastText(t);
    try {
      await fetch("/api/v1/captions/segments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: t, speaker: "實況主", status: "final" }),
      });
    } catch {}
    setPreviewKey((n) => n + 1);
  }, []);

  const stop = useCallback(() => {
    handle.current?.stop();
    handle.current = null;
    setState("idle");
    setLevel(0);
    setPreview("");
  }, []);

  const start = useCallback(async () => {
    setLoadError(null);
    setState("listening");
    setPreview("");
    const h = createLiveCaptions({
      engine: ec.engine,
      language: ec.language,
      model: ec.model,
      windowMs: ec.windowMs,
      stepMs: ec.stepMs,
      ...(ec.wsUrl ? { wsUrl: ec.wsUrl } : {}),
      onSegment: (s) => {
        void postSegment(s.text);
      },
      onPartial: setPreview,
      onStatus: (s) => {
        setState(s.state);
        if (s.detail) setDetail(s.detail);
      },
      onLevel: (r) => setLevel(r),
      onMetrics: (m) => {
        setMetrics(m);
        // For the local engine latencyMs is wall time since connect, which
        // keeps climbing for the whole take. Showing it as "latency" would
        // be a lie, so use the real first-token time instead.
        setLatency(m.firstTokenMs ?? m.latencyMs);
      },
    });
    handle.current = h;
    await h.start();
  }, [ec.engine, ec.language, ec.model, ec.windowMs, ec.stepMs, ec.wsUrl, postSegment]);

  // Latency and provider come from the server's own measurement of each window
  // (onMetrics), so there is no client-side stopwatch to drift from reality.

  if (loading) return <Loading />;
  if (loadError && !config) return <ErrorBox message={loadError} />;

  const overlayUrl =
    typeof window !== "undefined" && router?.configured !== undefined
      ? null
      : null;

  return (
    <OverlaySettingsPage
      family="captions-settings"
      icon={
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <rect x="2.5" y="5" width="19" height="14" rx="3" />
          <path d="M6.5 14h5M9.5 11v6M13.5 11h4M13.5 14h3" />
        </svg>
      }
      title="即時字幕"
      description="收音後即時轉寫並推送至直播疊加層。雲端轉寫走自有 Groq 路由器，字幕延遲約 1.5–2 秒。"
      summary={[
        { label: "模組狀態", value: <span className={config?.enabled ? "is-enabled" : ""}>{config?.enabled ? "已啟用" : "已停用"}</span> },
        { label: "辨識方式", value: ec.engine === "groq" ? "Groq 雲端轉寫" : "Browser STT" },
        { label: "轉寫延遲", value: latency !== null ? `${latency} ms` : "—" },
      ]}
    >
      <OverlayPreview family="captions-settings" title="整體顯示效果預覽">
        <CaptionsPreview config={config} lastText={lastText} reloadKey={previewKey} />
      </OverlayPreview>

      <OverlayOutput title="字幕輸出" />

      <OverlayEditor family="captions-settings" title="字幕設定" hint="儲存後即時生效">
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void set;
          }}
        >
          <SettingsTabs
            family="captions-settings"
            tabs={TABS}
            active={tab}
            onChange={setTab}
            label="字幕設定分類"
                />

          {/* ------------------------------------------------ 基本 */}
          <SettingsTabPanel family="captions-settings" tabKey="basic" active={tab}>
            <SettingsCard family="captions-settings" title="基本">
              <Toggle
                label="啟用即時字幕"
                hint="在直播畫面中顯示字幕疊加層。"
                checked={!!config?.enabled}
                onChange={(v) => saveConfig({ enabled: v })}
              />
              <div className="form-grid">
                <SelectRow
                  label="字幕語言"
                  value={ec.language}
                  options={LANGS}
                  onChange={(v) => set("language", v)}
                />
                <SelectRow
                  label="顯示語言"
                  value={ec.language}
                  options={LANGS}
                  onChange={(v) => set("language", v)}
                />
              </div>
            </SettingsCard>

            <SettingsCard family="captions-settings" title="字幕顯示模式">
              <div className="form-grid">
                <label>
                  模式
                  <select defaultValue="target">
                    <option value="target">只顯示目標語言</option>
                    <option value="translated">只顯示翻譯後字幕</option>
                    <option value="bilingual">雙語顯示</option>
                    <option value="off">不顯示字幕</option>
                  </select>
                </label>
                <label>
                  說話者模式
                  <select defaultValue="solo">
                    <option value="solo">單人直播</option>
                    <option value="roster">多輪廓（說話者名單）</option>
                  </select>
                </label>
              </div>
              <p className="settings-note">翻譯需要另外接翻譯服務，目前只輸出辨識原文。</p>
            </SettingsCard>
          </SettingsTabPanel>

          {/* ------------------------------------------------ 樣式 */}
          <SettingsTabPanel family="captions-settings" tabKey="style" active={tab}>
            <SettingsCard family="captions-settings" title="字體與顏色">
              <div className="form-grid">
                <label>
                  字型
                  <select defaultValue="noto">
                    <option value="noto">Noto Sans TC</option>
                    <option value="jhenghei">微軟正黑體</option>
                    <option value="system">系統介面字體</option>
                  </select>
                </label>
                <label>
                  字體大小
                  <select value={config?.fontSize || "中 (24px)"} onChange={(e) => saveConfig({ fontSize: e.target.value })}>
                    <option>小 (18px)</option>
                    <option>中 (24px)</option>
                    <option>大 (32px)</option>
                    <option>特大 (40px)</option>
                  </select>
                </label>
              </div>
              <div className="form-grid">
                <label className="field scoreboard-color-field">
                  <span>文字顏色</span>
                  <input
                    type="color"
                    value={config?.textColor || "#ffffff"}
                    onChange={(e) => saveConfig({ textColor: e.target.value })}
                  />
                </label>
                <label className="field scoreboard-color-field">
                  <span>底色透明度</span>
                  <span className="scoreboard-opacity-control">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round((parseFloat((config?.bgColor || "0.7").replace(/[^0-9.]/g, "")) || 0.7) * 100)}
                      onChange={(e) => saveConfig({ bgColor: `rgba(0,0,0,${Number(e.target.value) / 100})` })}
                    />
                    <output>
                      {Math.round((parseFloat((config?.bgColor || "0.7").replace(/[^0-9.]/g, "")) || 0.7) * 100)}%
                    </output>
                  </span>
                </label>
              </div>
            </SettingsCard>
          </SettingsTabPanel>

          {/* ------------------------------------------------ 版面 */}
          <SettingsTabPanel family="captions-settings" tabKey="layout" active={tab}>
            <SettingsCard family="captions-settings" title="畫面位置">
              <div className="form-grid">
                <SelectRow
                  label="字幕位置"
                  value={config?.position || "底部置中"}
                  options={[
                    { value: "底部置中", label: "底部置中" },
                    { value: "頂部置中", label: "頂部置中" },
                    { value: "底部靠左", label: "底部靠左" },
                    { value: "底部靠右", label: "底部靠右" },
                  ]}
                  onChange={(v) => saveConfig({ position: v })}
                />
                <label>
                  歷史行數
                  <select defaultValue="2">
                    <option value="1">1</option>
                    <option value="2">2</option>
                    <option value="3">3</option>
                  </select>
                </label>
              </div>
            </SettingsCard>
          </SettingsTabPanel>

          {/* ------------------------------------------------ 收音 */}
          <SettingsTabPanel family="captions-settings" tabKey="mic" active={tab}>
            <SettingsCard className="captions-mic-panel" title="即時字幕收音">
              <div className="captions-mic-line">
                <span className="captions-mic-line-text">
                  {STATE_LABEL[state] ?? state}
                  {detail ? ` · ${detail}` : ""}
                </span>
                <span className="captions-mic-line-label">
                  {ec.engine === "groq"
                    ? `Groq · ${ec.model.replace("whisper-", "")}`
                    : ec.engine === "local"
                      ? "本機模型 · x-asr 160ms"
                      : "瀏覽器內建 STT"}
                </span>
              </div>

              <div className="form-grid">
                <label>
                  語音辨識服務
                  <select value={ec.engine} onChange={(e) => set("engine", e.target.value as Engine)}>
                    <option value="groq">Groq 雲端轉寫（自有路由器）</option>
                    <option value="local">
                      本機模型（本機轉寫，有標點，音訊不出電腦）
                    </option>
                    <option value="browser">Browser STT（免費，僅 Chrome / Edge）</option>
                  </select>
                </label>
                {ec.engine === "local" && (
                  <label>
                    本機服務位址
                    <input
                      type="text"
                      value={ec.wsUrl ?? LOCAL_WS_DEFAULT}
                      onChange={(e) => set("wsUrl", e.target.value)}
                      spellCheck={false}
                    />
                  </label>
                )}
                {ec.engine === "groq" && (
                  <label>
                    模型
                    <select value={ec.model} onChange={(e) => set("model", e.target.value as EngineCfg["model"])}>
                      {MODELS.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              {ec.engine === "local" && (
                <p className="settings-note">
                  {probing
                    ? "正在確認本機服務…"
                    : /* Chrome 142+ 會先問「允許存取本機網路」，被擋時要把
                         該做什麼講清楚，不能只說「連不上」 */
                      local?.ok
                      ? `本機服務運作中 · ${local.model ?? "x-asr"} · ${
                          local.provider ? `${local.provider.toUpperCase()} 推論 · ` : ""
                        }已啟動 ${Math.round(local.uptime_s ?? 0)} 秒。串流輸出，自動轉繁體並加標點。`
                      : `${LOCAL_FAILURE_HINT[local?.reason ?? "unknown"]}${
                          local?.error ? `（${local.error}）` : ""
                        }`}
                </p>
              )}

              {ec.engine === "groq" && (
                <p className="settings-note">
                  {router?.configured
                    ? `${PROVIDER_LABEL[router.provider ?? ""] ?? "轉寫服務"} · 音訊切成 ${(ec.windowMs / 1000).toFixed(1)} 秒視窗、每 ${(ec.stepMs / 1000).toFixed(1)} 秒送出，重疊部分自動去重。`
                    : "尚未設定 GROQ_API_KEY 或 GROQ_ROUTER_URL / GROQ_ROUTER_KEY，改用 Browser STT 才能收音。"}
                </p>
              )}

              {ec.engine === "groq" && (
                <div className="form-grid">
                  <label>
                    延遲 / 穩定度
                    <select
                      value={
                        PROFILES.find((p) => p.windowMs === ec.windowMs && p.stepMs === ec.stepMs)?.key ?? "balanced"
                      }
                      onChange={(e) => {
                        const p = PROFILES.find((x) => x.key === e.target.value);
                        if (!p) return;
                        set("windowMs", p.windowMs);
                        set("stepMs", p.stepMs);
                      }}
                    >
                      {PROFILES.map((p) => (
                        <option key={p.key} value={p.key}>
                          {p.label}（{(p.stepMs / 1000).toFixed(1)}s 步進 / {(p.windowMs / 1000).toFixed(1)}s 視窗）
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="settings-note">
                    {PROFILES.find((p) => p.windowMs === ec.windowMs && p.stepMs === ec.stepMs)?.note ??
                      "自訂延遲設定。"}
                  </div>
                </div>
              )}
              {ec.engine === "browser" && (
                <p className="settings-note">
                  Browser STT 本身免費，但必須讓這個分頁保持開啟，且只在 Chrome / Edge 有效。
                </p>
              )}

              {/* Live preview: shows what the engine has produced so far this
                  take, including text not yet finalised. Groq only reports
                  whole windows, so this stays empty on that path. */}
              {preview && (
                <div className="settings-note" data-testid="captions-live-preview">
                  即時預覽：{preview}
                </div>
              )}

              <div className="caption-mic-speaker-field">
                <button
                  type="button"
                  className={state === "idle" ? "primary-button" : "danger-button"}
                  onClick={() => (state === "idle" ? start() : stop())}
                  disabled={
                    (ec.engine === "groq" && router?.configured === false) ||
                    // Starting with no daemon would just yield a WebSocket error
                    // after the mic is already live, which reads as a failure.
                    (ec.engine === "local" && local?.ok === false)
                  }
                >
                  {state === "idle" ? <Mic size={15} /> : <MicOff size={15} />}
                  {state === "idle" ? "開始錄音" : "停止錄音"}
                </button>

                <div className="level" title="收音音量">
                  <div
                    className="level-bar"
                    style={{ width: `${Math.min(100, level * 700)}%` }}
                  />
                </div>
              </div>

              <div className="captions-mic-log">
                <p className="settings-note">即時轉寫內容</p>
                <div className="captions-mic-line-text">
                  {lastText || "尚未收到即時轉寫內容。"}
                </div>
              </div>

              <div className="action-row">
                <input
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && textInput.trim()) {
                      postSegment(textInput);
                      setTextInput("");
                    }
                  }}
                  placeholder="或手動輸入文字直接送進疊加層"
                />
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => {
                    if (textInput.trim()) {
                      postSegment(textInput);
                      setTextInput("");
                    }
                  }}
                >
                  <Send size={15} /> 發送
                </button>
              </div>
            </SettingsCard>

            <SettingsCard family="captions-settings" title="狀態">
              <div className="source-status-grid">
                <div className="source-status-head">
                  <h3>收音來源狀態</h3>
                  <Badge tone={state === "error" ? "danger" : state === "idle" ? "neutral" : "ok"}>
                    {state === "error" ? "異常" : state === "idle" ? "待命" : "運作中"}
                  </Badge>
                </div>
                <p className="settings-note">
                  {ec.engine === "groq"
                    ? `最後送出的字幕：${lastText || "尚未送出字幕。"}`
                    : "Browser STT 不經過伺服器，延遲取決於瀏覽器。"}
                </p>
                <div className="action-row">
                  <Badge tone="neutral">
                    <Cpu size={13} />
                    {ec.engine === "groq"
                      ? "伺服器轉寫"
                      : ec.engine === "local"
                        ? "本機轉寫"
                        : "瀏覽器轉寫"}
                  </Badge>
                  <Badge tone="neutral">
                    <Gauge size={13} />{" "}
                    {latency !== null
                      ? `延遲 ${latency} ms（${PROVIDER_LABEL[metrics?.provider ?? ""] ?? metrics?.provider ?? "—"}）`
                      : "延遲 —"}
                  </Badge>
                  <Badge tone={metrics?.fellBack ? "warn" : router?.configured ? "ok" : "neutral"}>
                    <Radio size={13} />{" "}
                    {metrics?.fellBack
                      ? `已切至備援（${PROVIDER_LABEL[metrics.provider] ?? metrics.provider}）`
                      : router?.configured
                        ? `${PROVIDER_LABEL[router.provider ?? ""] ?? "轉寫服務"}就緒`
                        : "轉寫服務未設定"}
                  </Badge>
                </div>
                {metrics?.fellBack && metrics.failReason ? (
                  <p className="settings-note">備援原因：{metrics.failReason}</p>
                ) : null}
              </div>
            </SettingsCard>
          </SettingsTabPanel>

          <footer className="captions-settings-footer">
            <span className="settings-note">
              {saved ? "已儲存" : saving ? "儲存中…" : "辨識設定會即時生效"}
            </span>
          </footer>
        </form>
      </OverlayEditor>
    </OverlaySettingsPage>
  );
}

function CaptionsPreview({
  config,
  lastText,
  reloadKey,
}: {
  config: any;
  lastText: string;
  reloadKey: number;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/obs")
      .then((r) => r.json())
      .then((d) => {
        const s = (d.sources ?? []).find((x: any) => x.key === "captions");
        if (s) setUrl(s.url);
      })
      .catch(() => {});
  }, [reloadKey]);

  const size = Number(String(config?.fontSize ?? "24").replace(/[^\d]/g, "")) || 24;
  const pos = config?.position ?? "底部置中";
  const align =
    pos === "底部靠左" ? "flex-start" : pos === "底部靠右" ? "flex-end" : "center";

  return (
    <div className="preview-frame-shell">
      {url ? (
        <iframe key={reloadKey} title="字幕預覽" src={url} className="preview-frame" />
      ) : (
        <div className="preview-frame" style={{ minHeight: 200, background: "#0a0a0a" }} />
      )}

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: pos === "頂部置中" ? "flex-start" : "flex-end",
          alignItems: align === "center" ? "center" : align,
          padding: 24,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            fontSize: size,
            fontWeight: 800,
            color: config?.textColor || "#fff",
            background: config?.bgColor || "rgba(0,0,0,0.7)",
            padding: "6px 14px",
            borderRadius: 8,
            maxWidth: "80%",
            textAlign: "center",
          }}
        >
          {lastText || "字幕會出現在這裡"}
        </div>
      </div>
    </div>
  );
}