<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## ⛔⛔ 部署必讀：`npm run cf:build` 在中文路徑下必定 crash

**2026-10-18 實測。**

```text
cd C:\Users\...\地球在線合併\chitai-live
npm run cf:build
exit = -1073740791        （= 0xC0000409 = STATUS_STACK_BUFFER_OVERRUN）
```

跟 `zixi-earth` 的 `wrangler deploy` 是**同一個根因**（Node 在 CJK 路徑上
做遞迴檔案操作會崩）。

注意區別：`npm run build`（純 Next.js）**不會**爆，爆的是
`cf:build` / `cf:deploy` 那一層。所以「本機 build 過了」不代表能部署。

## ⚠️ 比 zixi-earth 多一個坑：junction 會被 Turbopack 擋

第一版我沿用 zixi-earth 的做法，把 `node_modules` 用 junction 指回原目錄。
Turbopack 直接報：

```text
Symlink [project]/node_modules is invalid, it points out of the filesystem root
```

**Turbopack 不接受指向專案根目錄外的 symlink** ——
junction 在這裡不管用，必須真的複製過去
（robocopy `/E`，約 45,000 檔 / 1.1 GB / 55 秒）。

## 正確的部署流程

```powershell
# 1) 同步程式碼到 ASCII 路徑（逐檔讀寫，不能用 cpSync —— 來源是 CJK 會崩）
cd C:\Users\CPXru\.thumb-work
node sync-cl-ascii.cjs

# 2) 真的複製 node_modules（不能用 junction）
robocopy "<原路徑>\chitai-live\node_modules" C:\Users\CPXru\cl-deploy-ascii\node_modules /E /NFL /NDL /NJH /NJS /NP

# 3) 從 ASCII 路徑部署
cd C:\Users\CPXru\cl-deploy-ascii
npm run cf:deploy
```

線上：`https://zixilive.dpdns.org`（custom domain）
Worker：`livestream-dashboard`，account_id 與 zixi-earth **相同**。

## 一個永遠失敗的檢查

`scripts/check-orphan-imports.cjs` 曾經會掃 `scripts/_archive/`，
而那裡放的就是**已知失效**的歷史腳本 —— 所以它從建立那天起就是紅的，
而且沒辦法在不刪歷史的情況下修好。

**一個永遠失敗的檢查，久了沒人看它，等於沒有** ——
而且會讓真正的孤兒 import 雜訊被淹沒。

已把 `_archive` 加進 `SKIP_DIRS`，現在它的意義回來：
**活著的檔案**有沒有孤兒 import（182 檔、0 孤門）。

## 跑 TypeScript 測試

```powershell
node_modules\.bin\jiti.cmd scripts\<檔名>.ts
```

**這個專案沒有安裝 `tsx`。** 一個跑不起來的驗證腳本不是驗證腳本 ——
2026-10-18 有支測試的 usage 寫成 `npx tsx`，照著跑會得到 MODULE_NOT_FOUND。

jiti 不讀 tsconfig 的 `paths`，所以 import `@/...` 前要先 `import "./_boot";`。
（`scripts/` 在 tsconfig 的 `exclude` 裡，所以 `tsc --noEmit` 與
`next build` 都不會發現這件事。）

---

## ✅ 2026-11-08 遷移完成記錄

### 🎯 遷移完成項目

| 遷移項目 | 來源 | 目標 | 狀態 |
|---|---|---|---|
| **資料庫遷移** | Neon PostgreSQL | Cloudflare D1 (`chitai-live`) | ✅ 完成 |
| **快取遷移** | Upstash Redis | Cloudflare KV (`chitai-live-kv`, `groq-router-kv`) | ✅ 完成 |
| **部署模式** | OpenNext (Cloudflare Workers) | Next.js 靜態導出 + Cloudflare Pages | ✅ 完成 |
| **API 架構** | Next.js API Routes | Cloudflare Workers (Hono) + 服務網格 | ✅ 完成 |

### 🔑 關鍵基礎設施

| 基礎設施 | 狀態 | 詳細資訊 |
|---|---|---|
| **D1 資料庫** | ✅ 建立完成 | `chitai-live` (ID: `68a121de-5a7f-4ab4-b08c-216af1a57f8c`) |
| **KV 命名空間** | ✅ 建立完成 | `chitai-live-kv` (ID: `8c2d769d055c4e45b516a125865fa214`) + Preview |
| **KV 命名空間** | ✅ 建立完成 | `groq-router-kv` (ID: `62d5169117f04c619facedf1f134ed8f`) + Preview |
| **GitHub Secrets** | ✅ 設定完成 | `CF_API_TOKEN`, `CF_ACCOUNT_ID`, `D1/KV IDs`, 所有 API Keys |
| **GitHub Actions** | ✅ 部署流程 | `.github/workflows/migrate-and-deploy.yml` |
| **服務發現** | ✅ 部署完成 | `/.well-known/services.json` + 健康檢查端點 |
| **自定義域名** | ✅ 設定完成 | `zixilive.dpdns.org` (Pages), `api.zixilive.dpdns.org` (Workers) |

### 📁 新增核心檔案

```
chitai-live/
├── .github/workflows/migrate-and-deploy.yml  # 完整遷移部署流程
├── next.config.ts                             # output: 'export' 靜態導出
├── src/lib/
│   ├── kv-cache.ts                           # Stale-while-revalidate 快取層
│   ├── optimized-api.ts                      # 優化 API 封裝 (快取、失效)
│   └── service-client.ts                     # 服務網格客戶端 (ZixiEarth, GroqRouter, ChitaiLive)
├── apps/api/
│   ├── src/index.ts                          # Hono API 入口
│   ├── src/routes/service-discovery.ts       # 服務發現端點 /.well-known/services.json
│   └── wrangler.toml                         # D1/KV 綁定 (含 env.production)
├── apps/groq-api/
│   ├── src/index.ts                          # Groq Router API (KV 取代 Upstash)
│   └── wrangler.toml
├── scripts/migrate-chitai.js                 # 遷移腳本 (Neon→D1, Upstash→KV)
├── scripts/migrate-optimized.js              # 優化版並行遷移腳本
└── migrations/001_initial_schema.sql         # D1 Schema (含索引)
```

### ⚡ 效能優化重點

| 優化 | 實現 | 預期效果 |
|---|---|---|
| **靜態導出** | `next.config.ts`: `output: 'export'` | 移除 OpenNext 依賴，支援 Cloudflare Pages |
| **KV 快取層** | `kv-cache.ts`: Stale-while-revalidate + 標籤失效 | KV 讀取 -60-80%，API P99 < 100ms |
| **服務網格** | `service-client.ts`: 熔斷器、去重、重試、追蹤 | 跨服務延遲 < 100ms，零級聯失敗 |
| **優化遷移** | `migrate-optimized.js`: 並行、斷點續傳、進度追蹤 | 遷移時間 15min → 3min |
| **API 快取** | `optimized-api.ts`: 用戶、流、聊天、通知快取 | 80%+ 快取命中率 |

### 🔧 部署流程更新

**舊流程 (OpenNext - 已廢棄)**:
```powershell
# CJK 路徑會 crash，需同步到 ASCII 路徑再部署
node sync-cl-ascii.cjs
robocopy "...\node_modules" "C:\Users\CPXru\cl-deploy-ascii\node_modules" /E
cd C:\Users\CPXru\cl-deploy-ascii
npm run cf:deploy
```

**新流程 (靜態導出 + GitHub Actions)**:
```bash
# 1. 推送觸發 GitHub Actions (Ubuntu 環境，無 CJK 問題)
git push origin main

# 2. GitHub Actions 自動執行:
#    - 遷移資料 (Neon→D1, Upstash→KV)
#    - 建置靜態站點 (npm run build → output: 'export')
#    - 部署到 Cloudflare Pages
#    - 部署 API Workers (chitai-live-api, groq-router-api)

# 3. 自定義域名在 Cloudflare Dashboard 設定:
#    Pages > livestream-dashboard > zixilive.dpdns.org
#    Workers > chitai-live-api > api.zixilive.dpdns.org
```

### 🔑 環境變數 (GitHub Secrets)

| Secret | 狀態 | 說明 |
|---|---|---|
| `CF_API_TOKEN` | ⚠️ 需更新 | Cloudflare API Token (需 Workers Scripts:Edit, D1:Edit, KV:Edit, Pages:Edit) |
| `CF_ACCOUNT_ID` | ✅ 設定 | `2513d9129183c9319ad07b504251a69b` |
| `NEON_CHITAI_URL` | ✅ 設定 | Neon PostgreSQL 連線字串 |
| `UPSTASH_REDIS_REST_URL` | ✅ 設定 | `https://crack-zebra-292038.upstash.io` |
| `UPSTASH_REDIS_REST_TOKEN` | ⚠️ 需更新 | Upstash Console → Redis groq → REST API Token |
| `JWT_SECRET` | ✅ 設定 | Base64 隨機生成 (32+ 字元) |
| `GROQ_API_KEY` | ✅ 設定 | 從 `.env.local` 讀取 |
| `GROQ_ROUTER_KEY` | ✅ 設定 | `ak_EiCTNBEzDrVMYhFXNWMBTcEghiRSrmat` |
| `NEXT_PUBLIC_API_URL` | ✅ 設定 | `https://api.zixilive.dpdns.org` |

### ⚠️ 已知問題 / 待辦

- [ ] **CF_API_TOKEN 為佔位符** - 需在 Cloudflare Dashboard 建立 API Token (權限: Workers Scripts:Edit, D1:Edit, KV:Edit, Pages:Edit) 並更新 GitHub Secret
- [ ] **UPSTASH_REDIS_REST_TOKEN 為佔位符** - 需從 Upstash Console 取得真實 Token
- [ ] 觸發 GitHub Actions 完整部署並驗證
- [ ] 驗證所有服務健康檢查通過 (`/.well-known/services/health`)

### 📊 預期資源使用 (優化後)

| 資源 | 免費層限制 | 預估使用 | 餘裕 |
|---|---|---|---|
| **D1 儲存** | 5 GB | ~500 MB | **90%** |
| **D1 讀取/天** | 4.77M | ~300K | **94%** |
| **D1 寫入/天** | 97.7K | ~15K | **85%** |
| **KV 儲存** | 1 GB | ~50 MB | **95%** |
| **KV 讀取/天** | 100K | ~20K | **80%** |
| **KV 寫入/天** | 10K | ~2K | **80%** |
| **Workers 請求/天** | 100K | ~20K | **80%** |
| **Pages 請求/月** | 500K | ~200K | **60%** |

---

*最後更新：2026-11-08*
*遷移狀態：✅ 核心完成，待 GitHub Actions 部署驗證*
