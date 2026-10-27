# chitai-live GitHub Actions Deployment

## 概述
本專案使用 GitHub Actions (Linux runner) 部署到 Cloudflare Workers，繞過 Windows 上 OpenNext 已知 Bug。

## 必要 Secrets 設定

進入 GitHub Repository → Settings → Secrets and variables → Actions → New repository secret：

| Secret Name | 值來源 | 說明 |
|------------|--------|------|
| `CF_API_TOKEN` | Cloudflare Dashboard → My Profile → API Tokens → Create Token | 權限：Account > Workers Scripts > Edit、Zone > Workers Routes > Edit（若用自訂域名） |
| `CF_ACCOUNT_ID` | Cloudflare Dashboard → 右側邊欄 Account ID | Cloudflare 帳號 ID |

## 部署流程

1. **Push 到 main 分支** → 自動觸發部署
2. **或手動觸發** → Actions → Deploy chitai-live to Cloudflare Workers → Run workflow

## 本地開發同步

```bash
# 本地測試建置（Linux/WSL2 環境）
pnpm run build
npx opennextjs-cloudflare build
npx wrangler deploy
```

## 工作流程說明

| Job | 功能 | 觸發條件 |
|-----|------|----------|
| `build-and-deploy` | 建置 Next.js + OpenNext + 部署 | push to main / manual |
| `test` | TypeScript / Lint 檢查 | push to main / PR |

## 環境變數（部署時自動注入）

| 變數 | 來源 | 用途 |
|------|------|------|
| `CF_API_TOKEN` | GitHub Secret | Wrangler 認證 |
| `CF_ACCOUNT_ID` | GitHub Secret | 指定部署帳號 |
| `NODE_ENV` | workflow env | production 模式 |

## 故障排除

| 問題 | 解決方式 |
|------|----------|
| `CF_API_TOKEN` 權限不足 | 確認 Token 有 `Workers Scripts: Edit` 權限 |
| `ENOENT` manifest 缺失 | 確認 `next.config.ts` 有 `output: "standalone"` |
| Sharp 原生模組錯誤 | Linux runner 原生支援，無需處理 |
| 部署後 404 | 確認 `wrangler.jsonc` 的 `routes` / `workers_dev` 設定 |

## 手動部署（緊急時）

```bash
# 在 Linux/WSL2 環境
cd cl-deploy-ascii
pnpm install --frozen-lockfile
pnpm run build
npx opennextjs-cloudflare build
CF_API_TOKEN=xxx CF_ACCOUNT_ID=yyy npx wrangler deploy
```

## 相關檔案

| 檔案 | 用途 |
|------|------|
| `.github/workflows/deploy.yml` | 主部署工作流程 |
| `next.config.ts` | Next.js 設定（含 `output: standalone`） |
| `open-next.config.ts` | OpenNext Cloudflare 設定 |
| `wrangler.jsonc` | Cloudflare Worker 設定 |
| `scripts/fix-standalone.js` | Windows 相容性修補（Linux 不需要） |

---

**注意**：此工作流程**只在 Linux (ubuntu-latest) 執行**，完全繞過 Windows 上的 OpenNext Bug（sharp 原生模組、standalone 路徑、handler.mjs 缺失）。