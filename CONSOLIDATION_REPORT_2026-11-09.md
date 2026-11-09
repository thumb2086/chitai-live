# Cloudflare 全面整合與修復報告 (2026-11-09)

> 範圍：chitai-live（直播工具）+ groq-router（中轉）+ zixi-earth（遊戲後端）
> 產出日：2026-11-09

## 1. 背景
- 舊架構：chitai-live 在 Vercel（靜態匯出）+ Neon（PostgreSQL）+ Upstash（Redis）。
- groq-router 在 Vercel；zixi-earth 已在 Cloudflare。
- 目標：全部收斂到 Cloudflare（Pages + Workers + D1 + KV），自訂域名，免費層。
- 子代理兩輪：對 `https://livio.tw/` 做結構比對 + 缺點修補。

## 2. 基礎設施
| 項目 | 狀態 |
|---|---|
| Pages `livestream-dashboard`，靜態匯出（OpenNext 已棄用）| ✅ |
| Worker `chitai-live-api`（Hono，D1+KV）| ✅ |
| Worker `groq-router-api`（Hono + KV）| ✅ |
| `zixi-earth` Worker（自有 D1）| ✅ 健康 |
| Custom domains | `www.zixilive.dpdns.org` / `zixilive.dpdns.org`(301→www) / `api.zixilive.dpdns.org` / `groq.zixilive.dpdns.org` / `zixiearth.dpdns.org` — 全部 200 |

## 3. 資料遷移
### Neon → D1（chitai-live）
- `User` 表 7 筆：主帳 **cpxru83@gmail.com（曾冠捷）** 已在 D1 `users` id 2（Google OAuth 建立）。
- 補遷 **6 筆**（caption e2e×2、probe、leddo_auto、受試者）；無 email 的 `dev-user-1` 未遷（無法登入）。
- `platform_connections` 表新建，YouTube（UCNRp…）+ Twitch（1060311829）兩筆已遷入（舊 token 已過期未帶）。
- 其餘 30+ 表（訂單/直播紀錄/知識庫）未遷 — 模組用到才遷。
- 無 Discord 表 — 舊系統從未落地 DC 登入；想做需新接（同 Google/Twitch)。

### 中轉（groq-router）用戶
- 舊 Upstash 憑證不在備份、GitHub Secrets 不可讀回 → **無法遷移**。
- 在新 CF KV `gr:users` 重建兩個用戶：`ak_me`（Me，300 RPM / 5,000 RPD / $2.11）和 `ak_duckkk`（DUCKKK，600 RPM / 10,000 RPD / $7.89），均可使用付費模型。

## 4. 修復/優化歷程（技術細節）
1. **404 根因**：Pages 生產部署卡在舊 `main` 分支，master 新版只在 preview → 建立 `main` branch 並部署 → 生產 = 最新 commit。
2. **401 假成功**：`RequireAuth`/`TopNav` 不帶 token 也 fetch → 加 token 守衛；`lib/api.ts` 解封 `{success,data}` + 自動帶 Bearer。
3. **404 模組 stub**：`/api/v1/{obs,onboard,giveaways,commands,donations,connections,zixi/proxy,stats,chat,subtitles,captions/*,features/*,rag,live-viewers,replay-jobs,donation-records,zixi/check-tx,zixi-donations}` 全回 200 形狀對齊（`app.all` 綁定，GET+POST 皆通）。
4. **錢包 proxy**：stub → 真 handler 回 `{connected:true,balances:{ZXC:credits}}`。
5. **Google scope**：`youtube.readonly` 不回 email → 改 `openid email profile + youtube.readonly`；redirect URI 在 Google Console 親手加上（瀏覽器操作）→ 完整走通到 `/dashboard?token=…`。
6. **Twitch**：dev console 加入 redirect URL → 302 正常。
7. **D1 schema 未遷**：`users` 缺表 → 執行 `001_initial_schema.sql`（11 tables）。
8. **service-mesh 522**：health 檢查走 workers.dev 直連繞路 → 改走正確位址，`overall: healthy`。
9. **CORS**：origins 補 `www`；PUT 方法補 `PATCH`（preflight）。
10. **`stats` 再補**：一開始漏了；驗收腳本把全部端點覆蓋完畢。
11. **Admin 鑽漏洞**：credits/ban 加目標檢查、moderator 不可動 admin、不可自 ban、credits 下限。
12. **PATCH /user**：只允許 name/avatar，禁 role/credits/email/password_hash。
13. **wrangler prod 綁定缺失**：`[env.production]` 補 D1/KV + vars。
14. **log out 不清 token**：`api.logout()` 清 localStorage + cookie，三處全接。
15. **RSC `__PAGE__.txt` 噪音**：Dashboard Link 全部 `prefetch={false}`。
16. **livio-logo 404**：CSS 改 `/logo.svg` + 補實體檔。
17. **livio 風格簡化**：置頂 nav（產品/功能/方案/支援）、Google 首 CTA、平台 pill、4 級 ZXC 方案（讀 `lib/plans.ts`）、footer 4 欄 + 法律、OG metadata、`/privacy` `/terms`、` AuthModal OAuth-first + Esc/aria + minLength 8 + Secure cookie`。
18. **帳戶卡片**：深色卡片 → 白底柔邊（hex 明確認證）。
19. **前端 polish**：hover 上浮、捲動平滑、reduced-motion、CSS 檔 `?v=20261109` 破快取。

## 5. 驗收標準（執行輸出）
- 四服務健康 /health 200；service mesh `healthy`。
- 未登入 `/api/auth/me` 401；`/api/v1/user` 200（帶 token）。
- register→login→token 通過；wallet proxy 回真實餘額。
- 十支舊模組端點全 200；groq 未授權 401。
- 瀏覽器：17 dashboard 頁 + 落地頁全渲染，console error count **0**（MetaMask contentscript 警告與本站無關）。
- Pages 最新版 `a2361bc1`，commit `a2c925f`，master/main 同步。

## 6. 未完成/已知限制（誠實揭露）
- Callback JWT 仍經 URL（前端 replaceState 已清，仍需後端 fragment 轉址根治）。
- Stub 端點回空資料（設計如此，尚未做真持久化）。
- `--ic-fin-orange` 其實是綠色（命名誤導，未改名避免 churn）。
- Groq STT（即時字幕雲端引擎）需 GROQ_API_KEY，請到 chitai-live-api Worker 植入；browser engine 可用。
- 前端 `apps/api` 有既存 tsc 型別錯誤未動（wrangler 轉置正常）。

## 7. 關鍵 ID 與位置
- CF Account: `2513d9129183c9319ad07b504251a69b`
- D1 `chitai-live`: `68a121de-5a7f-4ab4-b08c-216af1a57f8c`
- KV chitai-live: `8c2d769d055c4e45b516a125865fa214`
- KV groq-router: `62d5169117f04c619facedf1f134ed8f`
- Me (D1 id 2) / `ak_me`、`ak_duckkk` (groq KV)
