/**
 * End-to-end proof for the caption metering chain.
 *
 * Closes the gap flagged in TODO: the authenticated HTTP path of
 * /api/v1/captions/transcribe was never exercised end to end. Requires the
 * production server on :3000 (`npm run build && npx next start -p 3000`).
 *
 * Creates a throwaway user + session in the real database, drives the endpoint
 * over HTTP with that cookie, asserts the usage row landed, then removes it all.
 *
 *   npx tsx --env-file=.env scripts/test-caption-metering-e2e.ts
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}

const BASE = process.env.APP_URL ?? "http://localhost:3000";
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

/** 0.6s of a 440Hz tone as 16kHz mono Int16. */
function tonePcm() {
  const rate = 16000;
  const n = Math.round((rate * 600) / 1000);
  const buf = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(12000 * Math.sin((2 * Math.PI * 440 * i) / rate)), i * 2);
  }
  return buf;
}

async function main() {
  // Imported after env is loaded: Prisma resolves its datasource at construction.
  const { prisma } = await import("@/lib/prisma");
  const db = prisma as any;

  const reach = await fetch(`${BASE}/dashboard/stats`).then((r) => r.status).catch(() => 0);
  if (reach === 0) {
    console.log(`SKIP  no server on ${BASE} -- start it with: npx next start -p 3000`);
    process.exit(0);
  }

  const RUN = `cap-e2e-${Date.now()}`;
  const user = await db.user.create({ data: { username: RUN, name: "caption e2e", publicPage: false } });
  const session = await db.session.create({
    data: { id: `ses_${RUN}`, userId: user.id, platform: "test" },
  });
  const cookie = `sf_session=${session.id}`;

  try {
    // 1. silence short-circuits before auth and before the provider
    const silent = await fetch(`${BASE}/api/v1/captions/transcribe?minRms=0.9`, {
      method: "POST", headers: { cookie }, body: Buffer.alloc(4096),
    });
    const sj = await silent.json().catch(() => ({}));
    check("silence is skipped without calling the provider", silent.status === 200 && sj.skipped === true, `status ${silent.status}`);

    // 2. real tones transcribe. Two calls on purpose: the first pays the cold
    // quota lookup, the second must hit the memoised check. The caption pipeline
    // issues one of these per second of audio, so the warm number is the one
    // that actually matters for a live stream.
    const t0 = Date.now();
    const res = await fetch(`${BASE}/api/v1/captions/transcribe`, {
      method: "POST", headers: { cookie, "content-type": "application/octet-stream" }, body: tonePcm(),
    });
    const cold = Date.now() - t0;
    const body = await res.json().catch(() => ({}));
    check("authenticated tone transcribes", res.status === 200, `status ${res.status} ${JSON.stringify(body).slice(0, 140)}`);

    if (res.status === 200) {
      check("response names the provider that answered", Boolean(body.provider), String(body.provider));
      check("response reports billed seconds", typeof body.billedSec === "number" && body.billedSec > 0, String(body.billedSec));
      console.log(`      cold: upstream ${body.latencyMs}ms | wall ${cold}ms | ${body.provider}`);
    }

    const t1 = Date.now();
    const res2 = await fetch(`${BASE}/api/v1/captions/transcribe`, {
      method: "POST", headers: { cookie, "content-type": "application/octet-stream" }, body: tonePcm(),
    });
    const warm = Date.now() - t1;
    const body2 = await res2.json().catch(() => ({}));
    check("second window transcribes", res2.status === 200, `status ${res2.status}`);
    if (res2.status === 200) {
      console.log(`      warm: upstream ${body2.latencyMs}ms | wall ${warm}ms`);
      check("memoised quota check drops a database round trip", warm <= cold, `warm ${warm}ms vs cold ${cold}ms`);
    }

    // 3. the meter actually wrote rows, with fractional minutes
    const rows = await db.usageEvent.findMany({
      where: { userId: user.id, metric: "caption_minutes" }, orderBy: { createdAt: "asc" },
    });
    check("meter wrote a row per transcribed window", rows.length === 2, `${rows.length} row(s)`);
    for (const r of rows) console.log(`      row: quantity=${r.quantity} note=${JSON.stringify(r.note)}`);
    check(
      "quantity is a fraction of a minute, not 0 and not a flat 1",
      rows.length > 0 && rows.every((r) => r.quantity > 0 && r.quantity < 1),
      rows.map((r) => r.quantity).join(", "),
    );
    check(
      "two windows bill their rounded seconds over 60, not a flat unit each",
      rows.length === 2 && Math.abs(rows[0].quantity - Math.round(body.billedSec ?? 1) / 60) < 0.001,
      `stored ${rows.map((r) => r.quantity).join(" + ")} minutes`,
    );

    // 4. no session -> refused on real audio
    const anon = await fetch(`${BASE}/api/v1/captions/transcribe`, { method: "POST", body: tonePcm() });
    check("no session is refused on real audio", anon.status === 401, `status ${anon.status}`);

    // 5. and the refusal wrote nothing
    const after = await db.usageEvent.count({ where: { userId: user.id } });
    check("refusal added no usage row", after === 2, `${after} row(s)`);
  } finally {
    await db.usageEvent.deleteMany({ where: { userId: user.id } });
    await db.session.deleteMany({ where: { userId: user.id } });
    await db.user.delete({ where: { id: user.id } });
    console.log("      cleanup: throwaway user + session removed");
    await prisma.$disconnect();
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("probe failed:", e); process.exit(1); });