/**
 * Verifies the EventSub webhook actually authenticates deliveries, because a
 * silent skip here means anyone can put a fake raid on a live stream.
 *
 * Sends a correctly signed message, a tampered one, a replayed one and an
 * unsigned one, and asserts only the first is stored.
 *
 * Usage: npx tsx scripts/test-eventsub-webhook.ts
 */
import fs from "node:fs";
import { createHmac } from "node:crypto";

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

const SECRET = process.env.TWITCH_EVENTSUB_SECRET || "test-secret-not-configured";
const BASE = "http://localhost:3000";
const URL_WITH_USER = `${BASE}/api/webhooks/twitch?user=devcreator`;

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};

function signed(body: string, id: string, ts: string, secret = SECRET) {
  const sig = "sha256=" + createHmac("sha256", secret).update(`${id}${ts}${body}`).digest("hex");
  return {
    "Content-Type": "application/json",
    "twitch-eventsub-message-id": id,
    "twitch-eventsub-message-timestamp": ts,
    "twitch-eventsub-message-signature": sig,
  };
}

function event(id: string, viewer: number) {
  return JSON.stringify({
    subscription: { id: "sub-1", type: "channel.raid", status: "enabled" },
    event: { id, from_user_id: "999", from_user_name: viewer === 1 ? "SmokeTestA" : "SmokeTestB", viewer_count: viewer },
  });
}

async function main() {
  const now = new Date().toISOString();
  const bodyA = event("evt-eventsub-test-a", 1);
  const bodyB = event("evt-eventsub-test-b", 1);

  // 1. Correctly signed delivery is accepted.
  const ok = await fetch(URL_WITH_USER, { method: "POST", headers: signed(bodyA, "msg-a", now), body: bodyA });
  const okJson = await ok.json().catch(() => ({}));
  console.log("  signed delivery ->", ok.status, JSON.stringify(okJson));
  check("accepts a correctly signed event", ok.status === 200);

  // 2. Body tampered after signing -> rejected.
  const tamperedBody = event("evt-eventsub-test-tampered", 1);
  const t = await fetch(URL_WITH_USER, { method: "POST", headers: signed(bodyA, "msg-t", now), body: tamperedBody });
  console.log("  tampered body ->", t.status);
  check("rejects a body edited after signing", t.status === 403, `status ${t.status}`);

  // 3. Wrong secret -> rejected.
  const w = await fetch(URL_WITH_USER, {
    method: "POST",
    headers: signed(bodyB, "msg-w", now, "a-completely-different-secret"),
    body: bodyB,
  });
  console.log("  wrong secret ->", w.status);
  check("rejects a signature made with another secret", w.status === 403, `status ${w.status}`);

  // 4. No signature headers at all -> rejected.
  const u = await fetch(URL_WITH_USER, { method: "POST", headers: { "Content-Type": "application/json" }, body: bodyB });
  console.log("  unsigned ->", u.status);
  check("rejects an unsigned delivery", u.status === 400, `status ${u.status}`);

  // 5. Replay of a stale (but validly signed) message -> rejected.
  const stale = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const s = await fetch(URL_WITH_USER, { method: "POST", headers: signed(bodyB, "msg-s", stale), body: bodyB });
  console.log("  stale replay ->", s.status);
  check("rejects a replayed message outside the retry window", s.status === 403, `status ${s.status}`);

  // 6. Only the legitimate event was stored.
  const { prisma } = await import("../src/lib/prisma");
  const stored = await prisma.eventLog.findMany({
    where: { externalId: { startsWith: "evt-eventsub-test-" } },
    select: { externalId: true, kind: true, actorName: true },
  });
  console.log("  stored ->", JSON.stringify(stored));
  const ids = stored.map((x: any) => x.externalId);
  check("stored exactly the legitimate event", ids.length === 1 && ids[0] === "evt-eventsub-test-a", JSON.stringify(ids));
  check("forged events were not stored", !ids.includes("evt-eventsub-test-tampered"));

  await prisma.eventLog.deleteMany({ where: { externalId: { startsWith: "evt-eventsub-test-" } } });
  console.log("cleanup: test events removed");

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
