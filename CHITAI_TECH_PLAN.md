# 熾台 — 開源技術規劃

> 以現有 `livestream-dashboard` 為基礎，加入 Groq 逐字稿、剪輯功能、Web Speech API、子熙幣生態，全面開源重構。

---

## 技術棧

| 層級 | 技術 | 用途 |
|------|------|------|
| 框架 | Next.js 16 (App Router) | 全端框架 |
| 語言 | TypeScript | |
| 樣式 | Tailwind CSS v4 | |
| 資料庫 | SQLite (開發) / PostgreSQL (生產) | Prisma ORM |
| 認證 | 簡易 API Token → 後續 OAuth | |
| 部署 | Docker / Vercel / 自行部署 | |

---

## 功能架構

```
livestream-dashboard/
├── app/
│   ├── [username]/          # 公開創作者頁
│   ├── api/                 # REST API
│   ├── dashboard/           # 創作者控制台
│   │   ├── chat/            # 聊天室設定
│   │   ├── connections/     # 平台串接
│   │   ├── donations/       # 斗內 + 子熙幣
│   │   ├── obs/             # OBS 疊加層
│   │   ├── public-page/     # 公開頁設定
│   │   ├── stats/           # 統計數據
│   │   ├── testing/         # 測試工具
│   │   ├── zixi/            # 子熙幣專區
│   │   ├── transcript/      # ★ Groq 逐字稿
│   │   └── clips/           # ★ 剪輯功能
│   ├── donate/              # 公開斗內頁
│   └── overlay/             # OBS 渲染
├── components/              # 共用元件
├── lib/                     # 工具函式
└── prisma/                  # 資料庫 schema
```

---

## 資料庫 Schema

```
User              — 創作者帳號
ChatSettings      — 聊天室設定
SubtitleConfig    — 字幕設定
DonationGoal      — 斗內目標
OBSSource         — OBS 疊加層
PlatformConnection— Twitch/YouTube 串接
ZixiDonation      — 子熙幣捐款
ChatMessage       — 聊天室訊息
OnboardState      — 新手引導
★ Transcript      — Groq 逐字稿記錄
★ Clip            — 剪輯任務
★ ClipSegment     — 剪輯片段
```

---

## 核心功能模組

### 1. Groq 逐字稿（★ 新增）

```
輸入：YouTube/Twitch 直播回放連結
處理：Groq API（Whisper 模型）→ 逐字稿
輸出：時間軸標記 + 全文 + 重點摘要
```

- 支援語言：繁體中文、英文
- 輸出格式：SRT / TXT / JSON
- 儲存逐字稿記錄，支援重新生成
- 可選：用 Web Speech API 做即時語音辨識（見第 5 點）

### 2. 剪輯功能（★ 新增）

```
輸入：直播回放連結 + 時間區段
處理：FFmpeg 或雲端 API 剪輯
輸出：短影音片段（MP4）
```

- 基於逐字稿時間軸選取片段
- 支援多段合併
- 自動加入字幕（硬編碼）
- 輸出解析度：1080p / 720p
- 可選：直接上傳到 YouTube Shorts / IG Reels

### 3. Overlay 疊加層系統

| 疊加層 | 功能 | 狀態 |
|--------|------|------|
| 聊天室 | 即時顯示聊天訊息 | 已有 |
| 斗內進度條 | 捐款目標追蹤 | 已有 |
| 即時字幕 | WebSocket 串流字幕 | 已有 |
| 頻道數據 | 觀看數、追蹤數 | 已有 |

### 4. 子熙幣（ZXC / YJC）生態

取代傳統金流，完全虛擬貨幣：

- **ZXC（子熙幣）** — 主貨幣
- **YJC（佑戩幣）** — 輔助貨幣
- 創作者錢包地址管理
- 斗內頁選擇 ZXC / YJC 付款
- 捐款記錄鏈上驗證（txHash）

### 5. Web Speech API 即時語音

- 瀏覽器原生 SpeechRecognition API
- 免 API Key、免後端即時轉寫
- 適合低精準度需求的即時字幕場景
- 與 Groq（高精度）互補使用

---

## 技術架構圖
```

[Twitch]               [YouTube]
   │ WebSocket/Helix      │ YouTube Data API v3
   ▼                      ▼
[Next.js API Routes]
      │
      ├── Chat → tmi.js / YouTube Live Chat API → Broadcast → Overlay
      ├── Donation → Zixi API → DB
      ├── Stats → YouTube Sub count, Twitch followers
      ├── Auth → OAuth 2.0 (Twitch + YouTube)
      ├── Connections → 即時頻道資訊同步
      ├── Transcript → Groq API (從 YT 回放下載音訊)
      └── Clip → FFmpeg → Storage
      │
      ▼
[Prisma DB (PostgreSQL)]
      │
      ▼
[Overlay Routes] → OBS Browser Source
```

---

## Twitch API 整合

### 已實作
| 功能 | API | 說明 |
|------|-----|------|
| OAuth 登入 | Twitch OAuth 2.0 | 使用者授權 |
| 頻道資訊 | Helix `/users` | 頭像、名稱、ID |
| 追蹤數 | Helix `/channels/followers` | 儀表板統計 |
| 即時聊天室 | tmi.js (IRC) | 聊天室疊加層已運作 |

### 需補上
| 功能 | API | 用途 |
|------|-----|------|
| 直播狀態 | Helix `/streams` | 檢查是否在直播中 |
| VOD 清單 | Helix `/videos` | 選 VOD 餵 Groq 逐字稿 |
| Token 自動刷新 | Twitch OAuth token | 目前無 refresh_token 機制 |

---

## YouTube API 整合

### 已實作
| 功能 | API | 說明 |
|------|-----|------|
| OAuth 登入 | Google OAuth 2.0 | 使用者授權 YouTube |
| 頻道資訊 | `/v3/channels?part=snippet` | 頭像、名稱、handle |
| 訂閱數 | `/v3/channels?part=statistics` | 儀表板統計數據 |
| Token 自動刷新 | `oauth2.googleapis.com/token` | refresh_token 已實作 |

### 需補上
| 功能 | API | 用途 |
|------|-----|------|
| 直播狀態查詢 | `/v3/search?eventType=live` | 判斷是否在直播中 |
| 即時聊天室 | `/v3/liveChat/messages` | YouTube 聊天室疊加層 |
| 回放清單 | `/v3/search?type=video` | 選 VOD 餵 Groq 逐字稿 |
| 聊天室 ID | `/v3/videos?part=liveStreamingDetails` | 取得 activeLiveChatId |

---

## 開發路線

### Phase 1 — 基礎重構（1-2 週）
- 現有 UI 調整為開源友好
- 移除 LiveCore 特定設定（金流頁面、硬編碼 token）
- 子熙幣捐款 MVP（ZXC 支援）
- Overlay demo 訊息 bug 修復

### Phase 2 — 逐字稿系統（1-2 週）
- Groq API 串接
- 逐字稿任務建立 + 結果頁
- SRT 匯出
- 時間軸標記

### Phase 3 — 剪輯功能（2 週）
- FFmpeg 後端處理
- 基於逐字稿的片段選取 UI
- 影片輸出 + 字幕硬編碼
- 公開 API

### Phase 4 — Web Speech + 優化（1 週）
- 瀏覽器即時語音辨識
- Groq / Web Speech 切換
- 效能優化
- Docker 部署

---

## 檔案結構變動

```
src/
├── app/
│   ├── api/
│   │   ├── transcript/
│   │   │   ├── route.ts        # ★ 逐字稿任務
│   │   │   └── [id]/route.ts   # ★ 查詢結果
│   │   └── clips/
│   │       ├── route.ts        # ★ 剪輯任務
│   │       └── [id]/route.ts   # ★ 查詢狀態
│   └── dashboard/
│       └── transcript/         # ★ 逐字稿設定頁
│       └── clips/              # ★ 剪輯管理頁
├── lib/
│   ├── groq.ts                 # ★ Groq API 封裝
│   ├── clips.ts                # ★ 剪輯處理邏輯
│   └── speech.ts               # ★ Web Speech API 封裝
└── components/
    └── clips/                  # ★ 剪輯相關元件
```

---

## 部署

```bash
# 開發
npm run dev

# 建置
npm run build

# Docker
docker build -t streamflow .
docker run -p 3000:3000 streamflow
```
