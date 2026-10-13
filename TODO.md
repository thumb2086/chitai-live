# 熾台 剩餘工作計畫

> 最後更新：2026-10-03

---

## ✅ 本輪完成：設計系統對齊 + Overlay 全線可用

### A. 設計系統（已 1:1）

來源：`https://livio.tw/_next/static/css/*.css` 共 8 檔 → 824KB / 4757 條規則，
scope 為 `body[data-livecore-entry=dashboard]`。實際是一套 **1751 個 class** 的語意化系統。

> **重要更正**：早先的「設計重刷」是錯的 —— 那時 livio session 已過期，只能量到空殼，
> 於是我自創 token 並把強調色猜成藍色 `#0040ff`。**實際強調色是翡翠綠 `#059669`**。

已核對一致的實測值：

| 元素 | livio.tw | 本專案 |
|---|---|---|
| Header | `72px`、`rgba(255,255,255,.94)`、底線 `rgba(15,23,42,.08)` | ✅ |
| 側邊欄 | `276px`、`padding 22px 16px`、漸層 `#101722→#0d141f` + 藍光暈 | ✅ |
| 導覽 | `16px/400`、`radius 10px`、`h42px`、未選 `rgba(255,255,255,.68)` | ✅ |
| 導覽選中 | `#232c3a` + 白字 | ✅ |
| 帳號卡 | `#182232` / border `#40546c` / `radius 16px` | ✅ |
| 主區 padding | `42px` | ✅ |
| 開關 | pill `44×24`、checked 為強調綠 | ✅ |
| 卡片 | `radius 16px`、`rgba(255,255,255,.96)`、`0 16px 42px` 陰影 | ✅ |

### B. 三個真正的坑

1. **PowerShell 會毀掉 CSS。** `Get-Content -Raw | -replace | Set-Content` 把
   `content:"▾"` 變成 `content:"??"`，大括號失衡、**1777 條規則整個消失**。
   PowerShell 5.1 的 `-Encoding UTF8` 還會寫 BOM，讓 `<link>` 樣式表載入失敗。
   → 一律用 Node 的 `fs.writeFileSync(..., { encoding: "utf8" })`。

2. **React 19 會把 `<link rel="stylesheet">` 改寫成 `rel="preload"`**，樣式表永遠不生效。
   → 必須加 `precedence` 屬性。

3. **瀏覽器會靜默截斷大型樣式表。** 單一 800KB 只載入前 ~850 條規則，之後全部丟棄且不報錯。
   → 切成 8 份、每份約 110KB、保持原始順序（cascade 不變）。

### C. Overlay 全線打通（11 個端點全部 PASS）

集中定義於 `src/lib/overlays.ts`，設定頁、OBS 輸出頁、token API 共用同一份。

```
/overlay/chat/[token]              /overlay/live-viewers/[token]
/overlay/subtitles/[token]         /overlay/scoreboard/[token]
/overlay/donations/[token]         /overlay/follower-alert/[token]
/overlay/alerts/[token]            /overlay/donation-ticker/[token]
/overlay/stats/[token]             /overlay/donation-cards/[token]
                                   /overlay/donation-video/[token]
```

新增基礎設施：
- `src/lib/overlay-render.ts` — token 解析 + OBS HTML shell + 輪詢
- `src/app/api/v1/overlay-data/[key]/route.ts` — overlay 的 JSON 輪詢來源
- `src/components/overlay-settings.tsx` — livio 的 `overlay-settings-*` 頁面外殼
- `src/app/api/webhooks/twitch/route.ts` — Twitch EventSub（追隨/訂閱/贈閱/raid）
- `EventLog` model（platform+kind+externalId 唯一，Twitch 重送自動去重）
- `scripts/enable-overlays.mjs` — 一次啟用全部 overlay 並列出網址

`OBSSource.sourceKey` 已從舊命名（`subtitles`/`donations`/`alerts`/`stats`）
統一為目錄命名（`captions`/`donation-goal`/`donation-alert`/`channel-stats`）。

### D. 控制中心

`/dashboard` 重建為 `歡迎回來` 首頁：4 步快速開始 + 12 個模組總覽，
狀態全部讀真實資料（平台串接、overlay 啟用狀態、斗內目標數、指令數）。

### E. 頁面

31 條導覽連結全部 200，`tsc --noEmit` 零錯誤。

### F. 即時字幕：Groq 低延遲管線（本輪新增）

字幕不再只是 Browser STT，雲端轉寫走**自有的 groq-router**
（`https://vercel-router-khaki.vercel.app`，池內 ~30 把金鑰、輪替 + 冷卻 + 計點）。

新增檔案：
- `src/lib/captions-groq.ts` — WAV 封裝、RMS 靜音閘門、幻覺黑名單、router 呼叫
- `src/app/api/v1/captions/transcribe/route.ts` — 收 raw PCM（二進位）→ 回 segments
- `src/lib/captions-live.ts` — 瀏覽器採音（AudioWorklet，ScriptProcessor fallback）、滑動視窗
- `src/lib/caption-merge.ts` — 重疊視窗的文字合併去重
- `src/app/api/v1/subtitles/route.ts` — **原本整個路由不存在**，`/api/v1/subtitles` 一直 404
- `scripts/bench-groq.mjs` / `probe-segments.mjs` / `probe-words.mjs` / `test-captions*.mjs`

**實測延遲**（12 秒中文語音，9 個視窗）：上游平均 **1719ms**（1331–2286ms），
感知延遲 ≈ 步進 1200ms + 上游 1719ms ≈ **2.9 秒**。冷啟動多約 1100ms。

**三個關鍵發現（都靠實測，不是猜的）**：

1. **Groq 不支援 `condition_on_previous_text`**，帶了會 400。
   Groq 本來就每個請求獨立，無從設定；防重複改用 `temperature=0` + 幻覺黑名單。
2. **Groq 只回 segment 時間戳，不回 word**（`timestamp_granularities[]=word` 回 0 段）。
   而且一個 segment 通常橫跨整個視窗 → 任何「用時間游標去重」的做法都會重複印字或整段吞掉。
   唯一可行的是**在文字層合併**（`mergeCaption` 取最長公共前後綴裁掉）。
   真實資料驗證：naive 串接 86 字 → 合併後 70 字，重複消除。
3. **Whisper 會在非語音上自信幻覺**（純音調就吐出「优优独播剧场」）。
   已加靜音閘門（rms < 0.006 直接跳過，不花請求）+ 幻覺黑名單 + `no_speech_prob`。

**殘餘限制**：視窗邊界處 Whisper 仍會誤聽（實測把「即時顯示」聽成「解釋」，
下一個視窗才修正）。這是 ASR 本身的問題，不是合併邏輯的問題，已在 UI 提供
「最低延遲 / 平衡 / 穩定優先」三個檔位讓使用者自行取捨。

### G. 供應商鏈：Groq 直連為主、router 為備援

使用者反應延遲太高。量測後確認**大頭是固定開銷，不是推論**：

| 測量 | 結果 |
|---|---|
| 未授權請求 → `api.groq.com` | 224–349ms |
| 未授權請求 → router（Vercel） | 561–584ms（冷啟 1395ms） |
| 1.0s 音訊轉寫 | 1224ms |
| 2.0s | 1326ms |
| 3.0s | 1788ms |
| 5.0s | 2280ms |

最小平方擬合 `total = fixed + perSec × audioMs`：
**固定開銷 ≈ 1350ms，每多一秒音訊只多 ≈ 260ms** → 2.4 秒視窗的請求裡
**78% 是固定開銷、22% 才是推論**。我們自己的 Next 路由只佔 17ms，不是瓶頸。

因此改成雙供應商鏈（`src/lib/captions-groq.ts`）：

```
GROQ_API_KEY      → direct  → https://api.groq.com/openai/v1   （最快，少一跳）
GROQ_ROUTER_*     → router  → 自有 groq-router                （慢，但輪替 30 把金鑰）
GROQ_DIRECT_FIRST → 優先順序（預設 true）
```

- 直連省掉的不只是 Vercel 那一跳，還有 router 的 KV 取金鑰、multipart 重組、serverless invoke。
- **router 永遠保留為備援**：直連金鑰失效或直播中被 rate limit 時，降級成慢一點而不是字幕全黑。
- 只在**可重試**的錯誤（網路失敗 / 408 / 429 / 5xx）才切換。
  401 不切換 —— 請求本身錯了，換誰都會被拒，浪費一次請求。
- 供應商清單可注入（`transcribePcm(pcm, opts, providers)`），所以測試不需要 stub 網路。

`scripts/test-provider-failover.ts` 對真實端點驗證（7/7 PASS）：

| 情境 | 結果 |
|---|---|
| 只有 router | router，1 次嘗試，1746ms |
| direct 連不到（127.0.0.1:9） | 切到 router，2 次嘗試，回報 `fellBackFrom: direct` |
| direct 401（假金鑰） | 立刻回報 401，**不**多打一次 router |

> 兩個自己犯又抓到的 bug：
> 1. `isRetryable(0)` 回 false → 網路錯誤被當成不可重試，直接丟出不切換。
> 2. Router base URL 少了 `/v1`（`vercel.json` rewrite 有對映到 `/v1/*`）→ 404。
>    現在 `routerUrl()` 會在缺少時自動補 `/v1`。

**還沒能驗到的**：直連的真實延遲。`gsk_` 金鑰只存在 Vercel KV，
`vercel env pull` 對 `GROQ_KEYS` 寫 `[SENSITIVE]`，admin API 也只回傳數量
（`keys: (c.keys || []).length`），磁碟上沒有。
→ 貼一把 `gsk_` 進 `.env.local` 即生效，不需改任何程式碼。

### I. 同時觀看人數：接真實 API（已取代假數字）

原本 `overlay-data/live-viewers` 在拿不到資料時會 **fallback 到 `user.totalViews`** ——
那是**累計觀看人數**，不是同時在線人數。直播時顯示一個會單調成長的累計值當「同時觀看人數」，
是錯的數字掛上對的名字。

新增：
- `prisma/schema.prisma` — `PlatformConnection` 加 `liveViewers Int?` + `liveUpdatedAt DateTime?`
- `src/lib/platform-live.ts` — 真實觀看人數 + **access token 自動續期**
- `src/app/api/v1/live-viewers/route.ts` — 設定頁可主動查，並回報 token 是否過期

實作重點：

1. **Twitch Helix `GET /helix/streams`** — 空陣列代表「確認離線」，所以回 `0` 而不是 `null`。
   「離線」與「查不到」是兩件事，程式用 `viewers: number | null` 區分，overlay 收到
   `known: false` 就顯示 `--`，不會顯示 0 冒充「沒人看」。
2. **YouTube 回 `null`** — YouTube 沒有公開的同時觀看人數 API。
   把 `statistics.viewCount`（累計）塞進這個欄位會是另一個數字掛同一個標籤，所以寧可回報不知道。
3. **Token 續期** — `refreshToken` / `tokenExpiresAt` 欄位一直存在但**從沒有人用過**，
   token 一過期整條平台鏈靜默失效。現在到期前 60 秒自動換新並寫回。

驗證 `npx tsx scripts/test-live-viewers.ts`（8/8 PASS）：

| 情境 | 結果 |
|---|---|
| 沒有任何平台連線 | 200，`known:false`、`viewers:null` |
| 已連線但 token 被拒 | 200，`known:false`，不爆、不卡（1606ms） |
| overlay payload | `known:false` + `knownLabel:"--"`，無捏造數字 |
| 確認離線的頻道 | 存成 `0`（與「未知」語意不同） |

> **這次學到的教訓**：我先前兩次用「讀程式碼推測」下結論都錯了 ——
> 一次說 `overlay-data` 的 stub 讓 overlay 沒內容（其實沒人用它），
> 一次說 6 個 overlay 是 STATIC 不更新（其實它們用 `overlayShell` 輪詢，我漏了）。
> 以後一律用行為測試確認，不用 grep 猜。

### J. 金流：關掉自我升級漏洞 + 簽章與金鑰就緒

參考來源是 LiveCore，不是猜的。先前的判斷「卡在 ECPay 商店代號」**不完整** ——
LiveCore 同時支援 **ECPay（綠界）、OPay（歐付寶）、PayPal** 三家，
而且最關鍵的簽章演算法已經寫好了。

**1. 關掉一個正在生效的漏洞（最高優先）**

`POST /api/v1/membership` 的 `payInvoice` 原本會把任何 pending 帳單標成已付款，
並把方案從 `pending` 改成 `active`。等於**任何人 POST 自己的帳單 id 就能升級**。
→ 現在回 `501`，明說「帳單只能由金流閘道結算」。驗證：嘗試後帳單仍是 `pending`。

**2. 簽章（不可能靠猜的那一段）**

`src/lib/payment-providers.ts` — `computeCheckMacValue` 移植自 LiveCore。
關鍵在於 ECPay 沿用 **.NET `HttpUtility.UrlEncode` 的字元表**而非 RFC 3986，
所以 `~` 和 `'` 要額外處理；算錯的話不是全拒就是全收。
另外把字串比較改成**定時安全**比較（簽章檢查是典型的 timing oracle 目標）。

`npx tsx scripts/test-payments.ts` 26/26 PASS，其中涵蓋：
參數順序無關、**竄改金額/商號/訂單號/加欄位/刪欄位全部拒絕**、
換 HashKey/HashIV/對調都拒絕、CJK 與 `'` `~` 內容可驗證。

**3. 金鑰加密存檔**

`src/lib/secret-crypto.ts` — AES-256-GCM，格式與 LiveCore 相同
（`v1:iv:tag:payload`，base64url），同一把金鑰可在兩個專案間搬移。
`decryptSecretIfEncrypted` 讓**明文舊值照常運作**，不必停機遷移。
環境變數 `PAYMENT_ENCRYPTION_KEY`（也接受 LiveCore 的 `TOKEN_ENCRYPTION_KEY`）。

**4. 補上缺漏的 HashIV**

`PaymentSetting` 原本只有 `ecpayHashKey` / `opayHashKey`，**沒有 HashIV** ——
而 CheckMacValue 兩者都要。沒有它就連簽章都算不出來。已補 `ecpayHashIv` / `opayHashIv`。

`npx tsx scripts/test-payment-gate.ts` 15/15 PASS：無法自我付款、金鑰在 DB 是密文、
密文不含原文、GET 不外洩任何密鑰或密文、欄位省略時保留原值、其他欄位照常更新。

**還沒做**：checkout 跳轉（產生金流表單）、webhook 驗證後發放權限。
LiveCore 的 `payment-webhook-routes.ts` 有 499 行可參考，
`subscription-routes.ts` 1479 行、`subscription-usage.ts` 891 行 —— 那是完整產品規模，
需要單獨排時間，**不該假裝已完成**。

### K. 補完三個假功能

#### K1. EventSub 自動訂閱（原本事件永遠收不到）

Webhook 一直存在，但**沒有任何程式去註冊訂閱** —— Twitch 只送你有訂閱的事件。
新增 `src/lib/twitch-eventsub.ts` + `POST /api/v1/eventsub`，一次註冊
`channel.follow` / `channel.subscribe` / `channel.subscription.gift` / `channel.cheer` / `channel.raid`。

順手修掉 webhook 的**兩個真 bug**：

1. **fail-open 漏洞**：原本寫 `if (secret) { 驗簽 }` ——
   沒設 `TWITCH_EVENTSUB_SECRET` 時**整段驗簽被跳過**，任何人 POST 假 raid
   就會出現在直播畫面上。→ 現在沒設就回 503。
2. **訂閱網址缺 query**：handler 要求 `?user=<username>` 才找得到創作者，
   但註冊時組的 callback 沒有帶 → 每個事件都會 400。→ 已帶上。
3. 另外加了**時間窗**（10 分鐘）擋重放。

`npx tsx scripts/test-eventsub-webhook.ts` 8/8：
正確簽名接受、簽後改 body 拒絕、換 secret 拒絕、無簽名拒絕、
過期重放拒絕、**且 DB 只留下那筆合法事件**。

#### K2. Google Sheet 比分板（原本只有輸入框）

`src/lib/google-sheets.ts` — 走公開 CSV 匯出（`gviz/tq?tqx=out:csv`），
**不需要 API key、不計費**，試算表只要設成「知道連結的人可檢視」。
含 RFC 4180 CSV 解析、網址取 sheet id、橫列自動轉置（配合 `E71:G71` 這種欄位式範圍）、
非 CSV 回應（多半是登入頁）的辨識。讀不到時**保留上一次的手動名單**並回報 `sheetError`，
不會把比分板清空。

#### K3. 回放分析（原本 `advance` 是憑空捏資料）

舊 `advance`：進度 +20，然後生出 3 段假內容與假分數（`90 - i * 15` 這種）。
現在是真的管線（`src/lib/replay-analysis.ts` + `replay-job.ts`）：

- 下載 → ffmpeg 轉 16kHz mono PCM → 用 Groq whisper 真實轉寫 → 關鍵詞/結構評分
- 每次呼叫做**定量**工作並存檔，長影片可跨多次請求處理，不佔住 HTTP handler
- 解碼後音訊快取（上限 2 份，避免長影片吃光記憶體）
- **SSRF 防護**：拒絕 localhost / 內網 / `169.254.169.254` / `.internal` / `file://`，
  連重導向後的目標也重驗
- 評分是**透明啟發式**（關鍵詞密度、問號、數字、重複標點），
  程式註解明說這**不是**觀眾留存指標，避免被當成真實分析數據

`npx tsx scripts/test-replay.ts` 20/20：
9 種內部網址全拒、2 種外部允許、`file://` 拒絕、
開場白 hook 分數 87 vs 安靜段 25、高潮詞 peak 98 vs 20、
**來源不可達時 job 標記 failed 且 0 段寫入**（舊版這裡會寫 3 筆假資料）。

### H. 順手修掉的三個真 bug
這三個都是「HTTP 200 看起來沒事」但功能其實是壞的：

1. **`/api/v1/subtitles` 路由整個不存在。**
   `api.getSubtitles()` 一直吃到 404，字幕頁永遠卡在錯誤畫面。
   → 新增 `src/app/api/v1/subtitles/route.ts`（GET/PUT，欄位白名單）。
2. **`SubtitleConfig` 沒有列時被當成「字幕關閉」。**
   從沒開過設定頁的創作者，會拿到 stream `403 Disabled` + segments 永遠空 → 直播畫面一片黑。
   → 新增 `src/lib/subtitle-config.ts`：`getSubtitleSettings()` 缺列時回傳預設值
   （`enabled: true`），`ensureSubtitleConfig()` 在首次載入時把列建出來。
   `segments` / `stream` / overlay 三處都改用它。
3. **SSE hub 用了模組層級 `Map`，廣播會無聲消失。**
   Route handler 每次請求可能落在不同模組執行個體，POST 端寫進的 registry
   和 GET 端讀的不是同一份 → 字幕只能靠 10 秒輪詢慢慢出現。
   → `caption-sse.ts` 改把 registry 掛在 `globalThis` 上。
   驗證：`node scripts/check-caption-pipeline.mjs` 四項全 PASS
   （SSE 開通、輪詢拿到、SSE 廣播到達、overlay HTML 正確訂閱）。

> 順帶釐清：字幕 overlay **不走** `/api/v1/overlay-data/captions`，
> 它直接讀 `/api/v1/captions/segments`（輪詢）與 `/api/v1/captions/stream`（SSE）。
> `overlay-data` 目前對 `captions` / `chat` / `donation-goal` / `donation-alert` /
> `channel-stats` 都還是 `default` 分支的 stub —— 這些 overlay 若沒有自己的資料源，
> 就是只有外殼沒有內容。

---

## 🔄 待處理

### P0 — 會員付款是假的

`changePlan` 把付費方案設為 `pending` 並開立待付帳單，`payInvoice` 只把帳單標記為已付款。
**沒有接綠界/ECPay recurring checkout，正式環境任何人升級都是免費。**
→ 需要 ECPay 商店代號 + Hash Key + recurring 設定，才能實作。

### P1 — 頁面內部還沒有 1:1

**目前實測基準**（`npx tsx scripts/test-page-families.ts`，掃描 11 個有對應家族的頁面）：

| 頁面 | livio 家族 | Tailwind | 自有 class | 驗證方式 |
|---|---|---|---|---|
| `頻道數據` | `.channel-stats-settings-*` | **0** | **9/10** | 源碼掃描可直接驗證 |
| `聊天室` | `.chat-settings-*` | **0** | 8/22 + 外殼 | CSS 載入已驗證 |
| `即時字幕` | `.captions-settings-*` | **0** | 外殼 `family` | CSS 載入已驗證 |
| `即時比分板` | `.overlay-settings-*` | **0** | 外殼（預設家族） | CSS 載入已驗證 |
| `同時觀看人數` | `.overlay-settings-*` | **0** | 外殼（預設家族） | CSS 載入已驗證 |
| `追隨與訂閱提醒` | `.overlay-settings-*` | **0** | 外殼（預設家族） | CSS 載入已驗證 |
| `斗內進度條` | `.donation-goal-*` | **0** | 22/40 | CSS 載入已驗證 |
| `回放分析` | `.replay-analysis-*` | **0** | 30/33 | CSS 載入已驗證 |
| `周邊商店` | `.commerce-admin-*` | **0** | 26/31 | CSS 載入已驗證（審計誤報 1 Tailwind，實為識別字比對） |
| `會員中心` | `.member-*` | **0** | 24/31 | CSS 載入已驗證 |
| `訂閱方案` | `.subscription-*` | **0** | 28/37 | CSS 載入已驗證 |

**11 頁全部 Tailwind 歸零。**

> ⚠️ **這 11 頁不等於「全部頁面」。** 這裡的 11 是「有對應 livio CSS 家族」的頁面。
> `/dashboard` 底下實際有 **32 個 page.tsx，其中 20 個仍是 Tailwind**：
> testing、public-page、zixi、connections、donations/alerts、meetups、shared-donation-rooms、
> donation-cards、commands、donation-video、obs、zixi/donations、donation-video/review、
> account、donation-ticker、payment-settings、donations/records、leaderboard、
> membership/usage、membership/billing。
> 這些頁在 livio CSS 裡沒有對應家族可抄，是**另一種工作**（得自己設計或沿用共用 primitive），
> 不要因為上面寫「歸零」就以為全站清乾淨了。

> **審計工具的限制**：`scripts/test-page-families.ts` 掃描「頁面自己寫的 class」。
> 用共用外殼的頁面，版面 class 是執行時由 `family` 參數產生的，掃描看不到 ——
> 所以那幾頁的 `own/css` 偏低**不代表未遷移**。它的可靠用途只有兩個：
> 確認 Tailwind 歸零、確認家族 class 存在於樣式表。視覺 1:1 仍需實際渲染比對。

### 驗證工具（全部可重跑）

| 指令 | 檢查什麼 | 現況 |
|---|---|---|
| `npx tsc --noEmit` | 型別 | 0 errors |
| `npm run build` | production build + 全部 86 條 route | 通過 |
| `npx tsx scripts/check-links.ts` | 每個內部 `href` 是否真的對應到一條 route | ALL LINKS RESOLVE |
| `node scripts/check-css-loaded.mjs /dashboard/<page>` | 樣式表真的載入 + 該家族規則存在 | 5 頁 ALL CHECKS PASSED |
| `npx tsx scripts/test-page-families.ts` | Tailwind 歸零、家族 class 覆蓋 | 11/11 歸零（**判定欄位有誤報，見下**） |
| `npx tsx scripts/test-plan-entitlement.ts` | 未付費方案不得取得額度 | PASS |
| `npx tsx scripts/test-payment-gate.ts` | 金流閘道不得自我升級 | PASS |
| `npx tsx scripts/test-eventsub-webhook.ts` | EventSub 驗簽 fail-closed | PASS |
| `npx tsx scripts/test-replay.ts` | 回放管線 + SSRF 防護 | PASS |
| `npx tsx scripts/test-live-viewers.ts` | 同時觀看人數誠實回報 | PASS |
| `node scripts/test-captions.mjs` / `test-caption-merge.ts` / `check-caption-pipeline.mjs` | 字幕管線與去重 | PASS |
| `node scripts/enable-overlays.mjs` | 22 個 overlay 端點 | 0 FAIL |

> `check-links.ts` 是補 `check-css-loaded` 之後寫的：build 只會列出真實 route，
> **不會**告訴你手寫的 `href` 有沒有打錯 —— 錯了要等使用者點下去才變 404。
> 它寫的當天就抓到一個我自己剛做出來的死鏈（`/dashboard/settings` 不存在，
> 正確是 `/dashboard/account`）。加頁面時順手跑一次。

### `channel-stats-settings` 家族的差異（為什麼它不用共用外殼）

命名**不機械化**：有 `.channel-stats-editor-header`（沒有 `-settings`）、
`.channel-stats-preview-*`、`.channel-stats-card-heading`、`.channel-stats-platform-*`，
而且**沒有 tab strip**。若硬套 `family="channel-stats-settings"` 會產出
`.channel-stats-settings-editor-header` 這種樣式表裡不存在的名稱。
→ 這一頁直接照 CSS 寫結構。

### 遷移時一併修掉的假資料

| 頁面 | 原本的假 |
|---|---|
| `同時觀看人數` | `useState(1284)` 寫死人數、隨機加減的「模擬一次人數變動」按鈕、`/overlay/live-viewers/[token]` 字面網址、頁面標示「目前模擬人數」 |
| `追隨與訂閱提醒` | `/overlay/follower-alert/[token]` 字面網址；完全沒接 EventSub 訂閱狀態 |
| `頻道數據` | 兩個平台都直接顯示 `0`，無法區分「真的 0 粉」與「沒串接／權限不足被拒」 |

`同時觀看人數` 現在接 `/api/v1/live-viewers`（Twitch Helix 實際值），
並新增 `knownLabel` 設定：拿不到數據時顯示 `--` 而非 `0`，
因為 0 代表「確認離線」，兩者語意不同。

`追隨與訂閱提醒` 現在讀 `/api/v1/eventsub` 顯示真實註冊狀態，
並提供「註冊事件訂閱」按鈕 —— 沒有訂閱的話這個疊加層永遠不會亮，
這是先前頁面完全沒有呈現的前提。

### ⚠️ 遷移時最容易踩的坑

CSS 選擇器**很多是巢狀在某個 page 家族底下**的，不是全域：

| class | 狀況 |
|---|---|
| `.settings-note`、`.stack`、`.source-status-*` | 全域（`[data-livecore-entry]` 下） |
| `.form-grid`、`.field` | 有在 `.overlay-settings-page` 底下定義，可��� |
| `.chat-settings-choices`、`.chat-settings-choice` | **只**在 `.chat-settings-page` 底下 |

我在 `同時觀看人數` 一開始誤用了 `.chat-settings-choice`，
在 `overlay-settings-page` 下完全不會有樣式 —— 已改成 `.form-grid` + `.field`。
**動手前務必用 `scripts/check-css-loaded.mjs` 與 family 規則確認選擇器作用域。**

**驗證 1:1 是否真的生效**（`node scripts/check-css-loaded.mjs /dashboard/chat`）：
- 8 個 CSS chunk 全部載入（共 11 個 link，含字型）
- `data-livecore-entry="dashboard"` scope 存在
- `.chat-settings` 規則在 `dashboard.06.css`（143 處），且該檔確實被送出

### 剩下 5 頁的實際範圍（已量測 class 清單）

| 頁面 | 家族 | class 數 | 額外發現 |
|---|---|---|---|
| `會員中心` | `.member-*` + 重用 `.subscription-*` | 31 + 37 | **不只是改 class 名稱** |
| `訂閱方案` | `.subscription-*` | 37 | 含方案比較表 |
| `斗內進度條` | `.donation-goal-*` | 40 | |
| `周邊商店` | `.commerce-admin-*` | 31 | |
| `回放分析` | `.replay-analysis-*` | 33 | |

`會員中心` 的 `.member-*` 家族包含 livio 有、我們**完全沒有**的功能面：
`member-points-ribbon`（點數橫幅）、`member-ai-rates`（AI 點數費率表）、
`member-balance` / `member-balance-grid`（錢包餘額）、`member-account-menu`（帳號選單）、
`member-subnav`（子導覽）、`member-table-scroll`（用量明細表）、
`member-shared-features`、`member-side-cards`。
它同時重用 `.subscription-plan-card` / `.subscription-tabs` / `.subscription-tab`
（CSS 裡存在 `member-page .subscription-plan-card.is-featured` 這種跨家族選擇器）。

### `會員中心` / `訂閱方案` 的功能面處置結果（已完成）

`會員中心`（24/31）與 `訂閱方案`（28/37）都已遷移。過程中確認的取捨：

**補上的真功能**
- `member-account*` 帳號選單 → 需要身分，membership API 新增 `account: { name, username, email, avatar }`（read-only select，email 不可由前端寫入）
- `member-table*` + `member-ai-rates` → 用 `usage` 事件（API 一直有回，頁面從沒用）建逐筆用量明細表
- `member-subnav`、`member-side-cards`、`member-notice`、`member-expiry` → 全部對應既有真資料
- `subscription-compare-*` 完整比較表 → 直接讀 `PLANS` + `QUOTAS`（與伺服器計算額度同一份常數）。欄位數 4 剛好對應 `PLANS` 長度

**拒絕做的 class（會是假 UI）**
- `member-balance`（錢包餘額）—— 無金流，使用者已明確放棄，數字永遠不會動
- `member-points-ribbon` / `member-point-split` / `member-plan-points` —— 點數系統不存在
- `subscription-addon-*`（5 個）—— 同上，沒有 addon 產品

**跨家族重用未採用**：CSS 裡有 `member-page .subscription-plan-card.is-featured` 這類選擇器，
但把 `.subscription-*` 塞進會員中心會讓兩頁的卡片樣式互相污染，沒必要。

### 其餘頁面的作法已經機械化

每頁依序做
1. 從 `public/css/dashboard.*.css` 撈出該家族的規則（注意 CSS 選擇器是
   `[data-livecore-entry=dashboard] .<family>-<part>`，且很多規則巢狀在 `.chat-settings-page` 底下）
2. 改用 `<OverlaySettingsPage family="<family>">` + `<OverlayPreview/OverlayEditor family>`
   + `<SettingsTabs/SettingsTabPanel/SettingsCard family>`
3. 頁面自有的卡片內容用該家族的 class（如 `.chat-settings-info`、`.field`、`.setting-switch-*`）
4. 拿掉 Tailwind arbitrary utilities
5. `npx tsx scripts/test-page-families.ts` 的 `own/css` 上升且 `tailwind` 歸零

> **注意**：各家族的強調色不同。聊天室是 `--chat-accent:#079455`，
> 不是全站用的 `#059669`。照抄 CSS 變數值，不要沿用統一 token。

### P1 — 功能仍是模擬的

- ~~**同時觀看人數**~~ ✅ 已完成（見 I 節）
- **追隨與訂閱提醒**：EventSub webhook 已可收事件，但沒有「自動訂閱 EventSub」的流程，
  需要用 Twitch access token 呼叫 `/eventsub/subscriptions` 建立訂閱。**未做。**
- ~~**回放分析**~~ ✅ 已完成（見 K3 節）—— 但注意 `advance` **不是預覽**，它會真的下載/解碼/呼叫字幕供應商。
- ~~**Google Sheet 比分板**~~ ✅ 已完成（見 K5 節）。

### P0 — 需要外部憑證才能完成

- **會員付款**：需要 ECPay/綠界 商店代號 + Hash Key + recurring 設定。
  程式端流程已通，但正式環境仍是 `payInvoice` 直接標記已付款（任何人升級都免費）。

### P0 — 配額系統沒有生產者（實測確認）

**`usageEvent` 全專案只有兩處被碰到：`findMany`（讀）和 `recordUsage` action 裡的 `create`（寫，
而那個 action 是客戶端直接呼叫的）。沒有任何程式在真實工作發生時記錄用量。**

實測（`--env-file=.env` 連 Neon）：

```
usageEvent rows   : 0
   (empty -- nothing has ever recorded usage)
subscription rows : 1
   - pro / pending
```

後果：
- `quotas[].used` 永遠是 0 → `會員中心` 與 `用量與點數紀錄` 的配額條永遠 0%、永遠不會超額
- 「近 30 天 X」趨勢永遠是 0
- 也就是說**配額顯示與（若有）配額執行都是裝飾性的**，量不到任何東西

要補的是「生產者」：字幕轉錄完成時記 `caption_minutes`、回放分析推進時記 `replay_minutes`、
建立疊加層時記 `overlay`。這三個地方都有明確的完成時點。

順帶：DB 裡那筆 `pro / pending` 證明 `effectivePlan()` 防的是真實存在的狀態，不是假想。

`recordUsage` 現在沒有任何前端呼叫者（原本唯一的呼叫者就是被移除的「加一筆測試用量」按鈕）。
**別讓它繼續開著**：它是客戶端可呼叫的寫入端點，等於讓人自己往帳務紀錄塞任意數字。
要嘛接到真實的計量路徑上（由伺服器端呼叫，不是接受客戶端傳來的 metric/quantity），
要嘛整個拿掉。

### P2 — 品質

- ~~⚠️ 部署前必須手動驗證：字幕 HTTP 轉錄路徑~~ ✅ **已實測通過**
  `scripts/test-caption-metering-e2e.ts` 會在真實 DB 建一個拋棄式 user+session，
  打真的 HTTP 端點，確認「靜音跳過 / 帶 cookie 轉錄 / 計量寫入 / 無 session 拒絕」
  四件事，最後清掉。需 `npm run build && npx next start -p 3000` 在跑。
  - 靜音視窗 → 200 skipped（在 auth 之前，16ms，不碰 DB）
  - 帶 session + 440Hz 音調 → 200，`provider: direct`
  - **無 session + 真實音訊 → 401**，而且其他所有 API 匿名呼叫本來就都是 401
    （user / obs / subtitles / donations / stats / captions/segments），
    所以 transcribe 原本是唯一的破口，補上是**與其餘 API 一致**，不是新限制。
  - 實測延遲：cold wall ~1.7s / warm wall ~1.3s（upstream ~290–400ms），
    剩餘是 Neon 往返，見下面計量模組的說明

### 計量模組的三個已修坑（`src/lib/usage.ts`）

1. **`quantity` 必須是 Float。** 原本是 `Int`，而字幕視窗約 1 秒 = 1/60 分鐘，
   `Math.round(0.0167) = 0` → `if (!qty) return` → **每個短視窗的計量都被靜默丟棄**，
   `used` 永遠 0（就是我原本要修的那個病）。往上取整更糟：滑動 2.4s 視窗跑 3 小時
   會算成 4500 分鐘 = **75 小時額度**，60 倍超收。已改成 Float 並 `prisma db push`。
2. **不可快取 entitlement。** 我第一版把整個 `QuotaCheck` 用 `userId:metric` 快取，
   結果訂閱從 pending 轉 active 之後仍發放 free 上限長達 TTL —— 那是**被快取授權**。
   付款結清是在模組外發生的，所以現在 subscription 每次即時讀，只快取用量加總。
3. **快取缺少基準時不可猜。** `recordUsage` 原本在無快取項時用 `CACHE.set(used=qty)`，
   等於假設週期總量是 0，實測讓 `used` 從 0 跳成 100003.4。現在只在有項時累加。
4. `getOrCreateUser` 原本是兩次循序查詢（session→user），改成 `include: { user }` 一次。

### 待決策：字幕計量對重疊視窗會重複計費

`billedSec = max(1, round(durationSec))` 是**每個視窗的長度**，但視窗是刻意重疊的
（滑動 2.4s 視窗 / 1.2s 步進，`mergeCaption` 存在就是因為重疊）。所以每秒音訊被算兩次。
正解是計**新增的音訊**（絕對串流位置的差值）而不是視窗長度，取決於客戶端的視窗策略，
**是產品/實作決定，沒有擅自改**。

### `overlay` 配額語意不對（已改成誠實顯示）

`OVERLAYS` 有 **11 個**，free 方案的 `overlay` 上限是 **3**。
`/api/v1/obs` 的 `listAll()` 會在第一次呼叫時**無條件建立全部 11 個** `oBSSource`，
完全沒有 gating。

`overlay` 是「同時存在的上限」，不是週期消耗量，所以**不能**記進 `usageEvent`
（記了會讓它在配額頁變成 0/3 的假進度條）。現在改成：

- membership API 直接回 `overlayCount`（`oBSSource.count`），`quotas[]` 裡
  `overlay` 的 `used` 來源改成這個計數
- 兩頁在 `over` 時都說明實際情況：「同時層數，非用量」、「沒有因為超過數字而停用任何功能」

**沒有加 gating**，因為那是產品決策：少給會讓另外 8 個設定頁的 `OverlayOutput`
永遠顯示「尚未產生網址」，等於鎖掉現在能用的功能。要真正收斂有兩條路，都該先問：
1. 調高各方案的 `overlay` 數字（11 個全給，最省事）
2. 做「免費 3 個 + 其餘顯示升級提示」的規則（要改 UI 與 OBS 建立流程）

- ~~`useFeature` 儲存無 debounce~~ —— **這條前提是錯的，別加 debounce。**
  `useFeature` 的 `set()` 只改本地 state，持久化要按頁面上的「儲存設定」按鈕
  （`<Btn onClick={save}>`）才會送出。沒有「每鍵一請求」的問題。
  （當初會覺得有問題，是因為 grep 找 `save()` 沒找到 —— 實際寫法是
  `onClick={save}` 傳參考，沒有括號。8 個消費頁都正常存檔。）
- ~~無 Error Boundary~~ ✅ 已補 `src/app/{error,global-error,not-found,loading}.tsx`
  與 `src/app/dashboard/error.tsx`。**注意 Next 16 的 prop 是 `unstable_retry`，
  不是舊版的 `reset`** —— 憑訓練資料寫會靜默失效（見 `node_modules/next/dist/docs/01-app/01-getting-started/10-error-handling.md`）。
  已實測：`/_not-found` 回 404 且渲染我們的頁面；`unstable_retry` 有出現在 client chunk。
  尚未實測：故意讓頁面 crash 來看 error fallback（編譯與接線已確認）。
- 尚無 Vitest / Playwright（目前是 9 支自製 script 套件）。
- a11y：已補 `role="switch"` / `aria-current` / `role="tabpanel"`。

---

## 開發備忘

```bash
npm run dev
npx prisma db push --accept-data-loss   # schema 改動後
npx prisma generate                     # 改完 model 一定要重跑，然後**重啟 dev server**
node scripts/enable-overlays.mjs        # 啟用全部 overlay 並列出 OBS 網址
node scripts/test-caption-merge.ts      # 字幕合併去重的契約測試（npx tsx）
npx tsx scripts/test-provider-failover.ts  # 供應商鏈 + 失敗切換（打真實端點）
node scripts/test-captions.mjs          # 靜音閘門 + 幻覺過濾（端點層）
node scripts/test-captions-speech.mjs <wav>   # 端對端延遲實測
node scripts/check-caption-pipeline.mjs # 字幕 → SSE/輪詢 → overlay 全鏈路
```

> `check-caption-pipeline.mjs` 會寫入兩筆 `caption-check-*` 字幕驗證廣播，
> 驗完可用 SQL 清掉：`DELETE FROM "CaptionSegment" WHERE "text" LIKE 'caption-check-%';`

字幕轉寫需要這些環境變數（`.env.local` 已被 `.gitignore` 的 `.env*` 排除）：

```
GROQ_API_KEY=gsk_...                  # 直連，最快；單一金鑰無輪替
GROQ_ROUTER_URL=https://...           # 備援，輪替 ~30 把金鑰
GROQ_ROUTER_KEY=ak_...
GROQ_DIRECT_FIRST=true               # 先直連再 router
```

⚠️ **`prisma generate` 之後一定要重啟 dev server**，
否則記憶體裡的 Prisma client 沒有新 model，會出現
`Cannot read properties of undefined (reading 'findMany')`。

除錯用 session（開發用，勿帶到正式環境）：

```powershell
$sql = @'
INSERT INTO "User" (id, name, username, "createdAt") VALUES ('dev-user-1','大拇哥','devcreator',NOW()) ON CONFLICT (username) DO NOTHING;
INSERT INTO "Session" (id, "userId", platform, "createdAt") SELECT 'dev-session-1', u.id, 'dev', NOW() FROM "User" u WHERE u.username='devcreator';
'@
$sql | npx prisma db execute --stdin
```

瀏覽器設 cookie `sf_session=dev-session-1`（domain `localhost`）即可進入 dashboard。

> 從 PowerShell 用 here-string 管中文進 `prisma db execute` 會把字編成 `???`。
> 改中文請用 `write` 工具寫 UTF-8 的 `.sql` 檔再用 `--file` 執行。

---

## 參考來源

`C:\Users\CPXru\Desktop\thumb\program\LiveCore` **是 livio.tw 的原始碼專案**
（用户提供的部分 git），功能細節可從 `backend/api` 的 Fastify route 與
`frontend/overlay` 的 token 驗證機制取得，比爬線上頁面準確。

線上版本已比原始碼更新，多出：周邊商店、台聚活動、斗內卡牌、共用斗內房間、
斗內紀錄、斗內跑馬燈、追隨與訂閱提醒、同時觀看人數、即時比分板、會員中心、
用量與點數紀錄、付款與發票。

原始碼有但沒做 UI 的：抽獎（Giveaway，後端完整）、Nightbot 橋接、
回放分析片段檢索、直播指令的簽到籤與籤詩。