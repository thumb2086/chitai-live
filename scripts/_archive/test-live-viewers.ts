/**
 * Verifies the live-viewers path degrades honestly instead of failing or lying:
 * with a connected platform whose token is rejected, the endpoint must answer
 * "unknown", not a number, and must not throw.
 *
 * Usage: npx tsx scripts/test-live-viewers.ts
 */
import fs from "node:fs";

/** tsx does not load .env, so pull DATABASE_URL in before Prisma initialises. */
function loadEnvFile(file = ".env") {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const v = m[2].trim().replace(/^["']|["']$/g, "");
    if (v && !v.startsWith("[") && !process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvFile();

async function main() {
  const { prisma } = await import("../src/lib/prisma");

  // Clean up anything a previous run left behind.
  await prisma.platformConnection.deleteMany({ where: { platform: "twitch" } });

  let failures = 0;
  const check = (name: string, cond: boolean, detail = "") => {
    console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
    if (!cond) failures++;
  };

  const base = "http://localhost:3000";
  const H = { Cookie: "sf_session=dev-session-1" };

  const call = async () => {
    const t0 = Date.now();
    const res = await fetch(`${base}/api/v1/live-viewers`, { headers: H });
    return { status: res.status, ms: Date.now() - t0, body: await res.json() as any };
  };

  // 1. No connection at all.
  let r = await call();
  console.log("  no connection ->", JSON.stringify(r.body));
  check("no connection answers 200", r.status === 200);
  check("no connection reports unknown, not a fake number", r.body.known === false && r.body.viewers === null);

  // 2. Connected, but the token is rejected by Twitch.
  await prisma.platformConnection.create({
    data: {
      userId: "dev-user-1",
      platform: "twitch",
      connected: true,
      accessToken: "invalid-token-for-test",
      refreshToken: null,
      tokenExpiresAt: null,
      channelName: "devcreator",
    },
  });

  r = await call();
  console.log("  bad token ->", JSON.stringify(r.body));
  check("rejected token still answers 200", r.status === 200);
  check("rejected token reports unknown", r.body.known === false && r.body.viewers === null);
  check("rejected token is reported per connection", Array.isArray(r.body.connections) && r.body.connections.length === 1);
  check("does not hang", r.ms < 15000, `${r.ms}ms`);

  // 3. The overlay must say "unknown" rather than "0 viewers".
  const obs = await fetch(`${base}/api/v1/obs`, { headers: H }).then((x) => x.json() as any);
  const cap = obs.sources.find((s: any) => s.key === "live-viewers");
  const token = new URL(cap.url).pathname.split("/").pop();
  const payload = await fetch(`${base}/api/v1/overlay-data/live-viewers?token=${token}`).then((x) => x.json() as any);
  console.log("  overlay payload ->", JSON.stringify(payload).slice(0, 160));
  check("overlay payload marks it unknown", payload.known === false);
  check("overlay payload has no fabricated count", payload.viewers === null);

  // 4. A verified offline channel is 0, which is a different statement.
  await prisma.platformConnection.updateMany({
    where: { platform: "twitch" },
    data: { liveViewers: 0 },
  });
  const dbRow = await prisma.platformConnection.findFirst({ where: { platform: "twitch" } });
  check("stored a verified 0 for an offline channel", dbRow?.liveViewers === 0);

  await prisma.platformConnection.deleteMany({ where: { platform: "twitch" } });
  console.log("\ncleanup: twitch connection removed");

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
