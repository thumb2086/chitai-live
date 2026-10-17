/**
 * Smoke-tests the captions transcribe endpoint: silence gate, real transcription,
 * and the hallucination filter.
 *
 * De-duplication of overlapping windows is NOT tested here — that happens on the
 * client via mergeCaption (src/lib/caption-merge.ts) and is covered by
 * test-caption-merge.ts.
 *
 * Usage: node scripts/test-captions.mjs [baseUrl] [sessionId]
 */
const base = process.argv[2] || "http://localhost:3000";
const sid = process.argv[3] || "dev-session-1";
const cookie = `sf_session=${sid}`;

const health = await (await fetch(`${base}/api/v1/captions/transcribe`)).json();
console.log("router:", JSON.stringify(health));
if (!health.configured) {
  console.log("FAIL: router not configured — set GROQ_ROUTER_KEY（網址走 STT_PROXY_URL，預設 https://stt.twonline.dpdns.org/v1）");
  process.exit(1);
}

const tone = makeTone(2.4);
const quiet = Buffer.alloc(16000 * 2.4 * 2);

async function send(label, pcm, startMs = 0) {
  const q = new URLSearchParams({ startMs: String(startMs), language: "zh", model: "whisper-large-v3-turbo" });
  const t0 = performance.now();
  const res = await fetch(`${base}/api/v1/captions/transcribe?${q}`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/octet-stream" },
    body: pcm,
  });
  const j = await res.json().catch(() => ({}));
  const round = Math.round(performance.now() - t0);

  let detail;
  if (j.skipped) detail = `skipped(${j.reason}) rms=${(j.rms ?? 0).toFixed(4)}`;
  else if (j.error) detail = `error=${j.error}`;
  else
    detail =
      `upstream=${j.latencyMs}ms segs=${j.segments?.length ?? 0}` +
      (j.segments?.length ? ` span=${j.segments[0].startMs}-${j.segments[j.segments.length - 1].endMs}ms` : " (filtered)") +
      ` text=${JSON.stringify(j.text ?? "")}`;

  console.log(`${label.padEnd(30)} http=${res.status} round=${String(round).padStart(5)}ms  ${detail}`);
  return { j, round };
}

console.log("\n--- silence gate (must skip without spending a request) ---");
const quietRes = await send("quiet 2.4s window", quiet);

console.log("\n--- 440Hz tone (non-speech; the hallucination filter must drop it) ---");
const toneRes = await send("tone 2.4s window", tone);

let failures = 0;
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};

console.log("\n--- checks ---");
check("silence window skipped", quietRes.j.skipped === true);
check("silence gate is fast (<200ms, no upstream call)", quietRes.round < 200, `${quietRes.round}ms`);
check("tone transcribed without error", !toneRes.j.error, toneRes.j.error ?? "");
check(
  "hallucination on non-speech filtered out",
  Array.isArray(toneRes.j.segments) && toneRes.j.segments.length === 0,
  `${toneRes.j.segments?.length ?? "?"} segment(s) survived`
);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

function makeTone(seconds) {
  const n = 16000 * seconds;
  const b = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++)
    b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / 16000) * 1500), i * 2);
  return b;
}
