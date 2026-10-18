/**
 * 字幕轉寫端點的「診斷資訊」測試。
 *
 * 為什麼要有這支：2026-10-17 把錄音的 STT fallback 從 GROQ_ROUTER_URL
 * 搬到 STT_PROXY_URL（groq-router 的 /api/transcriptions 回 410），
 * 但 GET /api/v1/captions/transcribe 還在**舊變數**上報狀況。
 *
 * 而這正是那個檔案自己寫的教訓：
 *   「真正的问题不是『網址舊了』，是『舊網址是 fallback』」
 *
 * 診斷端點報錯的話，使用者會照著錯誤的訊息去設環境變數，
 * 設完還是不會動 —— 而症狀看起來像「設定沒生效」。
 */

import { readFileSync, existsSync } from "node:fs";
// jiti 2.x 不會讀 tsconfig 的 `paths`，@/ 別名要自己先掛上，
// 否則 import route 時會得到 "Cannot find module '@/app/api/...'"。
// （scripts/ 在 tsconfig 的 exclude 裡，所以 tsc 與 next build 都不會發現這件事。）
import "./_boot";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
function loadEnv(file: string, override: boolean) {
  const p = join(ROOT, file);
  if (!existsSync(p)) return;
  for (const raw of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = raw.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (override || process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadEnv(".env", false);
loadEnv(".env.local", true);

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}${extra ? "  " + extra : ""}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${extra ? "  " + extra : ""}`);
  }
}

async function main() {
  const { GET } = await import("@/app/api/v1/captions/transcribe/route");
  const { providerOrder } = await import("@/lib/captions-groq");

  console.log("\n字幕轉寫診斷端點\n");

  // ── ① routerHost 必須是實際服務 STT fallback 的那台主機 ──
  //
  // 對照組：providerOrder() 才是真相 —— captions-groq.ts 送去轉寫的就是它。
  //
  // ⚠️ 兩組主機必須**先**設好再算預期值。
  //    providerOrder() 是每次呼叫重新讀 env 的，所以預期值要取自
  //    同一組 env —— 否則這支測試會在比對一個從沒生效過的值，
  //    然後紅著卻指不出任何真正的問題。
  process.env.STT_PROXY_URL = "https://stt.example.invalid/v1";
  process.env.GROQ_ROUTER_URL = "https://router.example.invalid";

  const router = providerOrder().find((p) => p.id === "router");
  const expectedHost = router ? new URL(router.url).host : null;

  const res = await GET();
  const body: any = await res.json();

  ok("GET 回 200", res.status === 200, `status=${res.status}`);
  ok(
    "routerHost 是 STT 代理的主機，不是 chat/embedding 用的 router",
    body.routerHost === expectedHost,
    `回報 ${body.routerHost}，實際轉寫主機 ${expectedHost}`,
  );

  // ── ② 壞掉的網址不該讓診斷端點整個 500 ──
  //
  // STT_PROXY_URL 是環境變數；打錯一個字元就會讓整個診斷頁變 500，
  // 而那正是最需要診斷的時候。
  process.env.STT_PROXY_URL = "不是網址";
  const bad = await GET();
  const badBody: any = await bad.json().catch(() => null);
  ok(
    "STT_PROXY_URL 語法壞掉時仍回 200（而不是未捕捉的 TypeError）",
    bad.status === 200 && badBody !== null,
    `status=${bad.status}`,
  );

  // ── ③ 503 訊息要指向真的能用的變數 ──
  //
  // groq-router 的 /api/transcriptions 已停用（410），
  // 訊息卻叫使用者去設 GROQ_ROUTER_URL —— 照做不會有任何效果。
  const { POST } = await import("@/app/api/v1/captions/transcribe/route");
  const savedKey = process.env.GROQ_API_KEY;
  const savedRouterKey = process.env.GROQ_ROUTER_KEY;
  delete process.env.GROQ_API_KEY;
  delete process.env.GROQ_ROUTER_KEY;

  const req = new Request("http://localhost/api/v1/captions/transcribe", { method: "POST" });
  const unconfigured = await POST(req);
  const unBody: any = await unconfigured.json().catch(() => null);
  const msg = String(unBody?.error ?? "");

  ok("未設定時回 503", unconfigured.status === 503, `status=${unconfigured.status}`);
  ok(
    "503 訊息指向 STT_PROXY_URL（實際服務轉寫的變數）",
    msg.includes("STT_PROXY_URL"),
    msg.slice(0, 90),
  );
  ok(
    "503 訊息不再叫人去設已停用的 GROQ_ROUTER_URL",
    !msg.includes("GROQ_ROUTER_URL"),
    msg.slice(0, 90),
  );

  if (savedKey !== undefined) process.env.GROQ_API_KEY = savedKey;
  if (savedRouterKey !== undefined) process.env.GROQ_ROUTER_KEY = savedRouterKey;
  delete process.env.STT_PROXY_URL;
  delete process.env.GROQ_ROUTER_URL;

  console.log(`\n結果: ${pass} 通過 / ${fail} 失敗`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("測試本身出錯:", e);
  process.exitCode = 1;
});