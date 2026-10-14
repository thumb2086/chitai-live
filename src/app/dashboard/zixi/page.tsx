"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Wallet, ExternalLink, Check, Link2, Unlink, LogIn } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/toast/Toast";

export default function ZixiPage() {
  // ★ callback 跳過來時網址帶 ?success=connected 或 ?error=xxx，
  //   而這頁原本**完全沒讀** —— 所以即使授權成功也沒有任何提示，
  //   使用者只會看到跟剛才一樣的畫面，無法分辨成不成功。
  //
  //   用法比照 dashboard/connections（useSearchParams 必須包在 Suspense 裡，
  //   否則整頁在靜態輸出時會去讀 request 而失敗）。
  return (
    <Suspense fallback={<div className="p-8 text-center text-[var(--ic-ink-muted)]">載入中...</div>}>
      <ZixiInner />
    </Suspense>
  );
}

function ZixiInner() {
  const searchParams = useSearchParams();
  const [wallet, setWallet] = useState("");
  const [zixiConnected, setZixiConnected] = useState(false);
  const [zixiAddress, setZixiAddress] = useState("");
  const [zixiName, setZixiName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { show } = useToast();

  // ★ 把 callback 的結果講出來。
  //   錯誤訊息要寫「這是什麼」而不是代碼 ——
  //   使用者看到 error=not_logged_in 只會更困惑。
  const cbError = searchParams.get("error");
  const cbSuccess = searchParams.get("success");
  const [cbNotice, setCbNotice] = useState<string | null>(null);
  useEffect(() => {
    if (cbError) {
      const map: Record<string, string> = {
        not_logged_in: "你連線 ZIXI 時沒有登入熾台，請先回到控制台登入再試一次。",
        session_not_found: "找不到你的登入階段，請重新登入熾台。",
        missing_client_secret: "伺服器沒有設定 ZIXI 應用程式金鑰，請聯絡管理員。",
        no_code: "ZIXI 沒有回傳授權碼，授權可能已被取消。",
        token_exchange_failed: "ZIXI 拒絕了這次授權，請確認應用程式狀態是否正常。",
        callback_failed: "串接時發生錯誤，請稍後再試。",
      };
      setCbNotice(map[cbError] || `串接失敗（${cbError}）`);
    } else if (cbSuccess === "connected") {
      setCbNotice("已成功連線 ZIXI 帳戶。");
    }
  }, [cbError, cbSuccess]);

  useEffect(() => {
    api.getUser().then(u => {
      setWallet(u.zixiWallet || "");
      // ★ 這裡原本是 `if (u.zixiAccessToken)`。
      //   而 /api/v1/user **刻意不回傳** zixiAccessToken ——
      //   那是活的三方 OAuth bearer，送到瀏覽器等於憑證外洩。
      //   該路由改回傳衍生布林值 zixiConnected：
      //     zixiConnected: Boolean(u.zixiAccessToken) && (!expires || expires > new Date())
      //
      //   但這裡沒跟著改，於是讀一個永遠是 undefined 的欄位，結果
      //   **授權成功、token 也確實存進資料庫了，畫面卻一直顯示「尚未連線」**。
      //   2026-10-14 實測：DB 裡 zixiAccessToken 有值（zixi_oat_96d…）、
      //   到期日一個月後，而前端說沒連線。
      //
      //   ★ 安全修正與前端要一起改。只改一邊會產生這種
      //     「後端成功但使用者看到失敗」的症狀 —— 而且方向相反：
      //     看起來像壞了，實際上資料都是對的。
      if (u.zixiConnected) {
        setZixiConnected(true);
        api.zixiProxy({ action: "me" }).then((res: any) => {
          if (res.success && res.data?.data) {
            setZixiAddress(res.data.data.address || "");
            setZixiName(res.data.data.user?.displayName || "");
          }
        }).catch(() => {});
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    await api.updateUser({ zixiWallet: wallet.trim() }).then(() => show("錢包地址已儲存", "success")).catch(() => show("儲存失敗", "error"));
    setSaving(false);
  };

  if (loading) return <div className="p-8 text-center text-[var(--ic-ink-muted)]">載入中...</div>;

  return (
    <div className="max-w-[1080px]">
      {/* ★ callback 的結果。沒有這一條的話，使用者按完授權回來
          看到的是一模一樣的畫面，無法分辨到底成不成功。*/}
      {cbNotice && (
        <div
          role="status"
          aria-live="polite"
          className="mb-4 rounded-[var(--ic-radius-md)] border p-3 text-[13px] leading-[1.7]"
          style={cbError
            ? { borderColor: "rgba(220,38,38,.3)", background: "rgba(220,38,38,.06)", color: "#b91c1c" }
            : { borderColor: "rgba(11,167,124,.3)", background: "rgba(11,167,124,.07)", color: "#075e28" }}
        >
          {cbNotice}
        </div>
      )}
      <div className="mb-4 text-[13px] text-[var(--ic-ink-subtle)]">
        <a href="/dashboard" className="text-[var(--ic-primary)] no-underline">控制中心</a>
        <span className="mx-2 text-[var(--ic-ink-muted)]">/</span>
        <span className="text-[var(--ic-ink-muted)]">ZIXI 生態系</span>
      </div>
      <div className="mb-6 grid gap-2">
        <h1 className="text-[34px] font-[500] leading-[1.12] text-[var(--ic-ink)]">子熙幣收款設定</h1>
        <p className="max-w-[560px] text-[14px] leading-[1.6] text-[var(--ic-ink-muted)]">
          讓觀眾用子熙幣（ZXC）或佑戩幣（YJC）直接贊助你的直播。
          設定分兩步：<strong>① 連線 ZIXI 帳戶　② 填入你的錢包地址</strong>，兩步都完成後公開頁面就能收斗內。
        </p>
      </div>
      <div className="grid grid-cols-[1fr_290px] gap-6 items-start max-lg:grid-cols-1">

        <div className="grid gap-4">
          {/* ZIXI Account Connection */}
          <div className="rounded-[var(--ic-radius-lg)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] p-6">
            <span className="text-[12px] font-[500] uppercase tracking-[0.04em] text-[var(--ic-ink-subtle)]">ZIXI 帳戶串接</span>
            {zixiConnected ? (
              <div className="mt-4">
                <div className="flex items-center gap-3 rounded-[var(--ic-radius-md)] border border-green-200 bg-green-50 p-4">
                  <Link2 className="h-5 w-5 text-green-600" />
                  <div className="text-[13px] text-green-800">
                    <strong>已連線</strong>
                    {zixiName && <span className="ml-2">{zixiName}</span>}
                    {zixiAddress && <p className="m-0 mt-1 font-mono text-[12px] text-green-600">{zixiAddress}</p>}
                  </div>
                </div>
                <a href="/api/auth/zixi" className="mt-3 flex w-fit items-center gap-2 rounded-[var(--ic-radius-md)] border border-[var(--ic-hairline)] bg-[var(--ic-canvas)] px-4 py-2.5 text-[13px] font-[500] text-[var(--ic-ink-muted)] no-underline hover:bg-[var(--ic-surface-3)]">
                  <Unlink className="h-4 w-4" /> 重新連線
                </a>
              </div>
            ) : (
              <div className="mt-4">
                {/* ★ 這段說明要講清楚「會離開這個頁面」，不然使用者以為被丟掉。
                    實測（2026-10-14）：authorize 端回 needsLogin:true，
                    必須先在 ZIXI 那邊有帳號並登入才能授權 ——
                    但頁面上原本完全沒提，症狀看起來就是「跳到賭場沒回來」。 */}
                <div className="mb-3 text-[13px] text-[var(--ic-ink-muted)] leading-[1.6]">
                  連線你的 ZIXI 帳戶，觀眾就能用子熙幣（ZXC）或佑戩幣（YJC）贊助你。
                  <div className="mt-2 rounded-[var(--ic-radius-md)] border border-amber-200 bg-amber-50 p-3 text-[12px] leading-[1.7] text-amber-900">
                    <strong>需要先有 ZIXI 帳號</strong>。按下後會離開本頁前往 ZIXI 授權，
                    授權完成會自動回到這裡。ZIXI 帳號免費註冊，錢包地址在註冊後就會給你。
                  </div>
                </div>
                {/* ★ 用設計系統的 .primary-button，不要自己刻 bg-[var(--ic-primary)] + text-white。
                    原因：[data-livecore-entry=dashboard] a { color: inherit }
                    的特異度是 0-1-1，贏過 .text-white 的 0-1-0 ——
                    結果深色字疊深色底，按鈕文字完全看不見。
                    .primary-button 特異度 0-2-0，且已經含 color:#ffffff。*/}
                <a href="/api/auth/zixi" className="primary-button inline-flex items-center gap-2">
                  <LogIn className="h-4 w-4" /> 前往 ZIXI 授權
                </a>
              </div>
            )}
          </div>

          {/* Wallet Address */}
          <div className="rounded-[var(--ic-radius-lg)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] p-6">
            <span className="text-[12px] font-[500] uppercase tracking-[0.04em] text-[var(--ic-ink-subtle)]">錢包設定</span>

            <div className="mt-4 grid gap-3">
              <div className="grid gap-1">
                <span className="text-[12px] font-[500] text-[var(--ic-ink-muted)]">ZIXI 錢包地址</span>
                <input value={wallet} onChange={e => setWallet(e.target.value)}
                  placeholder="0x..." className="rounded-[var(--ic-radius-md)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] px-3 py-2.5 text-[14px] font-mono text-[var(--ic-ink)] outline-none focus:border-[var(--ic-fin-orange)]" />
              </div>
              {/* 同上：用 .primary-button，這個按鈕因為是 <button> 沒被 a{color:inherit} 蓋到，
                  但兩處寫法不一致下次改版就會又踩到。*/}
              <button onClick={save} disabled={saving} className="primary-button">
                {saving ? "儲存中..." : <><Check className="h-4 w-4" /> 儲存錢包地址</>}
              </button>
            </div>

            <div className="mt-4 rounded-[var(--ic-radius-md)] border border-[var(--ic-hairline)] bg-[var(--ic-canvas)] p-4">
              <span className="text-[12px] font-[500] uppercase tracking-[0.04em] text-[var(--ic-ink-subtle)]">支援代幣</span>
              <div className="mt-3 grid gap-3">
                <div className="flex items-center gap-3 rounded-[var(--ic-radius-md)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] p-3">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-orange-100 text-sm font-bold text-orange-600">ZXC</div>
                  <div><strong className="text-[14px] font-[600] text-[var(--ic-ink)]">子熙幣 (ZXC)</strong><p className="m-0 text-[12px] text-[var(--ic-ink-muted)]">生態核心代幣，用於遊戲、交易、贊助</p></div>
                </div>
                <div className="flex items-center gap-3 rounded-[var(--ic-radius-md)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] p-3">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-purple-100 text-sm font-bold text-purple-600">YJC</div>
                  <div><strong className="text-[14px] font-[600] text-[var(--ic-ink)]">佑戩幣 (YJC)</strong><p className="m-0 text-[12px] text-[var(--ic-ink-muted)]">稀缺保值代幣，1 YJC = 1 億 ZXC</p></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="sticky top-[82px] grid gap-3.5 rounded-[var(--ic-radius-lg)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] p-[22px]">
          <Wallet className="h-8 w-8 text-[var(--ic-fin-orange)]" />
          <span className="text-[12px] font-[500] uppercase tracking-[0.04em] text-[var(--ic-ink-subtle)]">還沒有錢包地址？</span>
          <div className="text-[13px] text-[var(--ic-ink-subtle)] leading-[1.6]">
            <p className="m-0">到 ZIXI 官網註冊帳號，錢包地址會自動發給你。</p>
          </div>
          {/* ★ 同樣的原因改用 .primary-button：這顆是 <a>，
              原本的 text-white 被 [data-...=dashboard] a{color:inherit} 蓋掉，
              深色字疊深色底，按鈕看起來是空的。*/}
          <a href="https://zixi-casino.vercel.app" target="_blank" rel="noopener noreferrer"
            className="primary-button inline-flex w-full items-center justify-center gap-1.5">
            <ExternalLink className="h-4 w-4" /> 前往 ZIXI 註冊
          </a>
          <div className="rounded-[var(--ic-radius-md)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-3)] p-3 text-[12px] leading-[1.7] text-[var(--ic-ink-muted)]">
            順序是：<strong>先連線 ZIXI 帳戶</strong> → 再把錢包地址貼進左邊儲存。
            兩步都完成，觀眾才能在你的公開頁面用 ZXC／YJC 贊助你。
          </div>
        </div>
      </div>
    </div>
  );
}
