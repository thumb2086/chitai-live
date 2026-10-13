# 熾台 — 完整架構與實作計畫

> 開源直播工具平台。將實況主需要的聊天、斗內、字幕、疊加層整合進單一控制台。

---

## 一、專案架構

```
livestream-dashboard/
├── prisma/                      # 資料庫 Schema + Migration
├── src/
│   ├── app/                     # Next.js App Router
│   │   ├── [username]/          # 公開創作者頁
│   │   ├── api/                 # REST API
│   │   │   ├── auth/            # OAuth 登入
│   │   │   └── v1/              # 核心 API
│   │   ├── dashboard/           # 創作者控制台
│   │   │   ├── chat/            # 聊天室設定
│   │   │   ├── connections/     # 平台串接
│   │   │   ├── donations/       # 斗內管理
│   │   │   ├── obs/             # OBS 輸出
│   │   │   ├── public-page/     # 公開頁設定
│   │   │   ├── stats/           # 頻道統計
│   │   │   ├── testing/         # 測試工具
│   │   │   └── zixi/            # 子熙幣
│   │   ├── donate/              # 公開斗內頁
│   │   └── overlay/             # OBS 疊加層渲染
│   ├── components/              # 共用元件
│   └── lib/                     # 工具函式
├── public/                      # 靜態資源
└── 部署配置
```

---

## 二、技術棧

| 層級 | 技術 | 版本 |
|------|------|------|
| 框架 | Next.js | 16 |
| 語言 | TypeScript | 5 |
| 樣式 | Tailwind CSS | 4 |
| 資料庫 | PostgreSQL (Neon) / SQLite | |
| ORM | Prisma | 7 |
| 圖示 | Lucide React | |
| 聊天 IRC | tmi.js | |
| 容器 | Docker | |

---

## 三、資料庫模型

### User — 創作者
```
id              String @id @default(cuid())
name            String @default("創作者")
username        String @unique
createdAt       DateTime @default(now())
publicPage      Boolean @default(true)
chosenPlan      String @default("入門")
donationMinAmount Int   @default(30)
donationSound   String @default("預設音效")
donationTotal   Int    @default(0)
donationDonors  Int    @default(0)
totalViews      Int    @default(0)
followers       Int    @default(0)
totalMessages   Int    @default(0)
demoMode        Boolean @default(false)
email           String @default("")
zixiWallet      String @default("")
avatar          String @default("")
```

### ChatSettings — 聊天室設定（1:1 User）
```
enabled     Boolean @default(true)
theme       String  @default("dark")    // dark | light | transparent
maxMessages String  @default("最近 50 則")
fontSize    String  @default("中")
```

### SubtitleConfig — 字幕設定（1:1 User）
```
font      String @default("預設")
fontSize  String @default("中 (24px)")
textColor String @default("#FFFFFF")
bgColor   String @default("rgba(0,0,0,0.7)")
position  String @default("底部置中")
enabled   Boolean @default(true)
```

### DonationGoal — 斗內目標（1:N User）
```
title     String
emoji     String @default("🎯")
current   Int    @default(0)
goal      Int
sortOrder Int    @default(0)
```

### OBSSource — OBS 疊加層來源（1:N User）
```
sourceKey String       // chat | donations | subtitles | alerts | stats
name      String
token     String       // 隨機認證 token
enabled   Boolean @default(true)
```

### PlatformConnection — 平台串接（1:N User, @@unique userId+platform）
```
platform       String   // twitch | youtube
connected      Boolean
accessToken    String?
refreshToken   String?
tokenExpiresAt DateTime?
channelId      String?
channelName    String?
channelAvatar  String?
```

### ZixiDonation — 子熙幣捐款（1:N User）
```
donorAddress String
donorName    String @default("")
amount       Float
token        String @default("ZXC")   // ZXC | YJC
txHash       String?
message      String @default("")
status       String @default("pending") // pending | confirmed
```

### ChatMessage — 聊天室訊息
```
platform  String   // twitch | youtube
userName  String
message   String
avatarUrl String
isOwner   Boolean
createdAt DateTime @default(now())
```

### 其他
```
Session         — OAuth 登入 session
OnboardState    — 新手引導步驟
```

---

## 四、API 路由

### 認證

| 路由 | 方法 | 說明 |
|------|------|------|
| `/api/auth/[platform]` | GET | OAuth 跳轉（Twitch / YouTube） |
| `/api/auth/callback` | GET | OAuth callback，交換 token、建立 session |
| `/api/auth/logout` | POST | 清除 session cookie |

### v1 核心 API

| 路由 | 方法 | 說明 |
|------|------|------|
| `/api/v1/user` | GET, PATCH | 取得/更新使用者資料 |
| `/api/v1/seed` | POST | 確保使用者存在 |
| `/api/v1/onboard` | GET, POST | 新手引導狀態 |
| `/api/v1/connections` | GET, POST | 平台串接 CRUD |
| `/api/v1/chat` | GET, PUT | 聊天室設定 |
| `/api/v1/chat/messages` | POST | 寫入聊天訊息 |
| `/api/v1/donations` | GET, POST | 斗內目標 CRUD |
| `/api/v1/obs` | GET, POST | OBS 來源管理 |
| `/api/v1/stats` | GET, POST | 頻道統計 + 直播紀錄 |
| `/api/v1/zixi-donations` | GET, POST | 子熙幣捐款 |
| `/api/v1/zixi/proxy` | POST | ZIXI 後端代理 |
| `/api/v1/zixi/check-tx` | POST | 區塊鏈交易查詢 |

### ★ 新增 API

| 路由 | 方法 | 說明 |
|------|------|------|
| `/api/v1/subtitles` | GET, PUT | 字幕設定 CRUD |
| `/api/v1/transcript` | POST | 建立逐字稿任務 |
| `/api/v1/transcript/[id]` | GET | 查詢逐字稿結果 |
| `/api/v1/clips` | POST | 建立剪輯任務 |
| `/api/v1/clips/[id]` | GET | 查詢剪輯狀態 |

---

## 五、頁面結構

### 公開頁面

| 路由 | 類型 | 說明 |
|------|------|------|
| `/` | 首頁 | 登入/註冊 landing page |
| `/[username]` | Server | 創作者公開 profile（頭像、名稱、斗內目標） |
| `/donate/[username]` | Server | 斗內頁面（ZXC / YJC 付款） |

### 控制台（Dashboard）

| 路由 | 說明 | 功能 |
|------|------|------|
| `/dashboard` | 主控中心 | 引導步驟 + 狀態卡片 + 快捷統計 |
| `/dashboard/chat` | 聊天室設定 | 主題、字型、數量、即時預覽 |
| `/dashboard/connections` | 平台串接 | Twitch / YouTube OAuth 管理 |
| `/dashboard/donations` | 斗內目標 | 新增/編輯/刪除目標 |
| `/dashboard/donations/alerts` | 斗內通知 | OBS URL + 測試 Alert |
| `/dashboard/obs` | OBS 輸出 | 5 種疊加層 URL 管理 |
| `/dashboard/public-page` | 公開頁設定 | 開關公開頁、編輯資訊 |
| `/dashboard/stats` | 頻道統計 | Twitch 追蹤 + YouTube 訂閱 |
| `/dashboard/testing` | 測試工具 | 模擬訊息、預覽疊加層 |
| `/dashboard/zixi` | 子熙幣錢包 | 設定錢包地址 |
| `/dashboard/zixi/donations` | 捐款記錄 | 歷史紀錄 + 區塊鏈掃描 |
| `/dashboard/zixi/admin-setup` | 管理帳號 | ZIXI 後台設定 |

### ★ 新增頁面

| 路由 | 說明 |
|------|------|
| `/dashboard/subtitles` | 字幕設定（字型、顏色、位置） |
| `/dashboard/transcript` | 逐字稿管理 + 建立任務 |
| `/dashboard/transcript/[id]` | 逐字稿結果 + 時間軸 |
| `/dashboard/clips` | 剪輯管理 |
| `/dashboard/clips/[id]` | 剪輯任務詳情 |

---

## 六、OBS 疊加層系統

全部為**純靜態 HTML**（非 React），由 API route handler 直接輸出，內嵌 JS 輪詢：

| 疊加層 | 路由 | 輪詢間隔 | 顯示內容 |
|--------|------|---------|---------|
| 聊天室 | `/overlay/chat/[token]` | 3s | 聊天訊息、頭像、徽章 |
| 斗內進度 | `/overlay/donations/[token]` | 10s | 進度條、目標 |
| 斗內通知 | `/overlay/alerts/[token]` | 5s | 斗內動畫卡片 |
| 頻道統計 | `/overlay/stats/[token]` | 30s | 追蹤/訂閱數 |
| 字幕 | `/overlay/subtitles/[token]` | ★ 待實作 | 即時字幕顯示 |

### ★ 字幕 overlay 實作規劃

```
GET /overlay/subtitles/[token]
→ 查 OBSSource (sourceKey: "subtitles")
→ 回傳 HTML:
  - 讀取 SubtitleConfig（字型、顏色、位置）
  - SSE 或 polling 接收即時字幕
  - CSS position 對應設定值（底部置中、頂部等）
```

---

## 七、認證流程

```
使用者點擊「Twitch / YouTube 登入」
  → /api/auth/[platform] → 302 跳轉 OAuth 授權頁
  → 使用者同意 → callback 到 /api/auth/callback
  → 交換 code → access_token + refresh_token
  → 建立/更新 PlatformConnection
  → 建立 Session（sf_session cookie）
  → 302 跳轉到 /dashboard
```

- 無密碼登入，完全依賴平台 OAuth
- `getOrCreateUser(sessionId)` 查 DB → 回傳 User
- 未認證 → 401 → 前端導回首頁

---

## 八、ZIXI（子熙幣）生態

### 捐款流程

```
創作者設定錢包地址（/dashboard/zixi）
  ↓
觀眾到 /donate/[username]
  ↓
選擇 ZXC / YJC 幣種 + 輸入金額
  ↓
呼叫 ZIXI API 執行轉帳
  ↓
建立 ZixiDonation（status: pending）
  ↓
區塊鏈確認 → 更新 status 為 confirmed
  ↓
觸發斗內 Alert + 更新 Goal Bar
```

### API Proxy

```
/api/v1/zixi/proxy → ZIXI Casino 後端
  /auth/custody/login
  /admin/adjust-balance
  /admin/setup-account
  /balance
  /transactions
```

---

## 九、開發路線

### Phase 1 — 基礎重構（1-2 週）

優先修復：
- [ ] 移除金流設定頁（綠界/歐付寶/PayPal 相關 UI）
- [ ] 修復 Overlay demo 訊息 bug（setInterval 問題）
- [ ] 硬編碼 token 動態化（abc123 等 seed token）
- [ ] 子熙幣捐款 MVP（ZXC 轉帳 + 確認）
- [ ] 確認所有 localStorage → DB 遷移完整

### Phase 2 — 字幕系統（1 週）

- [ ] `/api/v1/subtitles` — GET, PUT CRUD
- [ ] `/dashboard/subtitles` — 設定頁面（字型、顏色、位置）
- [ ] `/overlay/subtitles/[token]` — 字幕疊加層渲染
- [ ] SubtitleConfig model 補上 DB schema
- [ ] Overlay 字幕 SSE/polling 即時更新

### Phase 3 — Groq 逐字稿（1-2 週）

- [ ] Groq API 封裝（lib/groq.ts）
- [ ] `/api/v1/transcript` — POST 建立任務（YT 回放連結 → Groq Whisper）
- [ ] `/api/v1/transcript/[id]` — GET 查詢結果
- [ ] `/dashboard/transcript` — 任務管理 UI
- [ ] `/dashboard/transcript/[id]` — 時間軸 + 全文顯示
- [ ] SRT / TXT / JSON 匯出

### Phase 4 — 剪輯功能（2 週）

- [ ] FFmpeg 處理封裝（lib/clips.ts）
- [ ] `/api/v1/clips` — POST 建立任務（回放連結 + 時間區段）
- [ ] `/api/v1/clips/[id]` — GET 查詢狀態 + 下載
- [ ] `/dashboard/clips` — 剪輯管理 UI
- [ ] `/dashboard/clips/[id]` — 片段預覽
- [ ] 基於逐字稿時間軸選取片段
- [ ] 字幕硬編碼至輸出影片

### Phase 5 — 即時語音 + 優化（1 週）

- [ ] Web Speech API 封裝（lib/speech.ts）
- [ ] 字幕頁面切換：Groq（精準）vs Web Speech（即時）
- [ ] 效能優化（Next.js build、圖片、快取）
- [ ] Docker 部署配置
- [ ] 補上 .env.example + 文件

---

## 十、檔案變更總表

### 新增檔案

```
prisma/migrations/             — 字幕 model migration
src/lib/groq.ts                — Groq API 封裝
src/lib/clips.ts               — 剪輯處理
src/lib/speech.ts              — Web Speech API 封裝
src/app/api/v1/subtitles/route.ts       — 字幕 CRUD
src/app/api/v1/transcript/route.ts      — 逐字稿任務
src/app/api/v1/transcript/[id]/route.ts — 查詢結果
src/app/api/v1/clips/route.ts           — 剪輯任務
src/app/api/v1/clips/[id]/route.ts      — 查詢狀態
src/app/dashboard/subtitles/page.tsx    — 字幕設定頁
src/app/dashboard/transcript/page.tsx   — 逐字稿管理
src/app/dashboard/transcript/[id]/page.tsx — 結果頁
src/app/dashboard/clips/page.tsx        — 剪輯管理
src/app/dashboard/clips/[id]/page.tsx   — 剪輯詳情
src/app/overlay/subtitles/[token]/route.ts — 字幕 overlay
```

### 修改檔案

```
prisma/schema.prisma           — +SubtitleConfig (font, fontSize, textColor, bgColor, position, enabled)
src/app/dashboard/layout.tsx   — +側邊欄連結（字幕、逐字稿、剪輯）
src/components/Sidebar.tsx     — +導航選項
src/lib/api.ts                 — +新 API 方法
```

---

## 十一、部署

```bash
# 開發
npm run dev

# 建置
npm run build

# Docker
docker build -t streamflow .
docker run -p 3000:3000 streamflow

# 環境變數
DATABASE_URL=postgresql://...
YOUTUBE_CLIENT_ID=...
YOUTUBE_CLIENT_SECRET=...
TWITCH_CLIENT_ID=...
TWITCH_CLIENT_SECRET=...
GROQ_API_KEY=...
ZIXI_API_URL=...
ZIXI_API_KEY=...
```
