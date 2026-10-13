# LiveCore (livio.tw) 完整分析報告

> 分析日期：2026-06-13 | 分析方式：多子代理同步爬取 HTML + CSS + JS + Web Search

---

## 一、平台概覽

| 項目 | 內容 |
|---|---|
| 平台名稱 | LiveCore 創作者控制中心 |
| 網域 | livio.tw |
| 語言 | zh-TW (正體中文) |
| 技術棧 | Next.js (React 19) + Tailwind CSS v3 + Cloudflare |
| 法律管轄 | 中華民國臺灣 |
| 聯絡方式 | `[email protected]`（混淆） |
| **3 個獨立子應用** | Dashboard (控制中心) / Public-donate (公開斗內頁) / Captions (字幕發佈器) |

---

## 二、完整功能模組清單

### ✅ 我們已經有的（14 項）
| 模組 | 路由 | 狀態 |
|---|---|---|
| 控制中心首頁 | `/dashboard` | ✅ 已完成 |
| 公開頁面設定 | `/dashboard/public-page` | ✅ 已完成 |
| 平台串接 (Twitch/YT) | `/dashboard/connections` | ✅ 已完成 |
| 金流設定 (綠界/歐付寶/PayPal) | `/dashboard/payments` | ✅ (靜態 UI) |
| 聊天室疊加層 | `/dashboard/chat` | ✅ 已完成 |
| 斗內進度 (目標管理) | `/dashboard/donations` | ✅ 已完成 |
| 字幕疊加層 | `/dashboard/subtitles` | ✅ 已完成 |
| OBS 輸出 | `/dashboard/obs` | ✅ 已完成 |
| 測試與整合 | `/dashboard/testing` | ✅ 已完成 |
| 頻道統計 | `/dashboard/stats` | ✅ 已完成 |
| 訂閱方案 | `/dashboard/subscription` | ✅ 已完成 |
| Overlay 聊天室渲染 | `/overlay/chat/[token]` | ✅ 已完成 |
| Overlay 斗內進度條 | `/overlay/donations/[token]` | ✅ 已完成 |
| Overlay 字幕渲染 | `/overlay/subtitles/[token]` | ✅ 已完成 |

### ❌ 我們缺少的（8 項，需補上）

| # | 模組 | 說明 |
|---|---|---|
| 1 | **斗內通知 (Donation Alerts)** | 斗內時在 OBS 上彈出通知動畫（頭像 + 金額 + 訊息） |
| 2 | **頻道統計疊加層 (Channel Stats Overlay)** | OBS 上顯示即時觀看數、追蹤數的疊加層（獨立於統計頁面） |
| 3 | **公開斗內頁面 (Public Donate)** | 觀眾可以捐款的公開頁面（非創作者後台） |
| 4 | **直播指令 (Live Commands)** | 設定 `!贊助`、`!社群` 等自動回覆指令 |
| 5 | **媒體索取 (Media Request)** | 觀眾點歌/點影片的審核系統 |
| 6 | **排行榜 (Leaderboard)** | 斗內排行榜 Top 捐贈者 |
| 7 | **登入授權 Modal** | Google/Twitch 登入彈窗 |
| 8 | **Toast 通知系統** | 操作成功/失敗的浮動提示 |

---

## 三、缺失功能實作計畫

### P0 優先 — 核心差異
| 功能 | 預計工時 | 說明 |
|---|---|---|
| 斗內通知 Overlay | 2h | OBS 上彈出斗內動畫（名稱 + 金額 + 訊息），含測試按鈕 |
| 頻道統計疊加層 | 1h | 即時顯示觀看數/追蹤數的 OBS 疊加層 |
| Toast 通知系統 | 1h | 全域操作回饋，取代靜態錯誤訊息 |

### P1 優先 — 完整體驗
| 功能 | 說明 |
|---|---|
| 公開斗內頁面 | 觀眾可選金額捐款（靜態 UI，串接需金流） |
| 直播指令 | 簡易指令設定 CRUD |
| 排行榜 | 斗內 Top 捐贈者列表 |

### P2 — 進階
| 功能 | 說明 |
|---|---|
| 媒體索取 | 點歌/影片審核 |
| 登入授權 Modal | 完整 OAuth 登入流程 |

---

## 四、設計系統差異

| 項目 | livio.tw | 熾台（我們） |
|---|---|---|
| Surface 顏色 | 5 層材質 | 5 層 ✅ |
| 字型 | Saans + Inter + Noto Sans TC | Geist Sans (Google Font 替代) |
| Shadow 系統 | 2 層 (soft/panel) | ✅ 一致 |
| Border Radius | xs/sm/md/lg/xl | ✅ 一致 |
| 響應式斷點 | 600/820/900/1180px | 600/820/900 ✅ |
| 元件類別 | 200+ CSS classes | 簡化版但涵蓋核心 |
