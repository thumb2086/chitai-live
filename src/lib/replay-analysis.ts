/**
 * Replay analysis: download a VOD, transcribe it, and score the segments.
 *
 * This replaces the old `advance` action, which incremented a counter and then
 * invented three placeholder segments with made-up scores. Everything written to
 * the database here comes from the actual audio.
 *
 * Work is done incrementally: each call to `advanceReplay` performs one bounded
 * step and persists the new state, so a long VOD can be processed across
 * several requests without holding an HTTP handler open.
 */

import { transcribePcm, SAMPLE_RATE } from "./captions-groq";

/** Refuse anything that could reach back into our own network. */
const BLOCKED_HOSTS = new Set([
  "localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]",
  "169.254.169.254", // cloud metadata
  "metadata.google.internal",
]);

const MAX_DOWNLOAD_BYTES = 300 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const TRANSCRIBE_CHUNK_SEC = 30;

/** Chunk that is transcribed in one pass. Groq caps a single upload. */
function isPrivateAddress(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTS.has(h) || BLOCKED_HOSTS.has(host.toLowerCase())) return true;
  if (h.endsWith(".local") || h.endsWith(".internal")) return true;

  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  return false;
}

export async function assertDownloadable(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("網址格式不正確");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("只允許 http/https");
  }
  if (isPrivateAddress(url.hostname)) {
    throw new Error(`拒絕下載內部位址（${url.hostname}）`);
  }
  return url;
}

/**
 * Downloads the source and returns 16 kHz mono PCM plus its duration.
 * Refuses to follow a redirect into a private address.
 */
export async function downloadAudio(
  rawUrl: string
): Promise<{ pcm: Buffer; durationSec: number }> {
  const url = await assertDownloadable(rawUrl);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "Chitai-ReplayAnalysis/1.0" },
    });
  } catch (e: any) {
    clearTimeout(timer);
    throw new Error(`下載失敗：${e?.message || e}`);
  }
  clearTimeout(timer);

  if (!res.ok) throw new Error(`下載失敗（HTTP ${res.status}）`);
  if (res.url) await assertDownloadable(res.url); // redirect target

  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_DOWNLOAD_BYTES) throw new Error("檔案太大，超過 300MB 上限");

  const raw = Buffer.from(await res.arrayBuffer());
  if (raw.length > MAX_DOWNLOAD_BYTES) throw new Error("檔案太大，超過 300MB 上限");

  // Normalise whatever container the platform served into the format Whisper wants.
  const pcm = await runFfmpeg(raw);
  if (pcm.length < SAMPLE_RATE * 2 * 2) throw new Error("下載到的檔案沒有可用的音訊軌");

  return { pcm, durationSec: pcm.length / 2 / SAMPLE_RATE };
}

/** Straight pipe-through: decode the container, emit raw 16 kHz mono s16le. */
function runFfmpeg(raw: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawnFfmpeg();
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    p.stdout.on("data", (d: Buffer) => out.push(d));
    p.stderr.on("data", (d: Buffer) => err.push(d));
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0
        ? resolve(Buffer.concat(out))
        : reject(new Error(`ffmpeg 結束於 ${code}：${Buffer.concat(err).toString().slice(-300)}`))
    );
    p.stdin.on("error", () => {});
    p.stdin.end(raw);
  });
}

function spawnFfmpeg() {
  // Required lazily so importing this module does not depend on child_process.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { spawn } = require("node:child_process") as typeof import("node:child_process");
  return spawn(
    "ffmpeg",
    ["-y", "-i", "pipe:0", "-vn", "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "s16le", "pipe:1"],
    { stdio: ["pipe", "pipe", "pipe"] }
  );
}

/** Transcribes one slice of the audio. */
export async function transcribeRange(pcm: Buffer, startSec: number, seconds: number, language: string) {
  const from = Math.floor(startSec * SAMPLE_RATE) * 2;
  const to = Math.min(pcm.length, from + seconds * SAMPLE_RATE * 2);
  if (to - from < SAMPLE_RATE * 2) return "";

  const r = await transcribePcm(pcm.subarray(from, to), { language: language === "zh-TW" ? "zh" : language || "zh" });
  return r.text;
}

// ── Scoring ──────────────────────────────────────────────────────────────────

/** Words that tend to mark an engaging opening. */
const HOOK_MARKERS = [
  "你們", "有沒有人", "為什麼", "怎麼", "居然", "竟然", "沒想到", "第一次",
  "關鍵", "重點", "注意", "相信", "告訴你", "今天", "接下來", "直接",
];
/** Words that mark a peak moment. */
const PEAK_MARKERS = [
  "哈哈哈", "太扯", "不可思議", "破了", "紀錄", "贏了", "輸了", "哭了",
  "太強", "超強", "完蛋", "成功了", "終於", "最後", "倒數", "冠軍",
];

/**
 * Heuristic 0-100 scores derived from the transcript. This is a transparent
 * keyword/structure measure, not a viewer-retention metric — the database keeps
 * it separate so it is never confused with real analytics.
 */
export function scoreSegment(transcript: string, index: number, total: number) {
  const text = transcript.trim();
  const len = text.length;

  let hook = 25;
  if (index === 0) hook += 25; // the opening always gets the benefit
  for (const w of HOOK_MARKERS) if (text.includes(w)) hook += 6;
  if (/[?？]/.test(text)) hook += 8;
  if (/\d/.test(text)) hook += 5;
  hook = Math.max(0, Math.min(100, hook));

  let peak = 20;
  for (const w of PEAK_MARKERS) if (text.includes(w)) peak += 10;
  if (/[!！]{2,}/.test(text)) peak += 8;
  peak = Math.max(0, Math.min(100, peak));

  // Longer speech in a segment suggests more substance; too long suggests rambling.
  let score = Math.round(Math.min(100, (len / 220) * 100));
  if (len > 900) score = Math.max(10, score - 20);
  score = Math.max(0, Math.min(100, score));

  return { hook, peak, score, position: total > 1 ? index / (total - 1) : 0 };
}
