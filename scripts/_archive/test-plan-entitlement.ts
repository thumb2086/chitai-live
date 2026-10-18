/**
 * Checks whether a `pending` (unpaid) plan still grants the paid entitlements.
 *
 * QUOTAS is keyed on planKey alone, so if status is not part of the lookup then
 * "choose a plan" is a free upgrade and blocking payInvoice on its own did not
 * close the hole.
 *
 * Usage: npx tsx scripts/test-plan-entitlement.ts
 */
import fs from "node:fs";

function loadEnvFile(file: string) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const v = m[2].trim().replace(/^["']|["']$/g, "");
    if (v && !v.startsWith("[") && !process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvFile(".env.local");
loadEnvFile(".env");

const BASE = "http://localhost:3000";
const H = { Cookie: "sf_session=dev-session-1", "Content-Type": "application/json" };

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const j = async (url: string, init?: RequestInit) => {
    const res = await fetch(BASE + url, { headers: H, ...init });
    return { status: res.status, body: (await res.json().catch(() => null)) as any };
  };

  // Baseline on the free plan.
  await prisma.subscription.deleteMany({ where: { userId: "dev-user-1" } });
  const free = await j("/api/v1/membership");
  const limits = (body: any) => Object.fromEntries((body?.quotas ?? []).map((q: any) => [q.metric, q.limit]));
  const freeLimits = limits(free.body);
  console.log("free  ->", JSON.stringify({ plan: free.body.subscription.planKey, status: free.body.subscription.status, limits: freeLimits }));

  // Pick a paid plan the way the subscription page does.
  const res = await j("/api/v1/membership", {
    method: "POST",
    body: JSON.stringify({ _meta: "changePlan", planKey: "studio", billingMode: "monthly" }),
  });
  const after = res.body;
  const afterLimits = limits(after);
  console.log("after ->", JSON.stringify({
    plan: after?.subscription?.planKey,
    status: after?.subscription?.status,
    limits: afterLimits,
    invoices: after?.invoices?.length,
  }));

  const invoice = (after?.invoices ?? []).find((i: any) => i.status === "pending");
  console.log("pending invoice:", invoice ? `amount ${invoice.amount}` : "none");

  check("an invoice is raised for the paid plan", Boolean(invoice), invoice ? `amount ${invoice.amount}` : "none");
  check("status stays pending", after?.subscription?.status === "pending", String(after?.subscription?.status));

  // The real question: do the paid entitlements apply while unpaid?
  const upgraded = Object.keys(freeLimits).some((k) => (afterLimits[k] ?? 0) > (freeLimits[k] ?? 0));
  check(
    "paid limits are NOT applied while the plan is pending",
    !upgraded,
    Object.keys(freeLimits).map((k) => `${k}: ${freeLimits[k]} -> ${afterLimits[k]}`).join(", ")
  );

  const studioRow = await prisma.subscription.findFirst({ where: { userId: "dev-user-1" } });
  console.log("db row ->", JSON.stringify({ planKey: studioRow?.planKey, status: studioRow?.status }));

  await prisma.subscription.deleteMany({ where: { userId: "dev-user-1" } });
  await prisma.invoice.deleteMany({ where: { userId: "dev-user-1", status: "pending" } });
  console.log("cleanup: subscription + pending invoices removed");

  console.log(
    failures === 0
      ? "\nALL CHECKS PASSED - an unpaid plan grants nothing"
      : `\n${failures} CHECK(S) FAILED - an unpaid plan still grants paid entitlements`
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
