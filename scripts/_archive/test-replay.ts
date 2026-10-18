/**
 * Verifies replay analysis no longer invents data: the SSRF guard rejects
 * internal addresses, the scorer behaves, and `advance` on an unreachable source
 * fails loudly instead of fabricating placeholder segments.
 *
 * Usage: npx tsx scripts/test-replay.ts
 */
import fs from "node:fs";
import { assertDownloadable, scoreSegment } from "../src/lib/replay-analysis";

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
const check = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};

async function main() {
  const { prisma } = await import("../src/lib/prisma");

  const j = async (url: string, init?: RequestInit) => {
    const res = await fetch(BASE + url, { headers: H, ...init });
    return { status: res.status, body: (await res.json().catch(() => null)) as any };
  };

  console.log("=== SSRF guard ===");
  const blocked = [
    "http://localhost:3000/x.mp4",
    "http://127.0.0.1/x.mp4",
    "https://169.254.169.254/latest/meta-data/",
    "http://10.0.0.5/internal.mp4",
    "http://172.16.4.4/x.mp4",
    "http://192.168.1.1/x.mp4",
    "http://[::1]/x.mp4",
    "http://foo.internal/x.mp4",
    "file:///etc/passwd",
  ];
  for (const u of blocked) {
    let rejected = false;
    try {
      await assertDownloadable(u);
    } catch {
      rejected = true;
    }
    check(`rejects ${u}`, rejected);
  }

  for (const u of ["https://www.youtube.com/watch?v=abc", "https://cdn.example.com/vod.mp4"]) {
    let ok = false;
    try {
      await assertDownloadable(u);
      ok = true;
    } catch {}
    check(`allows ${u}`, ok);
  }

  console.log("\n=== scoring ===");
  const opening = scoreSegment("大家好，今天要告訴你一個重點，這件事為什麼這麼重要？三個數字：100、200、300。", 0, 5);
  const peak = scoreSegment("哈哈哈哈太扯了！破了紀錄！成功了！終於拿到冠軍了！！", 3, 5);
  const quiet = scoreSegment("嗯。", 4, 5);

  check("opening scores higher on hook than a quiet segment", opening.hook > quiet.hook, `${opening.hook} vs ${quiet.hook}`);
  check("peak language scores higher on peak than quiet", peak.peak > quiet.peak, `${peak.peak} vs ${quiet.peak}`);
  check(
    "scores stay within 0-100",
    [opening, peak, quiet].every((s) => [s.hook, s.peak, s.score].every((n) => n >= 0 && n <= 100))
  );
  check("empty transcript does not crash", Number.isFinite(scoreSegment("", 0, 1).score));

  console.log("\n=== advance on an unreachable source ===");
  await prisma.replayJob.deleteMany({ where: { userId: "dev-user-1", title: "replay-smoke-test" } });

  const created = await j("/api/v1/replay-jobs", {
    method: "POST",
    body: JSON.stringify({
      _meta: "create",
      title: "replay-smoke-test",
      replayUrl: "https://unreachable-host-for-test.invalid/nope.mp4",
      language: "zh",
    }),
  });
  const job = (created.body?.jobs ?? []).find((x: any) => x.title === "replay-smoke-test");
  check("job created", Boolean(job), `status ${created.status}`);

  if (job) {
    const adv = await j("/api/v1/replay-jobs", {
      method: "POST",
      body: JSON.stringify({ _meta: "advance", id: job.id }),
    });
    console.log("  advance ->", adv.status, JSON.stringify(adv.body).slice(0, 140));

    const after = (await j("/api/v1/replay-jobs")).body.jobs.find((x: any) => x.id === job.id);
    console.log(
      "  job after ->",
      JSON.stringify({
        status: after?.status,
        progress: after?.progress,
        segments: after?.segments?.length,
        summary: after?.summary,
      }).slice(0, 220)
    );

    check("advance fails loudly", adv.status === 500, `status ${adv.status}`);
    check("job is marked failed, not completed", after?.status === "failed", String(after?.status));
    check("no fabricated segments were written", (after?.segments?.length ?? 0) === 0, `${after?.segments?.length} segments`);

    await prisma.replayJob.deleteMany({ where: { title: "replay-smoke-test" } });
    console.log("cleanup: replay job removed");
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
