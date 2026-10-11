"use client";

/**
 * Live captions capture for the browser.
 *
 * Latency strategy: audio is cut into overlapping windows (windowMs long,
 * stepMs apart) and each window is transcribed independently, so a phrase is on
 * screen roughly one step after it was spoken instead of one full window.
 *
 * Groq only returns segment-level timestamps, and a segment normally spans the
 * whole window, so overlapping windows re-transcribe the same words. De-dup is
 * therefore done on the text: every response is joined onto the current line
 * with `mergeCaption`, which strips the overlapping tail. Up to `MAX_IN_FLIGHT`
 * windows are in flight at once — the Groq router holds a pool of keys, so
 * parallel requests do not serialise.
 */

import { mergeCaption } from "./caption-merge";
import { createLocalCaptions, type LocalCaptions } from "./captions-local";

export const TARGET_RATE = 16000;
export const WINDOW_MS = 2400;
export const STEP_MS = 1200;
const MAX_IN_FLIGHT = 2;
/** Below this the window is treated as silence and no request is spent. */
const MIN_RMS = 0.006;

/**
 * `local` streams straight to a daemon on this machine (sherpa-onnx x-asr).
 * It needs neither the windowing below nor Groq, so it takes a separate path
 * in `start()` — see `captions-local.ts`.
 */
export type Engine = "groq" | "browser" | "local";
export type LiveSegment = { startMs: number; endMs: number; text: string };
export type LiveState = "idle" | "listening" | "transcribing" | "error";

export type LiveCaptionsOptions = {
  engine: Engine;
  language: string;
  model?: "whisper-large-v3-turbo" | "whisper-large-v3";
  /**
   * Latency vs accuracy. A short window/step keeps captions close to real time
   * but transcribes the audio near a boundary more than once, so Whisper errs
   * more often there. Longer windows are steadier but add delay.
   */
  windowMs?: number;
  stepMs?: number;
  onSegment: (seg: LiveSegment) => void;
  onStatus?: (s: { state: LiveState; detail?: string }) => void;
  onLevel?: (rms: number) => void;
  /** Live preview line, replaced wholesale on each update. */
  onPartial?: (text: string) => void;
  /** Daemon endpoint for the `local` engine. */
  wsUrl?: string;
  /** Server-measured timing for each window, so the UI shows real numbers. */
  onMetrics?: (m: {
    provider: string;
    /**
     * Groq: one window's server round-trip. Local: wall time since the socket
     * opened, which keeps climbing for the whole take — prefer `firstTokenMs`.
     */
    latencyMs: number;
    /** Local engine only: time until the first token arrived. */
    firstTokenMs?: number;
    windowMs?: number;
    fellBack?: boolean;
    fellBackFrom?: string;
    failReason?: string;
  }) => void;
};

/** Map a BCP-47 tag to the ISO-639-1 code Whisper expects. */
function isoToWhisper(lang: string) {
  if (lang.startsWith("zh")) return "zh";
  if (lang.startsWith("ja")) return "ja";
  if (lang.startsWith("ko")) return "ko";
  return lang.split("-")[0] || "zh";
}

/** Float32 -1..1 → Int16, matching what the local daemon expects on the wire. */
function toInt16(f32: Float32Array): Int16Array {
  const pcm = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const v = Math.max(-1, Math.min(1, f32[i]));
    pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return pcm;
}

const WORKLET_SRC = `
class CaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) this.port.postMessage(new Float32Array(ch));
    return true;
  }
}
registerProcessor('sf-capture', CaptureProcessor);
`;

export type LiveCaptions = { start: () => Promise<void>; stop: () => void };

export function createLiveCaptions(opts: LiveCaptionsOptions): LiveCaptions {
  let ctx: AudioContext | null = null;
  let stream: MediaStream | null = null;
  let node: AudioNode | null = null;
  let workletUrl: string | null = null;
  let running = false;

  let ring = new Int16Array(TARGET_RATE * 5);
  let ringLen = 0;
  let streamMs = 0;
  let lastSentStart = -1;
  let inFlight = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  /** Text of the caption line being assembled; fragments are merged onto it. */
  let line = "";
  /** Recognizer instance when running in Browser STT mode. */
  let recognizer: any = null;
  /** Streaming session when running in Local mode. */
  let local: LocalCaptions | null = null;

  const WINDOW = Math.max(800, opts.windowMs ?? WINDOW_MS);
  const STEP = Math.max(400, Math.min(opts.stepMs ?? STEP_MS, WINDOW - 400));

  const resample = (input: Float32Array): Float32Array => {
    if (ctx!.sampleRate === TARGET_RATE) return input;
    const ratio = ctx!.sampleRate / TARGET_RATE;
    const out = new Float32Array(Math.floor(input.length / ratio));
    for (let i = 0; i < out.length; i++) {
      const pos = i * ratio;
      const i0 = Math.floor(pos);
      const i1 = Math.min(input.length - 1, i0 + 1);
      const t = pos - i0;
      out[i] = input[i0] * (1 - t) + input[i1] * t;
    }
    return out;
  };

  const push = (f32: Float32Array) => {
    const pcm = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
      const v = Math.max(-1, Math.min(1, f32[i]));
      pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }
    if (ringLen + pcm.length > ring.length) {
      const keep = ringLen - (ringLen + pcm.length - ring.length);
      ring.copyWithin(0, ringLen - keep, ringLen);
      ringLen = keep;
    }
    ring.set(pcm, ringLen);
    ringLen += pcm.length;
    streamMs += (f32.length / (ctx!.sampleRate || TARGET_RATE)) * 1000;
  };

  const rms = (from: number, to: number) => {
    let sum = 0;
    const n = to - from;
    if (n <= 0) return 0;
    for (let i = from; i < to; i++) {
      const v = ring[i] / 32768;
      sum += v * v;
    }
    return Math.sqrt(sum / n);
  };

  /** Fold a freshly transcribed fragment into the current line. */
  const commit = (text: string, seg: LiveSegment) => {
    const fresh = mergeCaption(line, text);
    if (!fresh) return;
    line += fresh;
    opts.onSegment({ startMs: seg.startMs, endMs: seg.endMs, text: fresh });
  };

  const submitWindow = async () => {
    // Local mode streams continuously; there is no window to submit.
    if (!running || opts.engine !== "groq") return;

    const windowSamples = Math.floor((WINDOW / 1000) * TARGET_RATE);
    if (ringLen < windowSamples * 0.6) return; // not enough buffered yet
    if (inFlight >= MAX_IN_FLIGHT) return;

    const startMs = Math.max(0, streamMs - WINDOW);
    if (startMs <= lastSentStart) return;
    lastSentStart = startMs;

    const slice = Buffer.from(ring.slice(ringLen - windowSamples, ringLen).buffer);
    const level = rms(ringLen - windowSamples, ringLen);
    opts.onLevel?.(level);
    if (level < MIN_RMS) return; // silence: don't burn a request

    inFlight++;
    opts.onStatus?.({ state: "transcribing" });

    try {
      const q = new URLSearchParams({
        startMs: String(Math.round(startMs)),
        language: isoToWhisper(opts.language),
        model: opts.model ?? "whisper-large-v3-turbo",
      });
      const res = await fetch(`/api/v1/captions/transcribe?${q}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: slice,
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && typeof data.latencyMs === "number") {
        opts.onMetrics?.({
          provider: String(data.provider ?? "?"),
          latencyMs: data.latencyMs,
          windowMs: data.windowMs ?? WINDOW,
          ...(data.fellBackFrom
            ? { fellBack: true, fellBackFrom: String(data.fellBackFrom), failReason: String(data.failReason ?? "") }
            : {}),
        });
      }
      if (res.ok && Array.isArray(data.segments)) {
        for (const s of data.segments as LiveSegment[]) {
          if (!s.text?.trim()) continue;
          commit(s.text, s);
        }
      }
      opts.onStatus?.({ state: "listening" });
    } catch {
      opts.onStatus?.({ state: "error", detail: "轉寫請求失敗" });
    } finally {
      inFlight--;
    }
  };

  const scheduleNext = () => {
    if (!running) return;
    // Don't arm the window timer for local mode — nothing is submitted that way.
    if (opts.engine === "local") return;
    timer = setTimeout(() => {
      void submitWindow();
      scheduleNext();
    }, STEP);
  };

  const browserLoop = () => {
    const w = window as unknown as {
      SpeechRecognition?: new () => any;
      webkitSpeechRecognition?: new () => any;
    };
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) {
      opts.onStatus?.({ state: "error", detail: "這個瀏覽器不支援語音辨識" });
      return;
    }
    const r = new SR();
    r.lang = opts.language;
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (ev: any) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        const text = String(res[0]?.transcript ?? "").trim();
        if (!text) continue;
        if (res.isFinal) {
          const now = Date.now();
          commit(text, { startMs: now - 1200, endMs: now, text });
        } else {
          interim += text;
        }
      }
      if (interim) opts.onLevel?.(0.02);
    };
    r.onerror = (e: any) => opts.onStatus?.({ state: "error", detail: e?.error ?? "辨識錯誤" });
    r.onend = () => {
      if (running) {
        try {
          r.start();
        } catch {}
      }
    };
    r.start();
    recognizer = r;
  };

  const start = async () => {
    if (running) return;
    running = true;
    opts.onStatus?.({ state: "listening" });

    // Local mode still needs the mic, so it shares the Groq capture path below.
    if (opts.engine === "browser") {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        });
      } catch {
        /* the recognizer grabs the mic itself; a rejection here is not fatal */
      }
      browserLoop();
      return;
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (e: any) {
      running = false;
      opts.onStatus?.({ state: "error", detail: "無法使用麥克風：" + (e?.message || e) });
      return;
    }

    try {
      // Ask for 16k directly; Chrome honours it and saves a resample pass.
      ctx = new AudioContext({ sampleRate: TARGET_RATE });
    } catch {
      ctx = new AudioContext();
    }
    if (ctx.state === "suspended") await ctx.resume();

    const src = ctx.createMediaStreamSource(stream);

    // Local mode forwards every frame straight to the daemon; no ring buffer.
    if (opts.engine === "local") {
      local = createLocalCaptions({
        ...(opts.wsUrl ? { wsUrl: opts.wsUrl } : {}),
        language: opts.language,
        onSegment: opts.onSegment,
        ...(opts.onPartial ? { onPartial: opts.onPartial } : {}),
        ...(opts.onStatus ? { onStatus: opts.onStatus } : {}),
        // ⚠️ 這三個漏掉不會報錯，只是功能默默消失 ——
        //    onMetrics 漏了 → 設定頁的首字延遲永遠是「—」
        //    onLevel  漏了 → 收音音量條永遠空白
        //    兩者都沒有任何錯誤訊息，只能靠看畫面發現。
        ...(opts.onMetrics ? { onMetrics: opts.onMetrics } : {}),
        ...(opts.onLevel ? { onLevel: opts.onLevel } : {}),
      });
      local.ready.catch(() => {
        /* surfaced through onStatus already */
      });
    }

    try {
      workletUrl = URL.createObjectURL(new Blob([WORKLET_SRC], { type: "application/javascript" }));
      await ctx.audioWorklet.addModule(workletUrl);
      const wn = new AudioWorkletNode(ctx, "sf-capture");
      wn.port.onmessage = (e) => {
        const frame = resample(e.data);
        if (local) local.push(toInt16(frame));
        else push(frame);
      };
      src.connect(wn);
      // A worklet only runs while connected to a destination; keep it silent.
      const mute = ctx.createGain();
      mute.gain.value = 0;
      wn.connect(mute).connect(ctx.destination);
      node = wn;
    } catch {
      // Safari / Firefox fallback
      const sp = ctx.createScriptProcessor(4096, 1, 1);
      sp.onaudioprocess = (e) => {
        const frame = resample(new Float32Array(e.inputBuffer.getChannelData(0)));
        if (local) local.push(toInt16(frame));
        else push(frame);
      };
      src.connect(sp);
      const mute = ctx.createGain();
      mute.gain.value = 0;
      sp.connect(mute).connect(ctx.destination);
      node = sp;
    }

    scheduleNext();
  };

  const stop = () => {
    running = false;
    if (timer) clearTimeout(timer);
    timer = null;
    local?.stop();
    local = null;
    if (recognizer) {
      recognizer.onend = null;
      try {
        recognizer.stop();
      } catch {}
      recognizer = null;
    }
    node?.disconnect();
    node = null;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    ctx?.close().catch(() => {});
    ctx = null;
    if (workletUrl) URL.revokeObjectURL(workletUrl);
    workletUrl = null;
    ring = new Int16Array(TARGET_RATE * 5);
    ringLen = 0;
    streamMs = 0;
    lastSentStart = -1;
    inFlight = 0;
    line = "";
    opts.onStatus?.({ state: "idle" });
  };

  return { start, stop };
}