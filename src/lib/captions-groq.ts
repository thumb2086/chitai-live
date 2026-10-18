/**
 * Server-side Groq speech-to-text.
 *
 * Two providers, tried in order:
 *
 *  - `direct` — api.groq.com with a single `gsk_` key. Fastest path: one HTTPS
 *    round trip with no hop in the middle. Set `GROQ_API_KEY` to enable.
 *  - `router` — the creator's own groq-router (Vercel), reached with one `ak_`
 *    credential. Slower (it adds a serverless hop plus a key lookup) but it holds
 *    ~30 Groq keys with round-robin, per-key cooldown and credit accounting, so a
 *    live stream cannot get rate-limited off the air.
 *
 * Measured on this machine, an unauthenticated request costs ~225-350ms to
 * api.groq.com versus ~560-585ms to the router, so direct saves roughly 300ms of
 * fixed overhead per window on top of skipping the router's own work.
 *
 * The router stays in the chain as a fallback so losing the direct key, or
 * hitting its rate limit mid-show, degrades to slower-but-working instead of
 * blank captions on air.
 *
 * Both providers speak the OpenAI Whisper contract, so the client is just a WAV
 * wrap plus a multipart POST.
 */

// Read the environment lazily rather than at module load: tests (and dev server
// restarts after an env edit) need the current values, not the ones that happened
// to be set when this module was first imported.
const directUrl = () => (process.env.GROQ_DIRECT_URL ?? "https://api.groq.com/openai/v1").replace(/\/+$/, "");
const routerKey = () => process.env.GROQ_ROUTER_KEY ?? "";

/**
 * 錄音轉寫專用的代理網址（★ 與 chat/embedding 的 router 分開）。
 *
 * 為什麼要拆開：
 *   groq-router 的 `/api/transcriptions` 已刻意停用 —— STT_LEGACY_ENABLED 不是 "1" 就回
 *   410，body 裡還指名 use_instead 指向 stt.twonline.dpdns.org。
 *   而同一個 groq-router 的 /v1/embeddings 與 /v1/chat/completions 還活著
 *   （rag.ts 用它們）。所以不能改 GROQ_ROUTER_URL，只能另開一個。
 *
 * 實測 2026-10-17：
 *   POST https://vercel-router-khaki.vercel.app/api/transcriptions → 410（已停用）
 *   POST https://stt.twonline.dpdns.org/v1/audio/transcriptions    → 401（活的，要認證）
 */
const sttProxyUrl = () =>
  (process.env.STT_PROXY_URL ?? "https://stt.twonline.dpdns.org/v1").replace(/\/+$/, "");
const directKey = () => process.env.GROQ_API_KEY ?? "";

/**
 * 某個 provider 的 host，給診斷端點顯示「現在實際連到哪一台」。
 *
 * ★ 為什麼不是讓呼叫端自己 new URL()
 *   1. URL 來自環境變數。`STT_PROXY_URL="忘了 https://"` 會讓
 *      `new URL(...)` 丟 TypeError —— 而那正是最需要診斷的時候。
 *   2. 診斷端點必須報**實際轉寫用的那一台**。
 *      2026-10-17 把轉寫從 GROQ_ROUTER_URL 搬到 STT_PROXY_URL 之後，
 *      診斷端點還在報舊變數 —— 於是它顯示的 host 從來不是真的在用的那台。
 *
 * ★ 為什麼不看 providerOrder()
 *   providerOrder() 會濾掉沒有 key 的 provider。但「網址有設、key 沒設」正是
 *   打開這一頁要查的狀態 —— 回 null 等於把要找的答案藏掉一半。
 *   這裡直接問「這家的網址指向哪台」，至於 key 有沒有是 status() 的事。
 *
 * 回 null 表示網址語法壞掉（例如忘了 https://），對顯示就是同一件事。
 */
export function providerHost(id: ProviderId): string | null {
  const url = id === "direct" ? directUrl() : sttProxyUrl();
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}

/** Set to "false" to prefer the router even when a direct key is available. */
const directFirst = () => (process.env.GROQ_DIRECT_FIRST ?? "true").toLowerCase() !== "false";

export const SAMPLE_RATE = 16000;

export type ProviderId = "direct" | "router";

export type Provider = { id: ProviderId; url: string; key: string };

export function providerStatus() {
  const order = providerOrder();
  return {
    direct: Boolean(directKey()),
    router: Boolean(sttProxyUrl() && routerKey()),
    /** The provider that will be tried first. */
    primary: (order[0]?.id ?? null) as ProviderId | null,
    order: order.map((p) => p.id),
  };
}

export function groqConfigured() {
  return providerOrder().length > 0;
}

export function providerOrder(): Provider[] {
  const direct: Provider = { id: "direct", url: directUrl(), key: directKey() };
  const router: Provider = { id: "router", url: sttProxyUrl(), key: routerKey() };
  const usable = [direct, router].filter((p) => p.key && p.url);
  return directFirst() ? usable : usable.slice().reverse();
}

export type GroqSegment = { start: number; end: number; text: string; noSpeechProb: number };
export type TranscribeResult = {
  text: string;
  segments: GroqSegment[];
  durationSec: number;
  /** Milliseconds spent waiting on the upstream provider. */
  latencyMs: number;
  /** Which provider actually served this request. */
  provider: ProviderId;
  /** How many providers had to be tried before one succeeded. */
  attempts: number;
  /** Set when an earlier provider failed and the request fell through. */
  fellBackFrom?: ProviderId;
  failReason?: string;
};

/** Wrap mono 16-bit little-endian PCM in a WAV container. */
export function pcmToWav(pcm: Buffer, sampleRate = SAMPLE_RATE): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // format = PCM
  header.writeUInt16LE(1, 22); // channels = mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** RMS of Int16 PCM — used to skip silent windows before spending a request. */
export function pcmRms(pcm: Buffer): number {
  const n = Math.floor(pcm.length / 2);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = pcm.readInt16LE(i * 2) / 32768;
    sum += v * v;
  }
  return Math.sqrt(sum / n);
}

/**
 * Whisper hallucinates confidently on non-speech audio (music, beeps, silence),
 * producing looping phrases that would flood a live overlay. Drop anything that
 * looks like that before it can reach the screen.
 */
const HALLUCINATION_PATTERNS: RegExp[] = [
  /字幕由/i,
  /請不吝點贊訂轉發打賞支持明鏡與星星欄目/i,
  /謝謝觀看/i,
  /明鏡與星星欄目/i,
  /优优独播剧场/i,
  /YoYo Television Series Exclusive/i,
  /歡迎訂閱/i,
  /請不吝.*(點贊|訂閱|轉發)/i,
  /^[\s.。,，!！?？~～\-—_]*$/,
  /^(.)\1{3,}$/,
];

export function looksLikeHallucination(text: string, noSpeechProb: number): boolean {
  const t = text.trim();
  if (!t) return true;
  // Groq reports confidence that the window contains no speech.
  if (noSpeechProb > 0.6) return true;
  return HALLUCINATION_PATTERNS.some((re) => re.test(t));
}

export type TranscribeOptions = {
  model?: "whisper-large-v3-turbo" | "whisper-large-v3";
  language?: string; // ISO-639-1, e.g. "zh"
  prompt?: string;
  timeoutMs?: number;
};

/** Errors worth trying the next provider for. Status 0 means the request never arrived. */
function isRetryable(status: number) {
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

/** Carries the upstream HTTP status so the caller can decide on failover. */
class UpstreamError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
  }
}

/**
 * Transcribes using the configured provider chain.
 *
 * `providers` is injectable so the failover behaviour can be tested against
 * real endpoints without spawning processes or stubbing the network.
 */
export async function transcribePcm(
  pcm: Buffer,
  opts: TranscribeOptions = {},
  providers: Provider[] = providerOrder()
): Promise<TranscribeResult> {
  if (providers.length === 0) {
    throw new Error("Groq 未設定（需要 GROQ_API_KEY，或 STT_PROXY_URL + GROQ_ROUTER_KEY）");
  }

  const { model = "whisper-large-v3-turbo", language = "zh", prompt = "", timeoutMs = 20000 } = opts;

  let firstError: unknown = null;
  let firstProvider: ProviderId | null = null;
  let firstReason = "";

  for (let i = 0; i < providers.length; i++) {
    const p = providers[i];
    try {
      const res = await postTranscription(p, pcm, { model, language, prompt, timeoutMs });
      return {
        ...res,
        provider: p.id,
        attempts: i + 1,
        ...(firstProvider ? { fellBackFrom: firstProvider, failReason: firstReason } : {}),
      };
    } catch (e: any) {
      if (!firstError) {
        firstError = e;
        firstProvider = p.id;
        firstReason = e?.message || String(e);
      }
      // A 4xx that is not rate limiting means the request itself is wrong, so
      // the next provider would reject it too — surface it instead of retrying.
      if (typeof e?.status === "number" && !isRetryable(e.status)) throw e;
    }
  }

  throw firstError;
}

async function postTranscription(
  p: Provider,
  pcm: Buffer,
  opts: Required<Pick<TranscribeOptions, "model" | "language" | "timeoutMs">> & { prompt: string }
): Promise<Omit<TranscribeResult, "provider" | "attempts">> {
  const wav = pcmToWav(pcm);
  const fd = new FormData();
  fd.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "chunk.wav");
  fd.append("model", opts.model);
  fd.append("response_format", "verbose_json");
  // Greedy decoding: sampling on live audio produces visible flicker.
  fd.append("temperature", "0");
  // Groq is stateless per request, so there is no previous-text conditioning to
  // disable (and `condition_on_previous_text` is rejected with 400 anyway).
  // Repetition is handled by temperature 0 plus the filter in the route.
  fd.append("timestamp_granularities[]", "segment");
  fd.append("language", opts.language);
  if (opts.prompt) fd.append("prompt", opts.prompt);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs);
  const t0 = Date.now();

  let res: Response;
  try {
    res = await fetch(`${p.url}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${p.key}` },
      body: fd,
      signal: ac.signal,
    });
  } catch (e: any) {
    clearTimeout(timer);
    // status 0 marks a network failure, which is always worth failing over on.
    throw new UpstreamError(`無法連線到 ${p.id}：${e?.message || e}`, 0);
  }
  clearTimeout(timer);

  const latencyMs = Date.now() - t0;
  const body = await res.text();

  if (!res.ok) {
    let msg = body.slice(0, 200);
    try {
      msg = JSON.parse(body)?.error?.message ?? msg;
    } catch {}
    throw new UpstreamError(`Groq ${res.status}：${msg}`, res.status);
  }

  let json: any;
  try {
    json = JSON.parse(body);
  } catch {
    throw new UpstreamError("Groq 回應不是合法 JSON", 502);
  }

  const segments: GroqSegment[] = (json.segments ?? [])
    .map((s: any) => ({
      start: Number(s.start) || 0,
      end: Number(s.end) || 0,
      text: String(s.text ?? "").trim(),
      noSpeechProb: Number(s.no_speech_prob ?? 0) || 0,
    }))
    .filter((s: GroqSegment) => s.text);

  return {
    text: String(json.text ?? "").trim(),
    segments,
    durationSec: Number(json.duration) || pcm.length / 2 / SAMPLE_RATE,
    latencyMs,
  };
}
