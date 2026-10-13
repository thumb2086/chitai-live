# 熾台 完整使用指南

> 免費開源的直播工具平台 — 斗內進度、聊天室、字幕等疊加層設定與 OBS 連結

---

## 目錄

1. [快速開始](#一快速開始)
2. [環境變數設定](#二環境變數設定)
3. [功能測試指南](#三功能測試指南)
4. [OBS 疊加層設定](#四obs-疊加層設定)
5. [部署指南](#五部署指南)
6. [疑難排解](#六疑難排解)

---

## 一、快速開始

```bash
# 1. 安裝依賴
npm install

# 2. 初始化資料庫（已是 SQLite，無需額外設定）
npx prisma db push

# 3. 啟動開發伺服器
npm run dev
```

開啟 http://localhost:3000 → 點「進入控制中心」即可使用。

### 預設帳號
- 無需註冊，自動建立預設使用者 `creator`
- 公開頁面網址：`http://localhost:3000/@creator`
- 贊助頁面網址：`http://localhost:3000/donate/@creator`

---

## 二、環境變數設定

### 2.1 基本設定（不需改也能用）

複製 `.env.example` 為 `.env`：

```env
DATABASE_URL="file:./prisma/dev.db"
```

這個預設就能用，SQLite 檔案會自動建立。

### 2.2 OAuth 憑證（要讓 Twitch/Google 登入真正能動才需要）

#### Step 1: 申請 Twitch 憑證

1. 到 https://dev.twitch.tv/console/apps
2. 點「Register Your Application」
3. 名稱隨便填（例如 `熾台 Dev`）
4. **OAuth Redirect URL** 填入（注意：不要加任何網址參數）：
   ```
   http://localhost:3000/api/auth/callback
   ```
5. 分類選 `Application Integration`
6. 建立後複製 **Client ID** 和 **Client Secret**

#### Step 2: 申請 Google 憑證

1. 到 https://console.cloud.google.com/apis/credentials
2. 點「建立憑證」→「OAuth 用戶端 ID」
3. 應用程式類型選 **「Web 應用程式」**
4. 名稱隨便填
5. **授權的重新導向 URI** 加入：
   ```
   http://localhost:3000/api/auth/callback
   ```
6. 建立後複製 **用戶端 ID** 和 **用戶端密碼**
7. 到「API 和服務」→「程式庫」→ 啟用 **YouTube Data API v3**

#### Step 3: 填入 `.env`

```env
TWITCH_CLIENT_ID=你的_twitch_client_id
TWITCH_CLIENT_SECRET=你的_twitch_client_secret
YOUTUBE_CLIENT_ID=你的_google_client_id
YOUTUBE_CLIENT_SECRET=你的_google_client_secret
```

#### Step 4: 重新啟動

```bash
npm run dev
```

### 2.3 沒填憑證會怎樣？

點「連線」按鈕時，會顯示**設定指引頁面**，一步步教你怎麼申請，不會直接報錯。

---

## 三、功能測試指南

### 3.1 基本功能測試流程

```
1. 開啟 http://localhost:3000/dashboard
   ✓ 看到控制中心首頁，10 個功能卡

2. 測試聊天室設定
   → 點側邊欄「聊天室」
   → 切換主題（深色/淺色/透明）
   → 調整字型大小
   → 右側預覽會即時更新

3. 測試字幕疊加層
   → 點側邊欄「字幕疊加層」
   → 調整文字顏色、背景色、位置
   → 測試文字會即時反映在預覽區

4. 測試斗內目標
   → 點側邊欄「斗內進度」
   → 點「新增目標」加入一個目標
   → 用「模擬斗內」按鈕輸入金額測試進度條

5. 測試 OBS 輸出
   → 點側邊欄「OBS 輸出」
   → 看到三個疊加層網址
   → 點「複製」可以複製網址
```

### 3.2 OBS 疊加層測試

不需要真的開 OBS，直接用瀏覽器開啟疊加層網址就能看到效果：

| 疊加層 | 測試網址 |
|---|---|
| 聊天室 | `http://localhost:3000/overlay/chat/abc123` |
| 斗內進度條 | `http://localhost:3000/overlay/donations/def456` |
| 字幕 | `http://localhost:3000/overlay/subtitles/ghi789` |
| 斗內通知 | `http://localhost:3000/overlay/alerts/jkl012` |
| 頻道統計 | `http://localhost:3000/overlay/stats/mno345` |

**預設沒有假訊息**（`demoMode=false`）。要看到模擬效果：

1. 到「測試與整合」頁面
2. 打開「自動模擬」開關
3. 重整 overlay 頁面，就會開始出現模擬訊息

### 3.3 平台串接測試

1. 點側邊欄「平台串接」
2. 點 Twitch 或 YouTube 的「連線」按鈕
3. 如果 `.env` 有填憑證：
   - 會跳轉到 Twitch/Google 授權頁
   - 同意後回到控制中心，顯示已連線
4. 如果 `.env` 沒填憑證：
   - 會顯示設定指引頁面
   - 照步驟申請後重試

### 3.4 公開頁面測試

| 頁面 | 網址 | 說明 |
|---|---|---|
| 創作者公開頁 | `http://localhost:3000/@creator` | 觀眾看到的個人頁面 |
| 贊助頁 | `http://localhost:3000/donate/@creator` | 觀眾贊助頁面（金流串接後啟用） |

創作者在「公開頁面」設定中編輯名稱和使用者名稱會即時同步。

### 3.5 資料庫測試

資料庫檔案在 `prisma/dev.db`，可以用任何 SQLite 瀏覽器開啟。

常用查詢：
```sql
-- 查看使用者
SELECT id, name, username, demoMode FROM User;

-- 查看聊天室設定
SELECT * FROM ChatSettings;

-- 查看 OBS 來源
SELECT * FROM OBSSource;
```

---

## 四、OBS 疊加層設定

### 4.1 加入 OBS

1. 開啟 OBS Studio
2. 在來源面板按 `+` → 選擇「Browser Source」
3. 名稱隨便填（例如「聊天室」）
4. **URL** 貼上 熾台 提供的疊加層網址
5. 寬度：`1920`，高度：`1080`
6. 按確定

### 4.2 疊加層說明

| 疊加層 | 顯示內容 | 位置 |
|---|---|---|
| 聊天室 `/overlay/chat/[token]` | 聊天室訊息列表 | 底部置中（可從設定調整） |
| 斗內進度條 `/overlay/donations/[token]` | 贊助目標進度條 | 底部置中 |
| 字幕 `/overlay/subtitles/[token]` | 即時字幕文字 | 底部置中（可從設定調整） |
| 斗內通知 `/overlay/alerts/[token]` | 斗內時彈出通知動畫 | 頂部置中 |
| 頻道統計 `/overlay/stats/[token]` | 即時追蹤數/觀看數 | 右下角 |

### 4.3 安全性提醒

- 疊加層網址不要公開分享
- 如果懷疑外洩，到「OBS 輸出」頁面點「重新產生」更新 token
- Token 更新後所有使用舊網址的 OBS 來源都會失效，需重新貼上

---

## 五、部署指南

### 5.1 建置

```bash
npm run build
npm start
```

### 5.2 部署到 Vercel（推薦）

```bash
# 安裝 Vercel CLI
npm i -g vercel

# 部署
vercel

# 設定環境變數
vercel env add DATABASE_URL
# 注意：Vercel 不支援 SQLite 檔案寫入
# 需改用 PostgreSQL（見下方說明）
```

### 5.3 使用 PostgreSQL（生產環境）

1. 申請免費 PostgreSQL（如 Railway、Supabase、Neon）
2. 修改 `prisma/schema.prisma`：
   ```prisma
   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
   }
   ```
3. 更新 `.env`：
   ```env
   DATABASE_URL="postgresql://user:password@host:5432/db"
   ```
4. 執行 migration：
   ```bash
   npx prisma db push
   ```

### 5.4 Docker 部署

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

---

## 六、疑難排解

### Q: 設定改完重整就不見了？

可能原因：
- 資料庫檔案權限問題 → 確認 `prisma/` 目錄可寫入
- 瀏覽器快取 → 按 `Ctrl+Shift+R` 強制重整
- API 錯誤 → 打開瀏覽器 DevTools → Console 看有沒有紅字錯誤

驗證儲存是否成功：
```
1. 改一個設定（例如聊天室主題）
2. 重整頁面
3. 看設定是否保持
```

### Q: Overlay 沒有出現模擬訊息？

預設 `demoMode=false`。到「測試與整合」頁打開「自動模擬」即可。

### Q: 連線按鈕跳到設定頁面？

代表 `.env` 沒有填 OAuth 憑證。照指引申請後填入再重試。

### Q: 斗內按了沒反應？

斗內功能目前是模擬模式。到「斗內進度」頁面用「模擬斗內」按鈕測試。

### Q: 如何重置所有資料？

```bash
# 刪除資料庫
rm prisma/dev.db

# 重建
npx prisma db push

# 重新啟動
npm run dev
```

### Q: Port 3000 被佔用？

```bash
# 使用其他 port
npm run dev -- -p 3001
```

### Q: Build 失敗？

```bash
# 清除快取
rm -rf .next

# 重新產生 Prisma client
npx prisma generate

# 重新 build
npm run build
```

---

## 七、技術架構

```
src/
├── app/
│   ├── api/               # REST API 路由
│   │   ├── auth/          # OAuth 授權流程
│   │   └── v1/            # API v1（user/chat/donations/stats...）
│   ├── dashboard/         # 創作者控制中心（12+ 頁面）
│   ├── donate/            # 公開斗內頁面
│   ├── overlay/           # OBS 疊加層渲染（5 種）
│   └── [username]/        # 公開創作者頁面
├── components/            # 共用 UI 元件
└── lib/                   # 共用工具（Prisma/API client）
```

### 疊加層運作原理

```
使用者在控制中心設定樣式
       ↓
設定存到 SQLite 資料庫
       ↓
OBS 載入 /overlay/[type]/[token]
       ↓
Server 從 DB 讀取設定 → 渲染純 HTML
       ↓
OBS Browser Source 顯示疊加層
```

### 技術棧

| 層級 | 技術 |
|---|---|
| 前端框架 | Next.js 16 (React 19) |
| 樣式 | Tailwind CSS 4 |
| 圖示 | Lucide React |
| 資料庫 | SQLite (Prisma 7) |
| 語言 | TypeScript 5 |
