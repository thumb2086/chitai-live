import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "隱私權政策 · 熾台 CHITAI",
  description: "熾台 CHITAI 如何收集、使用與保存實況主帳戶與直播工具資料。",
};

/** 靜態頁（output: 'export'）：server component，不讀 searchParams、不抓資料。 */
export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[var(--ic-canvas)] px-5 py-12">
      <div className="mx-auto max-w-2xl">
        <p className="text-[13px] text-black/50">
          <a href="/" className="hover:text-black">← 回首頁</a>
        </p>
        <h1 className="mt-4 text-[26px] font-[750] tracking-tight text-[var(--ic-ink)]">隱私權政策</h1>
        <p className="mt-2 text-[13px] text-black/45">最後更新：2026-11-09</p>

        <div className="mt-8 space-y-6 text-[14px] leading-[1.9] text-black/70">
          <section>
            <h2 className="text-[15px] font-[700] text-[var(--ic-ink)]">我們收集什麼</h2>
            <p className="mt-2">
              帳戶資料（電子郵件、顯示名稱、頭像）、OAuth 授權狀態（Google / Twitch）、
              你在控制中心建立的工具設定（聊天室、字幕、斗內進度、指令、抽獎），
              以及為提供服務必要的技術記錄（例如登入時間、IP 區段）。
            </p>
          </section>
          <section>
            <h2 className="text-[15px] font-[700] text-[var(--ic-ink)]">用途</h2>
            <p className="mt-2">
              僅用於提供直播互動工具：顯示疊加層、處理斗內、同步平台狀態與帳戶管理。
              不販售個人資料，不用於廣告追蹤。
            </p>
          </section>
          <section>
            <h2 className="text-[15px] font-[700] text-[var(--ic-ink)]">保存與安全</h2>
            <p className="mt-2">
              資料保存在 Cloudflare D1 / KV。登入 token 以 JWT 簽發；
              前端 cookie 使用 Secure 與 SameSite 防護。登出會清除本機 token。
            </p>
          </section>
          <section>
            <h2 className="text-[15px] font-[700] text-[var(--ic-ink)]">聯絡我們</h2>
            <p className="mt-2">
              查詢、更正或刪除個人資料，請來信
              <a href="mailto:support@zixilive.dpdns.org" className="underline underline-offset-2">support@zixilive.dpdns.org</a>。
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
