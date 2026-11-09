"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Gamepad2, TvMinimalPlay, CheckCircle2, Plus, X, ExternalLink, AlertCircle, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";

function ConnectionsInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, setState] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getConnections().then(setState).catch(() => setError("載入失敗")).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const connected = searchParams.get("connected");
    const err = searchParams.get("error");
    if (err) {
      const msgs: Record<string, string> = {
        missing_params: "缺少授權參數",
        unknown_platform: "未知平台",
        missing_credentials: "請先在 .env 設定 Client ID 與 Secret",
        token_exchange_failed: "Token 交換失敗，請檢查 Client ID 與 Secret 是否正確",
        callback_failed: "授權回呼處理失敗",
      };
      setError(msgs[err] || `錯誤: ${err}`);
    }
    if (connected === "twitch" || connected === "youtube") {
      api.getConnections().then(setState);
      router.replace("/dashboard/connections");
    }
  }, []);

  const toggle = async (platform: string) => {
    if (state[platform]?.connected) {
      const result = await api.toggleConnection(platform, false);
      setState(result);
    } else {
      window.location.href = `https://api.zixilive.dpdns.org/api/auth/${platform}`;
    }
  };

  if (loading) return <div className="p-8 text-center text-[var(--ic-ink-muted)]">載入中...</div>;

  const platforms = [
    { id: "twitch", name: "Twitch", icon: Gamepad2, color: "text-[#9146ff]", desc: "同步你的 Twitch 頻道資訊、聊天室與訂閱狀態" },
    { id: "youtube", name: "YouTube", icon: TvMinimalPlay, color: "text-[#ff0033]", desc: "同步你的 YouTube 頻道資訊、聊天室與超級感謝" },
  ];

  const connectedCount = Object.values(state).filter((v: any) => v?.connected).length;

  return (
    <div className="grid grid-cols-[1fr_290px] gap-6 items-start max-lg:grid-cols-1">
      <div className="grid gap-[18px] rounded-[var(--ic-radius-lg)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] p-6">
        {error && (
          <div className="flex items-start gap-3 rounded-[var(--ic-radius-md)] border border-[rgba(196,28,28,.26)] bg-[rgba(196,28,28,.1)] p-3.5">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--ic-danger)]" />
            <div className="text-[13px] text-[var(--ic-danger)]">{error}</div>
          </div>
        )}
        <div className="grid gap-3">
          {platforms.map((p) => {
            const Icon = p.icon;
            const conn = state[p.id] || {};
            const isConnected = conn.connected;

            return (
              <div key={p.id} className="grid gap-3.5 rounded-[var(--ic-radius-lg)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] p-[18px]">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3.5">
                    <Icon className={`h-6 w-6 flex-shrink-0 ${p.color}`} />
                    <h3 className="m-0 text-[17px] font-[650] text-[var(--ic-ink)]">{p.name}</h3>
                  </div>
                  <button onClick={() => toggle(p.id)}
                    className={`flex min-h-[34px] items-center gap-1.5 rounded-[999px] px-3.5 py-[7px] text-[13px] font-[500] leading-none transition-all ${
                      isConnected
                        ? "border border-[var(--ic-hairline-strong)] bg-[var(--ic-surface-3)] text-[var(--ic-ink)] hover:border-red-300 hover:bg-red-50 hover:text-red-600"
                        : "border border-transparent bg-[var(--ic-primary)] text-white hover:bg-[var(--ic-primary-hover)]"
                    }`}>
                    {isConnected ? <><X className="h-4 w-4" /> 中斷連線</> : <><Plus className="h-4 w-4" /> 連線</>}
                  </button>
                </div>
                <p className="m-0 text-[13px] leading-[1.45] text-[var(--ic-ink-subtle)]">{p.desc}</p>
                {isConnected && conn.channelName ? (
                  <div className="flex items-center gap-3 ml-[42px] rounded-[var(--ic-radius-md)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] px-3.5 py-3">
                    {conn.channelAvatar && (
                      <img src={conn.channelAvatar} alt="" className="h-10 w-10 rounded-full" />
                    )}
                    <div>
                      <strong className="text-[14px] font-[650] text-[var(--ic-ink)]">{conn.channelName}</strong>
                      <div className="flex items-center gap-1 text-[13px] text-green-600">
                        <CheckCircle2 className="h-3.5 w-3.5" /> 已連線
                      </div>
                    </div>
                  </div>
                ) : isConnected ? (
                  <div className="ml-[42px] grid gap-1.5 rounded-[var(--ic-radius-md)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] px-3.5 py-3">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                      <strong className="text-[14px] font-[650] text-[var(--ic-ink)]">{p.name} 已連線</strong>
                      <button onClick={async () => { const r = await api.refreshConnection(p.id); setState(r); }}
                        className="ml-auto rounded p-1 text-[var(--ic-ink-tertiary)] hover:text-[var(--ic-ink)]" title="重新抓取頻道資訊">
                        <RefreshCw className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <span className="text-[13px] text-[var(--ic-ink-subtle)]">已連線{!conn.channelName ? "（到 YouTube Data API 啟用後重整，或到公開頁面手動設定名稱）" : " · 同步正常"}</span>
                  </div>
                ) : (
                  <p className="ml-[42px] text-[13px] text-[var(--ic-ink-subtle)]">尚未連線</p>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="sticky top-[82px] grid gap-3.5 rounded-[var(--ic-radius-lg)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] p-[22px]">
        <span className="text-[12px] font-[500] uppercase tracking-[0.04em] text-[var(--ic-ink-subtle)]">串接狀態</span>
        <span className={`inline-flex w-fit items-center rounded-full border px-3 py-1 text-[12px] font-[500] ${connectedCount > 0 ? "border-[rgba(11,223,80,.32)] bg-[rgba(11,223,80,.12)] text-[#075e28]" : "border-[var(--ic-hairline)] bg-[var(--ic-surface-3)] text-[var(--ic-ink-muted)]"}`}>
          {connectedCount} / 2 已連線
        </span>
        <div className="grid gap-3 text-[13px] text-[var(--ic-ink-subtle)]">
          <p>串接平台後可啟用：</p>
          <ul className="m-0 grid gap-2 pl-4"><li>聊天室即時同步</li><li>訂閱 / 贊助偵測</li><li>頻道資訊自動更新</li></ul>
        </div>
        <div className="rounded-[var(--ic-radius-md)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-3)] p-3">
          <strong className="text-[13px] text-[var(--ic-ink)]">尚未設定憑證？</strong>
          <p className="mt-1 text-[12px] text-[var(--ic-ink-muted)]">點擊「連線」按鈕會顯示設定指引。</p>
        </div>
      </div>
    </div>
  );
}

export default function ConnectionsPage() {
  return (
    <div className="max-w-[1080px]">
      <div className="mb-4 text-[13px] text-[var(--ic-ink-subtle)]">
        <a href="/dashboard" className="text-[var(--ic-primary)] no-underline">控制中心</a>
        <span className="mx-2 text-[var(--ic-ink-muted)]">/</span>
        <span className="text-[var(--ic-ink-muted)]">平台串接</span>
      </div>
      <div className="mb-6 grid gap-2">
        <h1 className="text-[34px] font-[500] leading-[1.12] text-[var(--ic-ink)]">平台串接</h1>
        <p className="max-w-[540px] text-[14px] leading-[1.6] text-[var(--ic-ink-muted)]">連結你的直播平台帳號，啟用聊天室同步、訂閱偵測與自動化功能。</p>
      </div>
      <Suspense fallback={<div className="p-8 text-center text-[var(--ic-ink-muted)]">載入中...</div>}>
        <ConnectionsInner />
      </Suspense>
    </div>
  );
}
