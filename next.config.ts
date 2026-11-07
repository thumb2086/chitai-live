import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 靜態導出 - 部署到 Cloudflare Pages，不需要 OpenNext
  output: 'export',
  
  // 靜態導出需要關閉圖片優化
  images: {
    unoptimized: true,
  },
  
  // Turbopack 設定 (monorepo 根目錄)
  turbopack: {
    root: path.resolve(__dirname, "..", ".."),
  },
  
  // 可選：處理尾部斜線
  // trailingSlash: true,
};

export default nextConfig;