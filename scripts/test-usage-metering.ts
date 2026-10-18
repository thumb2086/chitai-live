/**
 * Proves the quota meters have a real producer.
 *
 * Before src/lib/usage.ts, `usageEvent` had exactly one writer and it was a
 * client-callable endpoint, so `used` was permanently 0 and both membership
 * pages rendered 0% forever. This exercises the server-side helpers against
 * the real database and asserts the two invariants that matter:
 *
 *   1. recordUsage writes, and usedThisPeriod reads it back
 *   2. checkQuota reflects the GRANTED plan, not the stored request -- an unpaid
 *      plan must not buy headroom, which is the same rule effectivePlan() exists
 *      to enforce
 *
 * ── 2026-10-18：從 Prisma 改成 Neon HTTP ──────────────────────
 *
 * 這支以前是死掉的：`await import("@/lib/prisma")` 指的是一個
 * 2026-10-06 遷到 Neon 之後就被刪掉的檔案。
 *
 * 但**被測的程式碼是活的** —— `src/lib/usage.ts` 早就自己改成
 * `@/lib/db-http`。所以死的只有這支測試的 fixture 層，不是它想證明的東西。
 *
 * 因此改的是「怎麼插資料／讀資料」，不是「要證明什麼」。
 * 11 條斷言一條都沒刪、沒改鬆。
 *
 * ⚠️ 為什麼是 Neon HTTP 而不是把 Prisma 裝回來：
 *    Workers 拒絕 Prisma 7 的 WASM query compiler（db-http.ts 檔頭有實測紀錄）。
 *    測試要能在 Worker 相容的環境跑，就不能用 Prisma。
 *
 * Usage: node_modules\.bin\jiti.cmd scripts\test-usage-metering.ts
 */
import "./_boot";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

function loadEnv(file = ".env") {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadEnv();

const RUN = `metering-test-${Date.now()}`;

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

/** Neon 的 "User".id 沒有資料庫端預設值（Prisma 的 cuid 是客戶端產生的）。 */
const cuid = () => randomUUID();

async function main() {
  const { recordUsage, usedThisPeriod, checkQuota, quotaMessage } = await import("@/lib/usage");
  const { QUOTAS, effectivePlan } = await import("@/lib/plans");
  const { query, queryOne } = await import("@/lib/db-http");

  // ── fixture 輔助層（取代 prisma 的 db.* 呼叫）──────────────
  // 全部用參數化佔位符。$1 $2 … 會送到 Neon 的協議層綁定。
  const createUser = async () => {
    const id = cuid();
    await query(`INSERT INTO "User" (id, username, name, "publicPage") VALUES ($1,$2,$3,false)`, [
      id, RUN, "metering test",
    ]);
    return id;
  };
  const addUsage = (userId: string, quantity: number, note: string, createdAt?: Date) =>
    query(
      `INSERT INTO "UsageEvent" (id, "userId", metric, quantity, note, "createdAt")
       VALUES ($1,$2,'caption_minutes',$3,$4,COALESCE($5, now()))`,
      [cuid(), userId, quantity, note, createdAt ?? null],
    );
  const countUsage = async (userId: string) => {
    const r = await queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM "UsageEvent" WHERE "userId" = $1`, [userId]);
    return r?.n ?? 0;
  };
  const setSub = (userId: string, planKey: string, status: string) =>
    query(
      `INSERT INTO "Subscription" (id, "userId", "planKey", "billingMode", status)
       VALUES ($1,$2,$3,'monthly',$4)
       ON CONFLICT ("userId") DO UPDATE SET "planKey" = EXCLUDED."planKey", status = EXCLUDED.status`,
      [cuid(), userId, planKey, status],
    );

  // Isolated account so we never touch a real user's ledger.
  const userId = await createUser();

  try {
    // ---- 1. recordUsage actually writes, and reads back -------------
    const before = await usedThisPeriod(userId, "caption_minutes");
    check("fresh account starts at zero", before === 0, String(before));

    await recordUsage(userId, "caption_minutes", 3.4, "unit test");
    const after = await usedThisPeriod(userId, "caption_minutes");
    check("recordUsage is visible to usedThisPeriod", Math.round(after) === 3, String(after));

    // ---- 2. recordUsage never throws into the caller ----------------
    await recordUsage(userId, "caption_minutes", 0, "zero is skipped");
    const unchanged = await usedThisPeriod(userId, "caption_minutes");
    check("zero quantity is a no-op", Math.round(unchanged) === 3, String(unchanged));

    await recordUsage(userId, "caption_minutes", 1e9, "clamped");
    const clamped = await usedThisPeriod(userId, "caption_minutes");
    check("absurd quantity is clamped, not stored raw", clamped < 1e6, String(clamped));

    // Drop the clamp/zero rows so the at-limit assertions below start clean.
    await query(`DELETE FROM "UsageEvent" WHERE "userId"=$1 AND metric='caption_minutes' AND note = ANY($2)`,
      [userId, ["clamped", "unit test"]]);

    // ---- 3. period filter excludes other months ---------------------
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    await addUsage(userId, 9999, "old period", lastMonth);
    const stillCurrent = await usedThisPeriod(userId, "caption_minutes");
    check(
      "last month's usage does not count",
      stillCurrent < 9999,
      `current period total ${stillCurrent}, last month added 9999`
    );

    // ---- 4. no subscription -> free limits --------------------------
    const freeCheck = await checkQuota(userId, "overlay", 1);
    const freeLimit = QUOTAS.free.find((q) => q.metric === "overlay")!.limit;
    check("account without a subscription gets free limits", freeCheck.limit === freeLimit, `${freeCheck.limit} vs ${freeLimit}`);

    // ---- 5. an UNPAID plan buys no headroom -------------------------
    await setSub(userId, "studio", "pending");
    const unpaid = await checkQuota(userId, "overlay", 1);
    check(
      "pending studio still gets free overlay limit",
      unpaid.limit === freeLimit,
      `limit ${unpaid.limit}, studio would be ${QUOTAS.studio.find((q) => q.metric === "overlay")!.limit}`
    );

    // ---- 6. a paid plan does raise the ceiling ----------------------
    await setSub(userId, "studio", "active");
    const paid = await checkQuota(userId, "overlay", 1);
    const studioLimit = QUOTAS.studio.find((q) => q.metric === "overlay")!.limit;
    check("active studio gets studio limits", paid.limit === studioLimit, `${paid.limit} vs ${studioLimit}`);

    // ---- 7. over-quota actually blocks ------------------------------
    const captionLimit = QUOTAS.studio.find((q) => q.metric === "caption_minutes")!.limit;
    await addUsage(userId, captionLimit, "");
    const blocked = await checkQuota(userId, "caption_minutes", 60);
    check("request past the limit is blocked", blocked.allowed === false, `${blocked.used}/${blocked.limit}`);
    const stillOk = await checkQuota(userId, "caption_minutes", 0);
    check("a zero-size request at the limit is allowed", stillOk.allowed === true, `${stillOk.used}/${stillOk.limit}`);

    // ---- 8. unmetered metric does not brick a feature ---------------
    const unknown = await checkQuota(userId, "not_a_real_metric", 999);
    check("unknown metric is unmetered, not blocked", unknown.allowed === true && unknown.unmetered === true);

    // ---- 9. the 429 message names the limit -------------------------
    const msg = quotaMessage("caption_minutes", blocked, " 分鐘");
    check("quota message names the metric and the numbers", msg.includes("字幕") && msg.includes(String(captionLimit)), msg.slice(0, 60));

    // ---- 10. effectivePlan still matches ----------------------------
    check("effectivePlan: pending -> free", effectivePlan({ planKey: "pro", status: "pending" }) === "free");
    check("effectivePlan: active -> pro", effectivePlan({ planKey: "pro", status: "active" }) === "pro");
    check("effectivePlan: trialing -> pro", effectivePlan({ planKey: "pro", status: "trialing" }) === "pro");
    check("effectivePlan: null -> free", effectivePlan(null) === "free");

    // ---- 11. client can no longer write usage -----------------------
    // The invariant is "a client cannot insert usage rows", not a specific
    // status: 401 means the request never resolved a user, 410 means it reached
    // the route and was rejected there. Both are refusals.
    const rowsBefore = await countUsage(userId);
    const clientWrite = await fetch(
      `${process.env.APP_URL ?? "http://localhost:3000"}/api/v1/membership`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: `sf_session=${RUN}` },
        body: JSON.stringify({ _meta: "recordUsage", metric: "caption_minutes", quantity: 10 }),
      }
    ).catch(() => null);
    if (clientWrite) {
      check(
        "client cannot write usage (non-2xx)",
        clientWrite.status === 401 || clientWrite.status === 410,
        `status ${clientWrite.status}`
      );
    } else {
      console.log("SKIP  no server running; the 410 branch in the route is the fallback");
    }

    const leaked = await countUsage(userId);
    check("no row was written by the client attempt", leaked === rowsBefore, `${rowsBefore} -> ${leaked}`);
  } finally {
    await query(`DELETE FROM "UsageEvent" WHERE "userId" = $1`, [userId]);
    await query(`DELETE FROM "Subscription" WHERE "userId" = $1`, [userId]);
    await query(`DELETE FROM "User" WHERE id = $1`, [userId]);
  }
}

main()
  .catch((e) => { console.error("probe failed:", e); failures++; })
  .finally(() => {
    console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
    process.exit(failures === 0 ? 0 : 1);
  });
