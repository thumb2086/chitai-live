/**
 * Regression checks for the 2026-10-18 audit.
 *
 * Each section prints PASS/FAIL independently so one fix can be reverted and
 * re-checked in isolation.
 *
 * Usage: npx tsx scripts/test-audit-regressions.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createSseStream, clientCount } from "../src/lib/caption-sse";
import { providerHost } from "../src/lib/captions-groq";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`);
  if (!ok) failures++;
}

/* -- 1. dead ZIXI hosts must not appear in executable source ----------------
 * zixi-casino-api.onrender.com is dead (20s timeout, verified 2026-10-13/14).
 * Every backend endpoint resolves through src/lib/zixi-endpoints.ts. Comments
 * may still name it -- that is where the history lives.
 */
const DEAD_HOST = "zixi-casino-api.onrender.com";

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

/** Drops // and block comments so only executable code is inspected. */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

console.log("--- 1. dead host hardcoded in executable source ---");
{
  const offenders: string[] = [];
  for (const f of walk("src")) {
    if (f.startsWith(join("src", "generated"))) continue;
    codeOnly(readFileSync(f, "utf8"))
      .split("\n")
      .forEach((line, i) => {
        if (line.includes(DEAD_HOST)) offenders.push(`${f}:${i + 1}`);
      });
  }
  check(
    `no executable reference to ${DEAD_HOST}`,
    offenders.length === 0,
    offenders.join(", ")
  );
}

/* -- 2. SSE client is released when the consumer cancels --------------------
 * GET /api/v1/captions/stream registered cleanup on req.signal "abort" only.
 * A ReadableStream consumer that calls cancel() -- which is how a dropped
 * connection surfaces in the Node/Workers adapter -- never fires abort, so the
 * entry stayed in the global clients Map forever: one leaked controller per
 * reconnect, and broadcast() kept enqueueing into dead controllers.
 */
console.log("\n--- 2. SSE stream cancel releases the client ---");
{
  const userId = "audit-user";
  const ac = new AbortController();

  const stream = createSseStream(userId, ac.signal);
  check("client registered on open", clientCount(userId) === 1, `count=${clientCount(userId)}`);

  stream.cancel().then(() => {
    check("client released after cancel()", clientCount(userId) === 0, `count=${clientCount(userId)}`);

    // The abort path must keep working too.
    const ac2 = new AbortController();
    createSseStream(userId, ac2.signal);
    check("second client registered", clientCount(userId) === 1, `count=${clientCount(userId)}`);
    ac2.abort();
    check("client released after abort", clientCount(userId) === 0, `count=${clientCount(userId)}`);
  });
}

/* -- 3. diagnostics report the host that is actually transcoding -------------
 * Transcription moved from GROQ_ROUTER_URL to STT_PROXY_URL, but the
 * diagnostics endpoint kept reading GROQ_ROUTER_URL, so it named a host that
 * was never in the chain.
 *
 * The host must be reported even when the provider's *key* is missing --
 * "URL is set, key is not" is exactly the state you open this page to debug,
 * and returning null there hides half the answer.
 */
console.log("\n--- 3. providerHost reports the configured STT proxy ---");
{
  const saved = { ...process.env };

  process.env.STT_PROXY_URL = "https://stt.twonline.dpdns.org/v1";
  delete process.env.GROQ_API_KEY;
  delete process.env.GROQ_ROUTER_KEY;
  check(
    "router host reported with no keys configured at all",
    providerHost("router") === "stt.twonline.dpdns.org",
    String(providerHost("router"))
  );

  process.env.GROQ_ROUTER_KEY = "ak_test";
  check(
    "router host unchanged once the key is present",
    providerHost("router") === "stt.twonline.dpdns.org",
    String(providerHost("router"))
  );

  // A malformed URL must not take the diagnostics page down -- that is the one
  // time the page matters.
  process.env.STT_PROXY_URL = "stt.twonline.dpdns.org/v1"; // forgot https://
  let threw = false;
  let val: string | null = "unset";
  try {
    val = providerHost("router");
  } catch {
    threw = true;
  }
  check("malformed STT_PROXY_URL returns null instead of throwing", !threw && val === null, String(val));

  process.env = saved;
}

process.on("exit", () => {
  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exitCode = failures === 0 ? 0 : 1;
});