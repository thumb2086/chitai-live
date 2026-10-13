# 熾台 開發計畫

> 目標：從目前 UI 原型逐步打造成可實際部署的開源直播工具平台

---

## 版本規劃總覽

```
v0.1 (目前) → v0.5 (MVP) → v1.0 (Beta) → v1.5 (生產就緒) → v2.0 (完整平台)
```

---

## v0.5 — 可運作 MVP（預計 2-3 週）

### 目標：讓 overlay 真正能在 OBS 中顯示

#### 後端基礎建設
- [ ] 建立 SQLite 資料庫（via Drizzle ORM 或 Prisma）
- [ ] 建立 REST API 基礎架構 (`/api/v1/*`)
- [ ] 將所有 `localStorage` 狀態遷移到資料庫
- [ ] 加入 API token 認證機制

#### Overlay 渲染引擎（核心）
- [ ] 建立 `/overlay/chat/[token]` 路由 — 渲染聊天室疊加層
  - [ ] 讀取資料庫中的聊天室設定（主題、字型大小、位置）
  - [ ] 輸出純 HTML/CSS（無 React 水合，輕量）
  - [ ] 支援多種位置：右下、左下、全屏覆蓋
  - [ ] 位置設定真正對應到 CSS `position` / `transform`
- [ ] 建立 `/overlay/donations/[token]` 路由 — 渲染斗內進度條
  - [ ] 讀取資料庫中的目標與進度
  - [ ] 動態進度條動畫
- [ ] 建立 `/overlay/subtitles/[token]` 路由 — 渲染字幕疊加層
  - [ ] 讀取字型、大小、顏色、位置設定
  - [ ] 位置設定真正對應到 CSS（底部置中、頂部置中等）

#### OBS 輸出頁面
- [ ] OBS 頁面的 Browser Source URL 改指向真實部署域名
- [ ] 加入「在 OBS 中使用」引導步驟
- [ ] 複製按鈕確保跨平台相容

#### 儀表板改善
- [ ] 引導步驟改為可點擊跳轉到對應設定頁
- [ ] 狀態卡片從資料庫讀取真實數據
- [ ] 加入錯誤處理與載入狀態

---

## v1.0 — Beta 版本（預計 3-4 週）

### 目標：聊天室真實連線 + 平台串接可用

#### 聊天室即時同步
- [ ] 建立 WebSocket 伺服器（獨立服務或 Next.js API + `ws`）
- [ ] 聊天室疊加層透過 WebSocket 接收即時訊息
- [ ] 支援多種顯示模式：滾動、卡牌、彈幕
- [ ] 留言位置設定真正對應 overlay 渲染：
  - 底部置中（`bottom: 20px; left: 50%; transform: translateX(-50%)`）
  - 底部靠左（`bottom: 20px; left: 20px`）
  - 全屏彈幕（`position: fixed; inset: 0`）
- [ ] 新增留言過濾器（關鍵字黑名單、等級限制）

#### 平台串接（真實 OAuth）
- [ ] Twitch OAuth 2.0 整合
  - [ ] 申請 Twitch Application client ID / secret
  - [ ] 實作授權跳轉 → callback → token 交換
  - [ ] access token + refresh token 儲存於資料庫
  - [ ] token 自動刷新機制
- [ ] YouTube OAuth 2.0 整合
  - [ ] 申請 Google Cloud API credentials
  - [ ] 實作授權流程
  - [ ] 串接 YouTube Live Chat API
- [ ] 在平台串接頁顯示真實連線狀態
- [ ] 中斷連線時確實 revoke token

#### 統計資料自動化
- [ ] 串接 Twitch Helix API 取得：
  - [ ] 即時觀看數
  - [ ] 追蹤者數量與成長趨勢
  - [ ] 近期直播場次數據
- [ ] 串接 YouTube Data API 取得：
  - [ ] 頻道訂閱數
  - [ ] 影片/直播觀看數據
- [ ] 取代所有 mock 數據與寫死字串
- [ ] 成長率改為真實計算（`((current - previous) / previous) * 100`）

#### 公開創作者頁面
- [ ] 建立 `/[username]` 動態路由
- [ ] 頁面顯示：
  - [ ] 創作者頭像與名稱
  - [ ] 線上/離线狀態
  - [ ] 贊助連結
  - [ ] 近期直播列表

---

## v1.5 — 生產就緒（預計 3-4 週）

### 目標：金流串接 + 字幕功能 + 品質強化

#### 斗內 / 金流
- [ ] 串接綠界科技 ECPay SDK
  - [ ] 伺服器端建立訂單
  - [ ] 接收付款通知 webhook
- [ ] 串接 PayPal API
- [ ] 斗內成功後：
  - [ ] 更新進度條
  - [ ] 觸發疊加層動畫效果
  - [ ] 發送 WebSocket 通知到 overlay
- [ ] 金流設定頁面改為真實儲存（資料庫，非 localStorage）
- [ ] 金流設定頁面的 input 可編輯/儲存

#### 即時字幕
- [ ] 整合語音轉文字服務：
  - [ ] OpenAI Whisper API
  - [ ] 或 Google Cloud Speech-to-Text
- [ ] WebSocket 傳送即時字幕到 overlay
- [ ] 字幕位置設定真正對應到 overlay 渲染
- [ ] 支援多語言字幕

#### 品質與基礎設施
- [ ] 加入 Error Boundary 元件
- [ ] 加入 React Suspense 邊界 + loading skeletons
- [ ] 完整的表單驗證
- [ ] 加入 `aria-*` 屬性與鍵盤導航支援
- [ ] 行動版 hamburger menu
- [ ] 加入 Playwright 端對端測試
- [ ] 加入單元測試 (Vitest)
- [ ] 設定 CI/CD pipeline (GitHub Actions)
- [ ] 加入 Sentry 錯誤監控
- [ ] 加入資料庫 Migration 機制
- [ ] localStorage 資料向後相容遷移腳本

---

## v2.0 — 完整平台（預計 4-6 週）

### 目標：多用戶 + 進階功能 + 生態系

#### 多用戶支援
- [ ] 使用者註冊/登入系統
  - [ ] 電子郵件 + 密碼
  - [ ] OAuth 第三方登入（Google, Twitch）
- [ ] 使用者工作區隔離
- [ ] 權限管理

#### 進階 Overlay 功能
- [ ] 自訂 CSS 編輯器（即時預覽）
- [ ] 多場景切換（不同 overlay layout 設定集）
- [ ] 自訂動畫效果
- [ ]  overlay 排版拖曳編輯器

#### 數據與分析
- [ ] 儀表板圖表（Chart.js 或 Recharts）
  - [ ] 觀看趨勢折線圖
  - [ ] 斗內長條圖
  - [ ] 聊天室活躍度熱力圖
- [ ] 匯出報表 (CSV/PDF)
- [ ] 自訂日期區間查詢

#### 生態系
- [ ] REST API 公開文件（OpenAPI/Swagger）
- [ ] WebSocket API 文件
- [ ] Widget SDK 讓開發者自訂 overlay 元件
- [ ] 社群 template 市集

#### 部署與維運
- [ ] Docker 化
- [ ] docker-compose 一鍵部署
- [ ] Helm chart (Kubernetes)
- [ ] 支援多種部署方式：
  - [ ] 自行部署（開源）
  - [ ] 雲端託管版本

---

## 技術債務追蹤

| 項目 | 優先級 | 預計版本 |
|---|---|---|
| 移除 `setInterval` 假訊息 | P0 | v1.0 |
| 字幕背景色 picker bug | P1 | v0.5 |
| 移除 `soundEffect` 死碼或補上 UI | P1 | v0.5 |
| 移除 `chitai.example` 假域名 | P0 | v0.5 |
| 移除所有 `Math.random()` 填充數據 | P0 | v1.0 |
| 移除寫死成長率字串 | P0 | v1.0 |
| localStorage → 資料庫遷移 | P0 | v0.5 |
| 金流頁面 static mock → 真實儲存 | P1 | v1.5 |
| 補上測試 | P2 | v1.5 |

---

## 如何貢獻

```bash
# 開發
npm run dev

# 建置
npm run build

# 程式碼風格
npm run lint

# 測試（規劃中）
npm run test
```

---

## 關於 Overlay 位置的真實實作

### 目前狀態
所有位置設定（聊天室位置、字幕位置）**只在設定頁面的預覽小區塊內有效**，貼到 OBS 完全無用。

### v0.5 實作方式

聊天室位置 → `/overlay/chat/[token]` 輸出：

```html
<!-- 底部置中 -->
<div style="position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); width: 80%;">
  <!-- 聊天訊息列表 -->
</div>

<!-- 底部靠左 -->
<div style="position: fixed; bottom: 20px; left: 20px; width: 400px;">
  <!-- 聊天訊息列表 -->
</div>

<!-- 全屏彈幕 -->
<div style="position: fixed; inset: 0; overflow: hidden;">
  <!-- 彈幕訊息 -->
</div>
```

字幕位置 → `/overlay/subtitles/[token]` 輸出：

```css
/* 底部置中 */
.subtitle-container { position: fixed; bottom: 60px; left: 50%; transform: translateX(-50%); text-align: center; }

/* 頂部置中 */
.subtitle-container { position: fixed; top: 60px; left: 50%; transform: translateX(-50%); text-align: center; }

/* 底部靠左 */
.subtitle-container { position: fixed; bottom: 60px; left: 20px; text-align: left; }
```

### OBS 使用方式
1. 在 OBS 新增「Browser Source」
2. 貼上 熾台 提供的 URL（如 `https://your-domain.com/overlay/chat/abc123`）
3. 設定寬度 1920、高度 1080
4. 按確定 — overlay 即會顯示在直播畫面上
