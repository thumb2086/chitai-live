# 熾台 專案完成度評估報告

> 評估日期：2026-06-13 | 專案階段：早期原型 (MVP Skeleton)

---

## 一、總體摘要

| 項目 | 狀態 |
|---|---|
| **專案性質** | 前端 SPA 原型，無後端伺服器 |
| **技術棧** | Next.js 16 + React 19 + Tailwind CSS 4 + TypeScript 5 |
| **儲存層** | 僅 `localStorage`（無資料庫） |
| **真實後端整合** | 0% — 所有 API 呼叫皆為模擬/假資料 |
| **可運作功能** | 僅 UI 操作與設定儲存，無任何外部服務連線 |
| **production-ready 功能** | 0 個 |

---

## 二、逐頁完成度

### ✅ 已完成（可視為完成）
| 頁面 | 說明 |
|---|---|
| 首頁 Landing (`/`) | 靜態行銷頁面，無問題 |

### ⚠️ 部分完成（UI 可操作 + localStorage 儲存，但無後端）
| 頁面 | 完成度 | 缺什麼 |
|---|---|---|
| 儀表板首頁 (`/dashboard`) | 70% | 引導步驟應連結到對應設定頁面 |
| 公開頁面 (`/dashboard/public-page`) | 60% | 無實際 `/@username` 路由存在 |
| 字幕疊加層 (`/dashboard/subtitles`) | 60% | 無 STT 語音轉文字、無 WebVTT、無實際 overlay 路由 |
| 斗內進度 (`/dashboard/donations`) | 65% | 無金流串接，捐款純模擬，`soundEffect` 為死碼 |
| 訂閱方案 (`/dashboard/subscription`) | 80% | 以「全部免費」而言 UI 完整，但無 billing 整合 |
| 資料層 (`lib/store.ts`) | 70% | 適合原型，production 需換資料庫 + 資料驗證 |

### ❌ 模擬/佔位（僅 UI 外殼，無真實功能）
| 頁面 | 問題 |
|---|---|
| 聊天室 (`/dashboard/chat`) | 無 WebSocket，`setInterval` 塞假訊息，overlay 網址為 fake domain |
| OBS 輸出 (`/dashboard/obs`) | URL 為 `chitai.example`，無實際 overlay route 提供內容 |
| 頻道統計 (`/dashboard/stats`) | 手動輸入資料，成長率 `+23%` 等為寫死字串，無 API 整合 |
| 平台串接 (`/dashboard/connections`) | OAuth 流程為自我 redirect 循環，從未連到 Twitch/YouTube |
| 測試與整合 (`/dashboard/testing`) | 同聊天室 mock，API 網址為 fake domain |
| 金流設定 (`/dashboard/payments`) | 完全靜態，input 不儲存，按鈕無作用 |
| OAuth API Routes | 兩支 API route 皆 mock，不回傳真实 token |

---

## 三、關鍵問題

### 1. 「串流留言等位置是真的可用？」
**否。** 所有 overlay 位置設定（聊天室位置、字幕底部置中/頂部置中等）**僅在設定頁面的預覽區塊內可視**。

- 沒有實際的 `/overlay/chat/[token]` 或 `/overlay/subtitles/[token]` 路由
- 所有 Browser Source URL 指向 `chitai.example` — 不存在的域名
- 即使把網址貼到 OBS，也只會得到 404

要讓位置真正可用需要：
- 建立 overlay 渲染頁面（`/overlay/*`）
- overlay 頁面需讀取使用者的設定（資料庫，非 localStorage）
- overlay 頁面需輸出純 HTML/CSS/JS（無 React 水合負擔）

### 2. 所有「數據」都是假的
- 頻道統計：手動輸入 + `Math.random()` 填充
- 成長率百分比：寫死字串
- 斗內金額：模擬按鈕自嗨

### 3. 無後端基礎設施
- 無資料庫
- 無 WebSocket 伺服器
- 無金流 SDK
- 無 OAuth client credentials

---

## 四、生產環境需求對照

| 功能 | 現在 | 生產環境需要 |
|---|---|---|
| 聊天室 | `setInterval` 假訊息 | WebSocket + Twitch IRC / YouTube Live Chat API |
| 平台串接 | 自我 redirect | 真實 OAuth 2.0 + PKCE + refresh token |
| 斗內 | 模擬按鈕 | 金流串接（綠界/PayPal/Stripe）+ Webhook |
| OBS 輸出 | fake domain URL | `/overlay/*` 路由 + token 認證 |
| 字幕 | 顏色/字型設定 | STT (Whisper/Google/Azure) + WebVTT |
| 統計 | 手動填寫 | Twitch Helix API + YouTube Data API |
| 金流設定 | 靜態 UI | 伺服器端 secret 儲存 + SDK |
| 公開頁面 | 設定 localStorage | `/@username` 動態路由 + 資料庫讀取 |
| 儲存層 | localStorage | PostgreSQL / SQLite via Prisma |

---

## 五、程式碼品質

| 項目 | 評分 | 備註 |
|---|---|---|
| UI 架構 | ★★★★☆ | 元件拆分合理，設計一致性高 |
| TypeScript 類型 | ★★★★☆ | 完整類型定義，嚴格模式 |
| 資料流 | ★★★☆☆ | `useClientStore` hook 設計良好，但缺伺服器同步 |
|  Responsive | ★★★☆☆ | 基本 RWD，無 hamburger menu |
| 無障礙 (a11y) | ★★☆☆☆ | 缺少 `aria-current`、鍵盤導航 |
| 錯誤處理 | ★★☆☆☆ | 僅基本 try/catch，無 error boundary |
| 測試 | ☆☆☆☆☆ | 無任何測試 |
