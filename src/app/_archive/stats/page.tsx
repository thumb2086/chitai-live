"use client";

import { useCallback, useEffect, useState } from "react";
import { Gamepad2, TvMinimalPlay, BarChart3 } from "lucide-react";
import { Loading, Badge } from "@/components/ui";
import { OverlayOutput, OverlayTokenProvider } from "@/components/overlay-settings";

/**
 * Channel stats (followers / subscribers) settings.
 *
 * The markup mirrors `.channel-stats-settings-*`. That family is not fully
 * mechanical — it has `.channel-stats-editor-header` (no `-settings`) plus
 * `.channel-stats-preview-*` / `.channel-stats-card-heading` children, and no tab
 * strip — so this page writes the structure directly instead of going through
 * the shared shell, which would emit class names the stylesheet does not define.
 */

type StatsPayload = {
  followers: number;
  twitch: number;
  youtube: number;
  sources: {
    platform: string;
    connected: boolean;
    known: boolean;
    count: number;
    channelName: string | null;
    detail: string | null;
  }[];
};

const PLATFORM = {
  twitch: { label: "Twitch 追蹤", Icon: Gamepad2, color: "#9146ff" },
  youtube: { label: "YouTube 訂閱", Icon: TvMinimalPlay, color: "#ff0033" },
} as const;

export default function StatsPage() {
  return (
    <OverlayTokenProvider overlayKey="channel-stats">
      <StatsInner />
    </OverlayTokenProvider>
  );
}

function StatsInner() {
  const [data, setData] = useState<StatsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/stats");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (e: any) {
      setError(`讀取頻道數據失敗：${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) return <Loading />;

  const sources = data?.sources ?? [];
  const knownCount = sources.filter((s) => s.known).length;

  return (
    <section className="channel-stats-settings-page">
      <header className="channel-stats-settings-header">
        <span className="channel-stats-settings-icon" aria-hidden="true">
          <BarChart3 size={28} />
        </span>
        <div>
          <h1>頻道數據</h1>
          <p>追蹤與訂閱數，來自已串接的平台。</p>
        </div>
      </header>

      <div className="channel-stats-settings-summary" aria-label="頻道數據狀態">
        <div>
          <span>合計追蹤</span>
          <strong>{knownCount ? (data?.followers ?? 0).toLocaleString() : "--"}</strong>
        </div>
        <div>
          <span>已串接平台</span>
          <strong>
            {sources.filter((s) => s.connected).length} / {sources.length}
          </strong>
        </div>
        <div>
          <span>可讀取數據</span>
          <strong className={knownCount ? "is-enabled" : ""}>{knownCount} 個</strong>
        </div>
      </div>

      <div className="channel-stats-settings-workspace">
        <section className="channel-stats-settings-preview">
          <h2>整體顯示效果預覽</h2>
          <div className="channel-stats-preview-card-stack">
            {(["twitch", "youtube"] as const).map((key) => {
              const src = sources.find((s) => s.platform === key);
              const { label, Icon, color } = PLATFORM[key];
              const show = src?.known ? src.count.toLocaleString() : "--";
              return (
                <div key={key} className="channel-stats-preview-row">
                  <span className="channel-stats-platform-label">
                    <span className="channel-stats-platform-icon">
                      <Icon size={24} color={color} />
                    </span>
                    <span className="channel-stats-preview-provider">
                      <strong style={{ color }}>{label}</strong>
                    </span>
                  </span>
                  <p style={{ color }}>{show}</p>
                </div>
              );
            })}
          </div>
          <div className="channel-stats-preview-lower-third">
            <div className="channel-stats-preview-card-stack">
              <div className="channel-stats-preview-row">
                <span className="channel-stats-preview-provider">
                  <strong>合計追蹤數</strong>
                </span>
                <p>{knownCount ? (data?.followers ?? 0).toLocaleString() : "--"}</p>
              </div>
            </div>
          </div>
          <p className="settings-note">
            顯示「--」代表該平台沒有可讀取的數據，跟真的 0 是不同的意思。
          </p>
        </section>

        <div>
          <OverlayOutput title="頻道數據輸出" />

          <section className="channel-stats-settings-editor">
            <header className="channel-stats-editor-header">
              <h2>數據來源</h2>
              <span>每分鐘更新</span>
            </header>

            <div className="channel-stats-settings-status">
              <span className="settings-note" data-channel-stats-save-status data-state={error ? "error" : "saved"}>
                {error ?? (loading ? "更新中…" : `上次更新 ${new Date().toLocaleTimeString("zh-TW")}`)}
              </span>
              <button type="button" className="ghost-button" data-channel-stats-retry onClick={load} disabled={loading}>
                {loading ? "重新整理中…" : "立即重新整理"}
              </button>
            </div>

            <form className="stack">
              {sources.map((s) => {
                const meta = PLATFORM[s.platform as keyof typeof PLATFORM];
                const Icon = meta?.Icon ?? BarChart3;
                return (
                  <div key={s.platform} className="channel-stats-settings-card">
                    <div className="channel-stats-card-heading">
                      <span>
                        <Icon size={16} color={meta?.color ?? "#079455"} />
                      </span>
                      <span>
                        <strong>{meta?.label ?? s.platform}</strong>
                        <small className="settings-note">
                          {s.channelName ?? "尚未取得頻道名稱"}
                          {s.detail ? ` · ${s.detail}` : ""}
                        </small>
                      </span>
                    </div>

                    <div className="creator-toggle-row">
                      <span>
                        <strong>{s.known ? s.count.toLocaleString() : "--"}</strong>
                        <small>
                          {s.known
                            ? "平台回報的實際數字"
                            : s.connected
                              ? `無法讀取：${s.detail ?? "未知原因"}`
                              : "尚未串接此平台"}
                        </small>
                      </span>
                      <Badge tone={s.known ? "ok" : s.connected ? "danger" : "neutral"}>
                        {s.known ? "可讀取" : s.connected ? "需處理" : "未串接"}
                      </Badge>
                    </div>
                  </div>
                );
              })}

              <div className="channel-stats-settings-card">
                <p className="settings-note">
                  Twitch 的追蹤數需要權杖帶有 <code>moderator:read:followers</code> 權限，
                  沒有時 API 會拒絕呼叫 —— 這時顯示「--」而不是 0。
                </p>
                <div className="action-row">
                  <a className="ghost-link" href="/dashboard/connections">
                    前往平台授權
                  </a>
                  <a className="ghost-link" href="/dashboard/obs">
                    前往 OBS 輸出
                  </a>
                </div>
              </div>
            </form>
          </section>
        </div>
      </div>
    </section>
  );
}
