import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import "./globals.css";

const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

// Ordered parts of the dashboard design system (see public/css). The bundle is
// ~800KB, split so no single stylesheet is large enough for the browser to
// silently truncate it.
const CSS_PARTS = [
  "/css/dashboard.00.css?v=20261109",
  "/css/dashboard.01.css?v=20261109",
  "/css/dashboard.02.css?v=20261109",
  "/css/dashboard.03.css?v=20261109",
  "/css/dashboard.04.css?v=20261109",
  "/css/dashboard.05.css?v=20261109",
  "/css/dashboard.06.css?v=20261109",
  "/css/dashboard.07.css?v=20261109",
  "/css/patch-dashboard.css?v=20261109",
];

export const metadata: Metadata = {
  metadataBase: new URL("https://www.zixilive.dpdns.org"),
  title: "熾台 CHITAI · 創作者控制中心",
  description: "熾台直播互動工具：斗內進度、聊天室、即時字幕等疊加層設定與 OBS 連結支援。以子熙幣儲值計費。",
  applicationName: "熾台 CHITAI",
  authors: [{ name: "熾台 CHITAI" }],
  openGraph: {
    type: "website",
    locale: "zh_TW",
    url: "https://www.zixilive.dpdns.org",
    siteName: "熾台 CHITAI",
    title: "熾台 CHITAI · 創作者控制中心",
    description: "熾台直播互動工具：斗內進度、聊天室、即時字幕等疊加層設定與 OBS 連結支援。以子熙幣儲值計費。",
    images: ["/logo.svg"],
  },
  twitter: {
    card: "summary",
    title: "熾台 CHITAI · 創作者控制中心",
    description: "熾台直播互動工具：斗內進度、聊天室、即時字幕等疊加層設定與 OBS 連結支援。",
    images: ["/logo.svg"],
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW" className={geistMono.variable}>
      <head>
        {/* The reference console's stylesheet is ~800KB. Browsers silently
            truncate stylesheets that large, so it is served as ordered parts;
            splitting preserves source order so the cascade is identical.
            `precedence` is required or React rewrites these to rel="preload". */}
        {CSS_PARTS.map((href) => (
          <link key={href} rel="stylesheet" href={href} precedence="default" />
        ))}
        <link rel="preconnect" href="https://api.fontshare.com" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f[]=saans-400@1,500,600,700,800,900&display=swap"
          precedence="fonts"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Noto+Sans+TC:wght@400;500;700;900&display=swap"
          precedence="fonts"
        />
        {/* ★ 熾台 CHITAI Logo / Favicon */}
        <link rel="icon" type="image/svg+xml" href="/logo.svg" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/manifest.json" />
      </head>
      <body>{children}</body>
    </html>
  );
}
