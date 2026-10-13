# LiveCore 帳號權限紅隊報告（RoE 範圍內）

- 時間：2026-09-17（UTC），RoE 窗口 2026-09-17 00:00 至 2026-09-30 00:00（UTC+8）
- 依據：2026-06-20《合作開發暨分潤協議書》3.4 / 8.5 / 8.8 / 10.7＋使用者提供之 RoE 文字（甲方簽名未獨立驗證，以使用者陳述為準；建議甲方以 email/Discord 回覆「同意上述 RoE」留存）
- 目標：本地 `chitai-live` 白盒＋正式站最小被動偵察（各 1 個 HEAD/GET，不過度掃描、不暴力破解、不窮舉 Token）
- 原則：僅測試帳號、不碰他人真實帳號/真金流、不外帶原始碼與 DB、不蒐集 PII；**拒絕「提升到最高權限並且保持」**——越權僅在本地以程式碼審查證明，正式站不做持久化提權，驗證後即還原並通報。

## 任務一：簡化移植（已實作，未抄襲）

新增（原創碼、通用文案、無 LiveCore 自訂文字/CSS 複製）：
- `prisma/schema.prisma`：`LiveCommand（trigger/response/enabled/sortOrder，@@unique[userId, trigger]）`＋`User.liveCommands` 關聯。Client 已 `prisma generate`；**`prisma db push` 因 Neon 主機連線失敗（P1001）待 DB 可達後執行**。
- `src/app/api/v1/commands/route.ts`：GET/POST（add/update/toggle/delete），`trigger` 限 `![a-z0-9_]` 2–30 字、`response` ≤500 字、上限 50 筆、全查詢 `where:{userId}`。
- `src/app/api/v1/leaderboard/route.ts`：由既有 `ZixiDonation(confirmed)` 聚合 Top 10，`week/month/all`，無新表。
- `src/app/dashboard/commands/page.tsx`、`src/app/dashboard/leaderboard/page.tsx`：簡化 CRUD＋區間切換。
- `src/lib/api.ts`、`src/components/Sidebar.tsx`、`src/app/dashboard/page.tsx`：接線＋導航。
- 驗證：`npx tsc --noEmit` 通過；eslint 僅全 repo 既有 `any` 風格告警。

## 任務二：可改帳號權限漏洞（本地已驗證，已修其中 4 項；OAuth 合併需甲方排期修）

### P0-1 OAuth callback 帳號合併接管（未修，需排期）
位置：`src/app/api/auth/callback/route.ts:15-21,89-115`、`src/app/api/auth/[platform]/route.ts:62-63`
- `state` 僅 base64 JSON `{platform}`，無簽名/nonce → CSRF 登入綁定風險。
- 按 `email→channelId→channelName` 合併；`channelName` 非唯一（第 113 行 `findFirst({platform, channelName})`）且 display_name 可被控制；email 未校驗 verified 即合併。
- 影響：攻擊者以相同顯示名或未驗證 email 可綁定/合併他人帳號，改變帳號歸屬與權限。
- 修復建議：state 綁定簽名 nonce＋cookie 比對；僅 verified email 才合併；移除 `channelName` 合併路徑，改以 `channelId`＋明確帳號連結流程；合併前要求已登入 session 確認。

### P0-2 自提權：PATCH /api/v1/user 大量賦值（已修本地）
原 `ALLOWED` 含 `chosenPlan/donationTotal/donationDonors/totalViews/followers/totalMessages/email` → 自改方案與數據、email 劫持合併。
修：`src/app/api/v1/user/route.ts` 收斂為 `name/username/publicPage/donationMinAmount/donationSound/demoMode/zixiWallet/avatar`。

### P0-3 统计偽造：POST donations updateUser（已修本地）
原接受 `totalReceived/donorCount` 直接寫 `donationTotal/donationDonors`。
修：`src/app/api/v1/donations/route.ts` 只接受 `minAmount/soundEffect`，總額僅由 simulate/已確認贊助累加。

### P0-4 登出未失效 Session，可重放改權限（已修本地）
原 `logout/route.ts` 只清 cookie，不刪 DB `Session` → 舊 `sf_session` 仍有效。
修：logout 時 `prisma.session.delete`＋清 cookie。另建議：DB session 加 `expiresAt` 並在 `getUser.ts` 校驗；cookie 加 `Secure`（正式站 HTTPS）＋`HttpOnly` 已有。

### P0-5 弱 Token：Math.random＋Date.now（已修本地）
原 `obs/route.ts:21,51`、`callback:121` 用 `Math.random()+Date.now()`（約 32–48 bit 有效熵、可預測）。
修：改 `crypto.randomUUID()` 拼接。另建議 overlay token 支援輪換（已有 regenerate）＋到期與範圍限定。

### P1-1 未授權偽造已確認贊助（已修本地）
原 `POST /api/v1/zixi-donations` 憑 `isTest:true＋username` 即可寫 `confirmed` 記錄，污染 alerts/leaderboard/統計。
修：`isTest` 需 session 擁有者與目標 `username` 一致，否則 403。

### P1-2 chat/messages worker 密钥與 channelName 定位（未修，建議）
`src/app/api/v1/chat/messages/route.ts:15-19` 以 `apiKey==CHAT_WORKER_KEY＋channelName` 定位 userId；`channelName` 可變且 `CHAT_WORKER_KEY=dev-key` 弱預設。
建議：worker key 改高熵＋定期輪換；改以 `channelId` 定位；`__clear__` 需 owner 角色校驗＋速率限制。

## 正式站被動偵察（各 1 請求，無主動越權）
- `HEAD https://livio.tw/、/dashboard`：200，`Server: cloudflare`，`via: Caddy`，HSTS/CSP/`x-content-type-options: nosniff` 具備；`frame-src` 含 `https://overlay.livio.tw`（**該子域不在 RoE 明示範圍，未測試**）。
- `GET https://livio.tw/api/v1/user、/api/v1/obs`（無 cookie）：回 Next.js 404 HTML，非本地 JSON 401——正式站 API 面與本地路徑不一致（可能經 Caddy 內鍵 `x-livecore-dashboard-proxy-key` 代理，見 `TECH-STACK.md`），**未再探測**，待甲方確認正式 API 基址與測試帳號後再以 session 測。
- 未做：暴力破解、憑證填充、Token 窮舉、DoS、他人帳號讀寫、真金流操作。

## 待甲方事項
1. 以 email（`avarinyt@gmail.com`）或 Discord 回覆確認 RoE 生效＋提供 2 組測試帳號 session 取得方式；確認正式 API 基址與 `overlay.livio.tw` 是否在範圍。
2. 排期修 P0-1（OAuth 合併）與 P1-2；本地其餘 4 項修補待你部署到獨立域名後以測試帳號 A↔B 做**還原式**驗證（證明即還原，不保持提權）。
3. `npx prisma db push` 待 Neon 連線恢復後執行（含 `LiveCommand` 表）。

## 24h 通報草稿（可直接寄甲方）
主旨：【LiveCore 資安通報】發現可變更帳號權限漏洞（登出失效/自提權/偽造贊助/弱Token/OAuth合併），本地已修 4 項
內容：重現位置如上（測試帳號/本地），影響為帳號接管與權限提升，修復如上，請求確認 RoE 與排期修 OAuth 合併；無 PII 外洩、無正式站持久化變更。
