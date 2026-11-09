"use client";

import { useState, useEffect } from "react";
import { Bell, Heart, Copy, Check } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/toast/Toast";

export default function DonationAlertsPage() {
  const [obsSources, setObsSources] = useState<any[]>([]);
  const [userName, setUserName] = useState("");
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  const { show } = useToast();

  useEffect(() => {
    setOrigin(window.location.origin);
    Promise.all([api.getOBS(), api.getUser()]).then(([o, u]) => { setObsSources(o.sources); setUserName(u.username || ""); }).catch(() => {});
  }, []);

  // Two mistakes here, both confirmed against the backing code:
  //   the payload field is `key`, not `sourceKey`, so this never matched; and
  //   the registered overlay key is "donation-alert" (lib/overlays.ts), not
  //   "alerts" -- "alerts" is its route *path*. Either way url stayed null, the
  //   複製網址 button below never rendered, and the page always told the user to
  //   go enable the source in OBS even when it was already enabled.
  const alertSource = obsSources.find((s: any) => s.key === "donation-alert");
  // The API already returns an absolute url; prefer it over rebuilding by hand.
  const url: string | null = alertSource?.url ?? null;

  const testAlert = async () => {
    // Report what actually happened. The success toast used to fire before the
    // request and regardless of its result, so a 400 "No wallet configured", a
    // 404, or a total network failure all looked identical -- and the endpoint
    // writes a real `status: "confirmed"` row, so "fired" has a lasting effect.
    try {
      const res = await fetch("https://api.zixilive.dpdns.org/api/v1/zixi-donations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: userName, donorAddress: "0xTestDonor", amount: 300, token: "ZXC", message: "測試斗內通知！", isTest: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `操作失敗 (${res.status})`);
      show("🧪 測試斗內通知已觸發！（檢查 OBS 疊加層）", "success");
      show("注意：這筆測試會以 confirmed 寫入斗內紀錄與排行榜，需要手動刪除。", "info");
    } catch (e: any) {
      show(`❌ 測試通知失敗：${e?.message || "未知錯誤"}`, "error");
    }
  };

  return (
    <div className="max-w-[1080px]">
      <div className="mb-4 text-[13px] text-[var(--ic-ink-subtle)]">
        <a href="/dashboard" className="text-[var(--ic-primary)] no-underline">控制中心</a>
        <span className="mx-2 text-[var(--ic-ink-muted)]">/</span>
        <a href="/dashboard/donations" className="text-[var(--ic-primary)] no-underline">斗內</a>
        <span className="mx-2 text-[var(--ic-ink-muted)]">/</span>
        <span className="text-[var(--ic-ink-muted)]">斗內通知</span>
      </div>
      <div className="mb-6 grid gap-2">
        <h1 className="text-[34px] font-[500] leading-[1.12] text-[var(--ic-ink)]">斗內通知</h1>
        <p className="max-w-[520px] text-[14px] leading-[1.6] text-[var(--ic-ink-muted)]">當觀眾斗內時，在直播畫面上顯示通知動畫。</p>
      </div>
      <div className="grid grid-cols-[1fr_290px] gap-6 items-start max-lg:grid-cols-1">
        <div className="grid gap-4 rounded-[var(--ic-radius-lg)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] p-6">
          <span className="text-[12px] font-[500] uppercase tracking-[0.04em] text-[var(--ic-ink-subtle)]">通知預覽</span>

          <div className="flex items-center gap-4 rounded-[var(--ic-radius-lg)] border border-[var(--ic-hairline)] bg-[var(--ic-canvas)] p-4" style={{ background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)" }}>
            <div className="flex h-[52px] w-[52px] flex-shrink-0 items-center justify-center rounded-full bg-[var(--ic-fin-orange)] text-xl font-bold text-white">小</div>
            <div className="min-w-0 flex-1">
              <div className="text-[16px] font-[600] text-white">小美</div>
              <div className="text-[13px] text-white/60">加油！最喜歡你的台了 💖</div>
            </div>
            <div className="flex-shrink-0 text-[22px] font-[800] text-[var(--ic-fin-orange)]">ZXC 300</div>
          </div>

          <div className="mt-2 grid gap-3">
            <span className="text-[12px] font-[500] uppercase tracking-[0.04em] text-[var(--ic-ink-subtle)]">樣式設定</span>
            <div className="grid grid-cols-2 gap-3.5 max-sm:grid-cols-1">
              <div className="grid gap-1">
                <span className="text-[12px] font-[500] text-[var(--ic-ink-muted)]">通知位置</span>
                <select className="rounded-[var(--ic-radius-md)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] px-3 py-2.5 text-[14px] text-[var(--ic-ink)] outline-none">
                  <option>頂部置中</option><option>底部置中</option><option>右上角</option>
                </select>
              </div>
              <div className="grid gap-1">
                <span className="text-[12px] font-[500] text-[var(--ic-ink-muted)]">顯示時間</span>
                <select className="rounded-[var(--ic-radius-md)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] px-3 py-2.5 text-[14px] text-[var(--ic-ink)] outline-none">
                  <option>4 秒</option><option>6 秒</option><option>8 秒</option>
                </select>
              </div>
            </div>
          </div>

          <button onClick={testAlert} className="flex w-fit min-h-[36px] items-center gap-2 rounded-[var(--ic-radius-md)] border border-transparent bg-[var(--ic-primary)] px-4 text-[13px] font-[500] text-white transition-all hover:bg-[var(--ic-primary-hover)]">
            <Bell className="h-4 w-4" /> 測試通知
          </button>
        </div>

        <div className="sticky top-[82px] grid gap-3.5 rounded-[var(--ic-radius-lg)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] p-[22px]">
          <span className="text-[12px] font-[500] uppercase tracking-[0.04em] text-[var(--ic-ink-subtle)]">輸出設定</span>
          <span className={`inline-flex w-fit items-center rounded-full border px-3 py-1 text-[12px] font-[500] ${alertSource?.enabled ? "border-[rgba(11,223,80,.32)] bg-[rgba(11,223,80,.12)] text-[#075e28]" : "border-[var(--ic-hairline)] bg-[var(--ic-surface-3)] text-[var(--ic-ink-muted)]"}`}>
            {alertSource?.enabled ? "啟用中" : "未啟用"}
          </span>
          <div className="rounded-[var(--ic-radius-md)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-3)] p-3">
            <strong className="text-[14px] text-[var(--ic-ink)]">Browser Source 網址</strong>
            <p className="mt-1 break-all text-[13px] text-[var(--ic-ink-muted)]">{url || "請先在 OBS 頁面啟用"}</p>
          </div>
          {url && (
            <button onClick={() => { navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
              className="flex w-full items-center justify-center rounded-[var(--ic-radius-md)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] px-3 py-2.5 text-[13px] font-[500] text-[var(--ic-ink)] hover:border-[var(--ic-hairline-strong)]">
              {copied ? <Check className="h-4 w-4 mr-1 text-green-600" /> : <Copy className="h-4 w-4 mr-1" />}{copied ? "已複製" : "複製網址"}
            </button>
          )}
          <a href="/dashboard/obs" className="flex w-full items-center justify-center rounded-[var(--ic-radius-md)] border border-transparent bg-[var(--ic-primary)] px-3 py-2.5 text-[13px] font-[500] text-white no-underline hover:bg-[var(--ic-primary-hover)]">管理 OBS 來源</a>
        </div>
      </div>
    </div>
  );
}
