import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "服務條款 · 熾台 CHITAI",
  description: "使用熾台 CHITAI 直播互動工具的條款：帳戶、子熙幣計費與服務可用性。",
};

/** 靜態頁（output: 'export'）：server component。 */
export default function TermsPage() {
  return (
    <div className="min-h-screen bg-[var(--ic-canvas)] px-5 py-12">
      <div className="mx-auto max-w-2xl">
        <p className="text-[13px] text-black/50">
          <a href="/" className="hover:text-black">← 回首頁</a>
        </p>
        <h1 className="mt-4 text-[26px] font-[750] tracking-tight text-[var(--ic-ink)]">服務條款</h1>
        <p className="mt-2 text-[13px] text-black/45">最後更新：2026-11-09</p>

        <div className="mt-8 space-y-6 text-[14px] leading-[1.9] text-black/70">
          <section>
            <h2 className="text-[15px] font-[700] text-[var(--ic-ink)]">服務內容</h2>
            <p className="mt-2">
              熾台提供直播互動工具（聊天室、即時字幕、斗內、直播指令、抽獎、
              回放分析、OBS 疊加層輸出）。工具透過瀏覽器來源嵌入直播軟體。
            </p>
          </section>
          <section>
            <h2 className="text-[15px] font-[700] text-[var(--ic-ink)]">帳戶與授權</h2>
            <p className="mt-2">
              帳戶以 Google / Twitch OAuth 或電子郵件註冊。平台授權（YouTube / Twitch）
              由你自行在授權頁同意與撤銷，遵守各平台服務條款。
            </p>
          </section>
          <section>
            <h2 className="text-[15px] font-[700] text-[var(--ic-ink)]">子熙幣計費</h2>
            <p className="mt-2">
              計費以子熙幣（ZXC）儲值扣點，無月費、無合約。免費工具不扣點；
              回放分析依影片長度計點。餘額留在帳戶，不自動扣款。
            </p>
          </section>
          <section>
            <h2 className="text-[15px] font-[700] text-[var(--ic-ink)]">可用性</h2>
            <p className="mt-2">
              服務以靜態站點（Cloudflare Pages）與 Workers API 提供，
              不保證在各平台政策變更或第三方服務中斷時仍可使用。
            </p>
          </section>
          <section>
            <h2 className="text-[15px] font-[700] text-[var(--ic-ink)]">聯絡我們</h2>
            <p className="mt-2">
              條款相關問題請來信
              <a href="mailto:support@zixilive.dpdns.org" className="underline underline-offset-2">support@zixilive.dpdns.org</a>。
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
