# livestream-dashboard 改造計劃（RAG 知識庫 ＋ 介面簡化 ＋ 子熙幣金流）

> 建立日期：2026-10-14
> 狀態：**待確認後執行**（有 3 項決策還沒回覆，見〈§9 待決事項〉）
> 取代：`REPORT-livio-analysis.md`、`livio_tw_dashboard_分析報告.md`（2026-06 的舊分析，站名與功能都已變）

---

## 0. 一句話

把 36 個頁面的後台砍成 **11 條選單**，接上 **NIM 嵌入 + 我們自己中轉** 的知識庫
（Podcast / YouTube 頻道可問答），金流全面改 **子熙幣**，不碰任何 Livio 的程式碼。

---

## 1. 已經確定的

| # | 決定 | 來源 |
|---|---|---|
| 1 | **回放分析保留** | 使用者指定 |
| 2 | **方案成本我們自己吸收** | 使用者指定 |
| 3 | **嵌入模型用 NVIDIA NIM** | 使用者指定 |
| 4 | **回答用 LLM**（走我們的中轉） | 使用者指定 |
| 5 | **支援 YouTube 頻道、Podcast 分析** | 使用者指定 |
| 6 | **後端一律走我們自己的中轉**（Groq ／ BYOK ／ 我們方案） | 使用者指定 |
| 7 | **金流用子熙幣** | 使用者指定 |
| 8 | **品牌用我們自己的** | 使用者指定 |
| 9 | **做簡化版**，砍掉多餘與花俏功能 | 使用者指定 |
| 10 | **LiveCore 閉源，不進我們的 GitHub** | 使用者指定 |

---

## 2. 紅線（不能碰）

```
✗ 不複製 LiveCore / livio.tw 的任何程式碼
    · 只參考公開頁面上「有什麼功能」與「怎麼排版」
    · 2026-10-14 已刪除 temp_*.js（14 檔 / 1.4 MB）
      ——那些是從 livio.tw 生產 JS 抽出的 webpack chunk，
      也就是**別家的編譯碼**，雖然沒進版控也不該留在專案目錄
    · LiveCore 在 C:\Users\...\program\LiveCore（316 MB）
      是**獨立 repo**，不在我們任何專案底下 → 不會被推上去

✗ 不讓前端決定走哪個上游
    → 三種來源（Groq／BYOK／我們方案）全部收斂到中轉的一個入口

✗ 不把上游金鑰送到瀏覽器
```

---

## 3. 現況（實測，不是推測）

### 3.1 頁面數

```
36 個實體頁面，其中 31 個掛在側邊選單（6 組）
孤兒頁面（做了但選單裡沒有）：/dashboard、/dashboard/giveaways、/donate/[username]、/[username]
```

選單分組現況：

| 組 | 數 | 內容 |
|---|---|---|
| 控制台 | 5 | 觀眾斗內頁、平台授權、金流設定、回放分析、帳戶設定 |
| SHOP 與活動 | 2 | 周邊商店、台聚活動 |
| 斗內工具 | **10** | 卡牌、共用房間、通知、紀錄、進度條、影片、影片審核、跑馬燈、排行榜、**測試頁面** |
| OVERLAY 與互動 | 8 | 追隨提醒、聊天室、字幕、頻道數據、同時觀看人數、比分板、指令機器人、OBS |
| ZIXI 生態系 | 2 | 錢包設定、捐款記錄 |
| 會員 | 4 | 會員中心、訂閱方案、用量點數、付款發票 |

**問題不在功能藏起來，是選單本身爆炸。** 斗內一個主題切了 10 頁，彼此完全沒有 import（實測），
所以合併風險低。

### 3.2 儲存（實測 Neon）

```
Neon PostgreSQL 18.6 · 9,768 kB（約 9.5 MB，幾乎是空的）
✅ pgvector 0.8.6 已啟用並實測通過（2026-10-14）
   CREATE EXTENSION vector → 向量型別與 <-> 距離運算都正常
pg_trgm 1.6 可用（未裝）
ReplaySegment / ReplayJob 表已存在，0 列
CaptionSegment 52 列 · ChatMessage 1 列 · User 7 列
```

**結論：RAG 庫不用買任何東西。** Neon 內建 pgvector，開一條 SQL 就好。

### 3.3 字幕（已有的真實資產）

```
subtitle-daemon/caption_daemon.py  33 KB
  → 不是 Whisper，是 sherpa-onnx 本機串流模型
  → x-asr-160ms-streaming-zipformer-transducer-zh-en-punct-int8
  → 16 kHz / CHUNK_MS = 160
  → 這是【直播即時字幕】用的，不是離線長音檔轉寫
```

---

## 4. 關鍵區分：直播字幕 ≠ 長影片分析

這兩件事**工具不同、負載不同，不要混成一條管線**：

```
直播即時字幕
  → caption_daemon.py（sherpa-onnx 本機，160 ms 串流）
  → 已有、已在跑，這條不要動

YT / Podcast 分析（離線批處理）
  → 下載音檔 → 切成數十分鐘的片段 → Groq whisper-large-v3-turbo
  → 逐字稿切塊 → NIM 嵌入 → pgvector
  → 使用者問答 → 檢索 top-k → 中轉生成
```

Playlist_Administrator（`C:\Users\...\program\Playlist_Administrator`）是**桌面 app、全本機**：

| | Playlist_Admin | 我們 | 原因 |
|---|---|---|---|
| 向量庫 | ChromaDB（本地檔案） | **pgvector（Neon）** | ChromaDB 沒有多租戶，Web 版放不進去 |
| 嵌入 | Ollama `bge-m3` | **NIM `nvidia/nemotron-3-embed-1b`** | 指定使用 NIM |
| 生成 | 本機 `qwen2.5:7b` | **我們的中轉** | 伺服器沒 GPU 跑 7B |

**可以沿用的（純邏輯，與本機／雲端無關）：**
- `rag/` 的切塊策略、增量索引（跳過已索引檔名）
- `rag/srt_to_text.py`（SRT → 純文字）
- `core/downloader.py` 裡的 yt-dlp 抓取（已處理 mp3/m4a/opus/flac 與官方 MV 過濾）

---

## 5. 真實成本（用我們自己的 `MODEL_PRICES` 算，不是猜的）

一小時內容的完整流程：

| 步驟 | 模型 | 成本 |
|---|---|---|
| 轉寫 | `whisper-large-v3-turbo` | **$0.04 / 時** |
| 嵌入 | `nvidia/nemotron-3-embed-1b` | $0.02 / 1M tokens（1 小時 ≈ 1 萬 tokens → $0.0002） |
| 問答（每次） | `openai/gpt-oss-120b` | 8k in × $0.15/1M ＋ 500 out × $0.60/1M ≈ $0.0015 |

**一小時內容 ≈ $0.04。問答只佔轉寫的 4%。**

| 規模 | 用量 | 我們月支出 |
|---|---|---|
| 100 人 × 3 小時/月 | 300 時 | **$12** |
| 1,000 人 × 3 小時/月 | 3,000 時 | **$120** |
| 10,000 人 × 3 小時/月 | 30,000 時 | **$1,200** |

**「成本自己吸收」完全負擔得起。這不是該猶豫的地方。**
（若改用 `whisper-large-v3` 非 turbo 則 $0.111/時，約 2.8 倍 —— 先用 turbo，品質夠用。）

---

## 6. 架構：唯一入口

```
前端（瀏覽器）
   │
   │  只知道「我要問一個問題」
   ▼
livestream-dashboard API          ← 認證、額度、扣點、記帳
   │
   │  唯一記帳點：這次請求是 BYOK 還是我們付
   ▼
groq-router（中轉）               ← 金鑰池、多供應商備援、真實指標
   │
   ├── Groq 官方        （BYOK：使用者自己的金鑰 → 他付）
   ├── NIM 嵌入         （我們付，$0.02/1M）
   └── Groq whisper     （我們付，$0.04/時）
```

**為什麼不能讓前端選來源：**
前端選 = 三套程式碼、三處計費、三個可能洩漏金鑰的地方。
收斂後只有一個地方知道誰付了錢，日後加計費／算毛利／退款才有依據。
BYOK 只是**在收斂點換一把上游金鑰**，不是另一條流程。

---

## 7. 分階段執行

### 階段 A：介面簡化（先做，不碰後端邏輯）

**選單 31 → 11**

保留：

| 選單 | 路由 | 理由 |
|---|---|---|
| 斗內進度條＋紀錄 | `/dashboard/donations`（併 `donations/records`） | 核心 |
| 斗內通知 | `/dashboard/donations/alerts` | OBS 彈窗是刚需 |
| 聊天室 | `/dashboard/chat` | 核心 |
| 即時字幕 | `/dashboard/subtitles` | **我們比它強**（真串流語音管線） |
| 直播指令＋抽獎 | `/dashboard/commands`（把 `/giveaways` 接進來） | 本來是同一套 |
| 回放分析 | `/dashboard/replay-analysis` | 已指定保留 |
| 子熙幣金流 | `/dashboard/zixi` ＋ `/dashboard/zixi/donations` | 取代第三方金流 |
| 平台授權 | `/dashboard/connections` | 沒這個產品不能用 |
| 觀眾斗內頁 | `/dashboard/public-page` | 收款入口 |
| OBS 輸出 | `/dashboard/obs` | 沒這個所有疊加層都是廢的 |
| 帳戶 | `/dashboard/account`（會員 4 頁併進來） | 子熙幣餘額放這裡 |

砍掉（20 條）：

```
斗內卡牌            /dashboard/donation-cards
共用斗內房間        /dashboard/shared-donation-rooms
斗內影片            /dashboard/donation-video
影片審核佇列        /dashboard/donation-video/review
斗內跑馬燈          /dashboard/donation-ticker
測試頁面            /dashboard/testing          ← 不該出現在正式選單
追隨與訂閱提醒      /dashboard/follower-alert
周邊商店            /dashboard/commerce          ← 電商是另一個產品
台聚活動            /dashboard/meetups
排行榜              /dashboard/leaderboard
金流設定            /dashboard/payment-settings  ← 改子熙幣
會員中心            /dashboard/membership
訂閱方案            /dashboard/subscription
用量與點數紀錄      /dashboard/membership/usage
付款與發票          /dashboard/membership/billing
頻道數據            /dashboard/stats             ┐ 併成一頁
同時觀看人數        /dashboard/live-viewers      │「直播數據」
即時比分板          /dashboard/scoreboard        ┘
```

**執行方式：搬到 `src/_archive/`，不是刪除。**
git 保留、選單隱藏、可還原。理由：刪掉之後要找回來得靠 git 找，
而搬走只是換個位置，diff 也看得清楚。

### 階段 B：知識庫 RAG（先跑通端到端）

**B1 — 先用現有資料跑通，不碰下載**
`CaptionSegment` 已有 52 列，直接拿來做：切塊 → NIM 嵌入 → pgvector → 檢索 top-k → 中轉生成
**目標：先確認檢索品質，再花生成錢。**

**B2 — YT / Podcast 匯入**
一次只吃一個頻道／一集，失敗要能續跑（下載 → 切塊 → whisper → 嵌入）。
下載邏輯參考 `Playlist_Administrator/core/downloader.py`（yt-dlp，已處理格式與過濾）。

**B3 — 問答入口**
檢索到了才需要生成。BYOK 與我們方案的額度在這裡分流。

### 階段 C：金流改子熙幣

砍掉第三方金流（綠界／歐付寶／PayPal）與訂閱制，只留子熙幣。
見 §9 待決事項第 2 條。

---

## 8. 風險（成本**不是**其中之一）

| # | 風險 | 說明 | 對策 |
|---|---|---|---|
| 1 | **濫用** | 1 人上傳 100 個 10 小時影片 = 我們 $40 | **每人額度**（例如首月 5 小時），超過要付子熙幣 |
| 2 | **Groq 速率限制** | 已知 `gpt-oss-20b` 是 8000 TPM。批次轉寫會撞上 | **排隊，不要同步轟**；ITPM 自適應（`STATE.itpm` 已有校準機制） |
| 3 | **YouTube ToS** ⚠️ | yt-dlp 抓取 YouTube 內容有服務條款風險，商業用途尤其 | **上線前必須想清楚，這是法律問題不是技術問題。** 建議先做「使用者自己上傳音檔」版本，YT 頻道功能等確認法律風險後再開 |
| 4 | **向量規模** | pgvector 建 HNSW 索引，1,000 萬筆以上會慢 | 一開始就定 chunk 大小與保留策略 |
| 5 | **字幕管線混淆** | 直播字幕（sherpa-onnx）與離線轉寫（whisper）混用 | §4 已分清，實作時不要共用程式碼 |

---

## 9. 待決事項（需要回覆才能繼續）

**① 斗內砍到剩哪些？**
上面列的 10 → 2 照做嗎？有沒有哪個你覺得該留？
（特別是「直播數據」我打算把 3 頁併成 1 頁，會少掉一些顆粒度）

**② 子熙幣的計價定位？**
- **A：純儲值扣點**（無月費、無方案）—— 像 zixi-earth
- **B：月費方案 + 額度** —— 像 livio 的商務 A/M/B

我傾向 **A**：月費制要處理續費、掉級、補差額，對目前的量是額外負擔；
而且鏈上扣款本來就適合按次計費。

**③ 品牌名稱？**
我需要一個名字（中文 + 英文）。目前 `livestream-dashboard` 只是專案名。

---

## 10. 驗收方式

- **改介面**：用 OBU 在 `https://zixilive.dpdns.org` 實測，不用 headless 猜
- **RAG**：端到端實跑，必須能看到「檢索到哪幾段原文」再看到生成的回答
- **成本**：每一步的實際 token 消耗記在 log，月底對帳
- **每個階段獨立 commit**，不要疊在一起 —— 出問題時才看得出是哪一階段壞的

---

## 11. 已經完成的事

```
✅ 2026-10-14  Neon 啟用 pgvector 0.8.6 並實測通過
✅ 2026-10-14  刪除 temp_*.js × 14（1.4 MB，別家編譯碼）
✅ 2026-10-14  確認 LiveCore 是獨立 repo，不在任何我們的專案底下
✅ 2026-10-14  確認 36 頁面 / 31 選單 / 1 個孤兒（giveaways）
✅ 2026-10-14  實測 Neon 容量與現有資料量
✅ 2026-10-14  階段 A 完成：選單 31 → 15 條，17 條路由封存，部署到
                zixilive.dpdns.org（commit 51948a2）
```

### 階段 A 驗收結果（線上實測）

| 項目 | 結果 |
|---|---|
| `tsc --noEmit` | 0 錯誤 |
| `next build` | exit 0 |
| 已封存 17 條路由 | **全部 HTTP 404**（`text/html` 11.7 KB，Next 的 404 頁） |
| 保留 16 條路由 | **全部 HTTP 200** |
| 編譯後 bundle | 4 個新分組全在、14 個新標籤 14/14 命中、**舊標籤殘留 0** |
| OBS 端點 `/overlay/*` | **11/11 活著**（假 token 回 `text/plain` 9 bytes，與 Next 的 404 是不同來源） |
| `/api/v1/user` | 401（API 完全沒動） |

### 部署的坑：OpenNext 在 Windows 上崩

```
npm run cf:build → exit 0xC0000409 (STATUS_STACK_BUFFER_OVERRUN)
```

OpenNext 1.20.8 自己就印 `WARN OpenNext is not fully compatible with Windows`，
重跑兩次都一樣崩在同一個位置（印完版本資訊就掛）。

**解法：走 WSL**（OpenNext 官方建議）。已建立可重用的流程：

```bash
# WSL Ubuntu 已裝 Node 24.21.0（nvm）
# 專案複製到 WSL 檔案系統（/mnt/c 跑 npm 太慢）
tar -C "$SRC" -cf - --exclude=node_modules --exclude=.next \
    --exclude=.open-next --exclude=.git . | tar -C "$DST" -xf -

# wrangler OAuth 認證要手動搬過去（WSL 沒有 Windows 的 xdg 路徑）
cp /mnt/c/Users/CPXru/AppData/Roaming/xdg.config/.wrangler/config/default.toml \
   ~/.wrangler/config/default.toml && chmod 600 ~/.wrangler/config/default.toml

cd ~/build/livestream-dashboard && npm install && npm run cf:build && npx wrangler deploy
```

WSL 在 `~/build/livestream-dashboard`（795 GB 可用）。

### ⚠️ 登入后才能验的东西，我没能验

**線上是 OAuth-only（Twitch / Google 登入），我沒有那些帳號。**
所以以下**只驗到路由層與編譯產物，沒有用眼睛看到渲染結果**：

- 側邊選單在瀏覽器裡實際長什麼樣
- 抽獎頁面接進選單後點得進去嗎
- 首頁那 12 張卡片的排版

驗收方式（部署後用 OBU）：

```
1. 用你的 Twitch/Google 登入 https://zixilive.dpdns.org/dashboard
2. 對照：選單應該只有 4 組、15 條
3. 點「抽獎活動」—— 以前根本沒有入口
4. 點「即時字幕」—— 圖示應該跟「聊天室」不一樣
```

---

## 12. 新發現：品牌已經存在

**站名早就是「StreamFlow 創作者控制中心」**，登入頁還寫著
「免費開源的直播工具平台」「MIT」。專案裡也有 `STREAMFLOW_ARCHITECTURE.md`、
`STREAMFLOW_TECH_PLAN.md`。

所以 §9 待決事項第 3 條要改成一個真正的選擇：

- **沿用 StreamFlow**（有 logo「SF」、有架構文件、登入頁已寫好）
- 換新名字（那要一起改 logo、標題、架構文件檔名）