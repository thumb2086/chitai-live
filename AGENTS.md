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
