# 熾台 部署平台分析：Vercel vs Render

> 分析日期：2026-06-14  
> 專案：chitai-live (熾台)  
> 目前階段：v0.1 原型

---

## 核心部署限制

部署此專案前需先理解三個關鍵制約：

### 1. SQLite 資料庫（最大問題）

專案使用 **SQLite** via `@prisma/adapter-libsql`。SQLite 是**檔案型資料庫**，這直接影響部署選擇。

### 2. Twitch Worker 常駐程式

`src/twitch-worker.ts` 是一個獨立的 Node.js 程式，需要用 `tmi.js` 持續連線 Twitch IRC，必須 24/7 運行。

### 3. Next.js 版本

使用 Next.js 16.2.9（非常新），部分平台可能尚未完全最佳化。

---

## 平台比對表

| 項目 | Vercel | Render |
|:-----|:-------|:-------|
| **SQLite 支援** | ❌ 不支援 — Serverless 檔案系統為 ephemeral，資料在每次請求間不保留 | ⚠️ 需加購 Persistent Disk（$15/月） |
| **Next.js 支援** | ✅ 最佳 — 由 Vercel 開發維護 | ✅ 支援（Node.js Web Service） |
| **Twitch Worker** | ❌ 無法內建執行，需另尋方案 | ✅ 可作為 Background Worker 運行 |
| **免費方案** | ✅ 慷慨（100GB 頻寬 / 月） | ⚠️ 有限（Web Service 無免費層持久磁碟） |
| **Preview Deploy** | ✅ 每個 PR 自動產生預覽網址 | ⚠️ 僅預覽服務（付費） |
| **建置速度** | ✅ 快（快取優化） | ⚠️ 較慢 |
| **Edge Functions** | ✅ 支援 | ❌ 不支援 |
| **Serverless vs 常駐** | Serverless Functions | Web Service（常駐） |
| **Docker 支援** | ⚠️ 有限 | ✅ 完整支援 |
| **國內連線速度** | ⚠️ 海外節點（亞洲有東京/新加坡） | ⚠️ 海外節點（無亞洲免費層） |

---

## 方案一：Render（建議短期）

### 適合原因

1. **Web Service 模式** — 不是 serverless，進程持續運行，檔案系統可讀寫
2. **Persistent Disk 可讓 SQLite 存活** — 掛載後資料不會因重啟消失
3. **Background Worker 跑 Twitch Worker** — 同一個專案可以開兩種 Service
4. **零程式碼修改** — 環境變數設好即可部署
5. **支援 Cron Jobs** — 未來可用於定期任務

### 需要做的事

| 項目 | 說明 |
|:-----|:------|
| **Persistent Disk** | 加購 ($15/月)，掛載到 `/opt/render/project/src/prisma` |
| **DATABASE_URL** | 改為 `file:/opt/render/project/src/prisma/dev.db` |
| **Build Command** | `npx prisma generate && npm run build` |
| **Start Command** | `npm start` |
| **Health Check** | 設定 `/api/v1/user` 路徑（會回傳 401，但表示服務活著） |
| **Twitch Worker** | 另開一個 Background Worker，command: `npx tsx src/twitch-worker.ts` |

### render.yaml（一鍵部署用）

```yaml
services:
  - type: web
    name: streamflow
    env: node
    buildCommand: npx prisma generate && npm run build
    startCommand: npm start
    healthCheckPath: /api/v1/user
    disk:
      name: sqlite-data
      mountPath: /data
      sizeGB: 1
    envVars:
      - key: DATABASE_URL
        value: file:/data/dev.db
      - key: NODE_VERSION
        value: 20

  - type: worker
    name: streamflow-twitch-worker
    env: node
    buildCommand: npm install
    startCommand: npx tsx src/twitch-worker.ts
    envVars:
      - key: DATABASE_URL
        value: file:/data/dev.db
```

---

## 方案二：Vercel + Turso（建議長期生產）

### 適合原因

1. **Next.js 最佳部署平台** — 由同個團隊打造，功能最先支援
2. **Preview Deployments** — 每個 PR 自動產生預覽，團隊開發必備
3. **效能優異** — Edge Network + ISR
4. **Turso 是 SQLite 的雲端版本** — 由 libsql 團隊開發，與 `@prisma/adapter-libsql` 完全相容

### 需要做的事

| 項目 | 說明 |
|:-----|:------|
| **申請 Turso 帳號** | 免費方案夠用 |
| **建立 Turso 資料庫** | `turso db create streamflow` |
| **修改 DATABASE_URL** | 改為 `libsql://your-db.turso.io?authToken=...` |
| **程式碼無須修改** | Prisma + PrismaLibSql 直接支援 Turso 協定 |
| **Twitch Worker** | 需另找主機（可用 Render Worker 或 Railway） |
| **vercel.json** | 無特殊設定，預設即可 |

### 費用估算

| 項目 | 費用 |
|:-----|:-----|
| Vercel Pro | $20/月（可先從免費開始） |
| Turso 免費方案 | 500MB 資料庫 + 9GB 傳輸/月 → **免費** |
| Twitch Worker 主機 | Render Worker 免費方案或 Railway $5/月 |
| **合計** | **$0–25/月** |

---

## 對比總結

```
考量因素          Winner
─────────────    ─────
SQLite 相容       Render（加磁碟） > Vercel（不相容）
Next.js 整合      Vercel >> Render
運作成本          Vercel+Turso < Render（磁碟 $15/月）
Twitch Worker     Render（原生支援） > Vercel（需第三方）
部署難易度        Render（零修改） > Vercel+Turso（需建 DB）
生產就緒度        Vercel+Turso >> Render+SQLite
```

---

## 我的建議

### 🏆 推薦：Vercel + Turso（長期）

SQLite 在生產環境用 Persistent Disk 是**不穩定的捷徑**（單點故障、備份困難、無法水平擴展）。既然專案已經用了 `@prisma/adapter-libsql`，那距離 Turso 雲端 SQLite 只差一行環境變數。這是走向生產就緒的正確方向。

### 但如果想快速上線測試

**Render + Persistent Disk** 可以讓你在 10 分鐘內部署完成，完全不用改程式碼。適合先讓 overlay 可以實際在 OBS 中測試。

---

## 下一步行動建議

1. 如果選 **Render** → 直接建立 `render.yaml`，設定 Disk + Web Service + Worker
2. 如果選 **Vercel + Turso** → 先照著 GUIDE.md 補充 `/api/v1/subtitles` 遺失的路由，再部署
3. 無論選哪個，**`.env` 裡的 credentials 已經暴露在 git 歷史中**，建議 deploy 前務必重新申請一組新的 Client ID/Secret
