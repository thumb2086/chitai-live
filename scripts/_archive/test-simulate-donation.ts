/**
 * Proves the simulate-donation path can no longer inflate public financials.
 *
 * `_meta: "simulate"` used to `increment` User.donationTotal / donationDonors --
 * the lifetime figures /[username] and /donate/[username] render as real money
 * received. One click on a test button permanently changed a visible financial
 * total, and the code above it described that as the intended design ("Totals
 * are server-computed via simulate/confirmed donations only").
 *
 * Needs the server on :3000.
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}

const BASE = process.env.APP_URL ?? "http://localhost:3000";
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

async function main() {
  const { prisma } = await import("@/lib/prisma");
  const db = prisma as any;

  const RUN = `sim-probe-${Date.now()}`;
  const user = await db.user.create({ data: { username: RUN, name: "sim probe", publicPage: false } });
  const session = await db.session.create({ data: { id: `ses_${RUN}`, userId: user.id, platform: "test" } });
  const cookie = `sf_session=${session.id}`;

  const simulate = async (amount: number) => {
    const res = await fetch(`${BASE}/api/v1/donations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ _meta: "simulate", amount }),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) as any };
  };

  try {
    // 1. refused while demo mode is off
    const before = await db.user.findUnique({ where: { id: user.id } });
    const off = await simulate(500);
    check("simulate is refused unless demo mode is on", off.status === 403, `status ${off.status}`);
    const after = await db.user.findUnique({ where: { id: user.id } });
    check(
      "donationTotal is untouched",
      after.donationTotal === before.donationTotal && after.donationTotal === 0,
      `${before.donationTotal} -> ${after.donationTotal}`
    );
    check("donationDonors is untouched", after.donationDonors === 0, String(after.donationDonors));
    check("no ledger row was written", (await db.zixiDonation.count({ where: { userId: user.id } })) === 0);

    // 2. with demo mode on it writes a marked row, still not the money counters
    await db.user.update({ where: { id: user.id }, data: { demoMode: true } });
    const on = await simulate(500);
    check("demo mode allows it", on.status === 200, `status ${on.status}`);

    const after2 = await db.user.findUnique({ where: { id: user.id } });
    check(
      "donationTotal still untouched even with demo mode on",
      after2.donationTotal === 0,
      String(after2.donationTotal)
    );
    check("donationDonors still untouched", after2.donationDonors === 0, String(after2.donationDonors));

    const rows = await db.zixiDonation.findMany({ where: { userId: user.id } });
    check("a marked row was written for the overlay", rows.length === 1, `${rows.length} row(s)`);
    check("the row is identifiable as a test", rows[0]?.txHash === "TEST", rows[0]?.txHash);

    // 3. the goal still advances, so the bar remains testable
    await db.donationGoal.create({ data: { userId: user.id, title: "probe goal", goal: 400, current: 0 } });
    await simulate(150);
    const goal = await db.donationGoal.findFirst({ where: { userId: user.id } });
    check("the goal bar still advances under demo mode", goal.current === 150, String(goal.current));
  } finally {
    await db.zixiDonation.deleteMany({ where: { userId: user.id } });
    await db.donationGoal.deleteMany({ where: { userId: user.id } });
    await db.session.deleteMany({ where: { userId: user.id } });
    await db.user.delete({ where: { id: user.id } });
    console.log("      cleanup: throwaway user, goal and ledger rows removed");
    await prisma.$disconnect();
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("probe failed:", e); process.exit(1); });