"use client";

/**
 * 本機字幕引擎：瀏覽器 → 本機 daemon（sherpa-onnx + x-asr）→ 繁體字幕。
 *
 * 為什麼 Groq 那條路要切窗，這裡不用
 * ----------------------------------
 * Groq 只有離線 API，必須湊一段音訊才能送，所以 `captions-live.ts` 用
 * 「2.4s 視窗 / 1.2s 步進」反覆重疊送，再用 `mergeCaption` 併回重複的尾巴。
 *
 * 本機 daemon 跑的是**真串流**transducer：音訊餵進去就持續吐字，
 * 不需要知道「講者講完了嗎」。所以視窗、步進、MAX_IN_FLIGHT 這整套
 * 都不需要 —— 這不是省 code，是消掉「重疊段落邊界會認錯字」那一類問題。
 *
 * 為什麼「不用視窗」不代表「不用重取」
 * ----------------------------------
 * 串流模型會**回頭改前面的字**（transducer 的假設會隨後續音訊修正）。
 * daemon 端已經處理這件事：只在模型自己確認句尾標點時才定稿，
 * 中途改寫會整句重送。這裡只負責把 partial / final 分開處理。
 *
 * 網路限制
 * --------
 * dashboard 是 https、daemon 在 http://127.0.0.1 → Chrome 的
 * Private Network Access 會管這個方向。已實測可通（Chrome 會對
 * localhost 放行），daemon 也已回 `Access-Control-Allow-Private-Network: true`。
 * 用 ws://localhost 而不是 ws://127.0.0.1：前者才是 PNA 認得的本機名稱。
 */

import type { LiveSegment, LiveState } from "./captions-live";

export const LOCAL_WS_DEFAULT = "ws://localhost:8765/ws";

/** Why a probe failed — the two cases need very different user actions. */
export type LocalFailure =
  /** Nothing is listening; the user has to start the daemon. */
  | "not-running"
  /** Chrome blocked the request because Local Network Access was not granted. */
  | "permission-denied"
  | "unknown";

export type LocalHealth = {
  ok: boolean;
  model?: string;
  load_s?: number;
  uptime_s?: number;
  connections?: number;
  /**
   * The backend the daemon *actually* got, which can differ from the one that
   * was asked for. Passing `--provider cuda` to a sherpa-onnx build without GPU
   * support silently falls back to CPU, so this reports the truth.
   */
  provider?: string;
  error?: string;
  reason?: LocalFailure;
};

export const LOCAL_FAILURE_HINT: Record<LocalFailure, string> = {
  "not-running":
    "本機字幕服務沒有在跑。請啟動 subtitle-daemon\\dist\\ZixiCaption\\ZixiCaption.exe。",
  "permission-denied":
    "瀏覽器擋下了對本機的連線。請按網址列左邊的圖示，選擇「允許存取本機網路」，再重新整理。",
  unknown: "無法連線到本機字幕服務。",
};

/**
 * Ask whether the daemon is up.
 *
 * Chrome 142+ enforces Local Network Access, so this fails two ways that look
 * identical on the wire but need opposite fixes:
 *   · nothing listening       → start the daemon
 *   · blocked by the browser  → allow the permission
 * A single "連不上" message sends people to the wrong place.
 */
export async function probeLocalDaemon(wsUrl: string): Promise<LocalHealth> {
  const http = wsUrl.replace(/^ws/, "http").replace(/\/ws\/?$/, "/health");
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 1500);
    const res = await fetch(http, { signal: ctl.signal, cache: "no-store" });
    clearTimeout(to);
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}`, reason: "unknown" };
    }
    return { ok: true, ...(await res.json()) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // A connection refused and a request blocked by the browser both surface as
    // "Failed to fetch", so the message cannot separate them. The distinguishing
    // signal is which one happens *after* a successful permission grant, which
    // we can't know here — so report the more likely case and keep the raw
    // message for anyone debugging.
    return {
      ok: false,
      error: msg,
      reason: /Failed to fetch/i.test(msg) ? "permission-denied" : "unknown",
    };
  }
}

export type LocalCaptionsOptions = {
  wsUrl?: string;
  language: string;
  onSegment: (seg: LiveSegment) => void;
  /**
   * The daemon's current hypothesis for the whole utterance — it already
   * includes everything finalised. Replace it wholesale; do NOT prepend your
   * own accumulated text or every update double-counts the finalised part.
   */
  onPartial?: (text: string) => void;
  onStatus?: (s: { state: LiveState; detail?: string }) => void;
  /** RMS of the frame just sent, for the input meter. */
  onLevel?: (rms: number) => void;
  onMetrics?: (m: {
    provider: string;
    latencyMs: number;
    firstTokenMs?: number;
    sentMs: number;
    receivedMs: number;
  }) => void;
};

export type LocalCaptions = {
  /** Feed resampled mono 16k frames. Call from the worklet callback. */
  push: (pcm: Int16Array) => void;
  stop: () => void;
  /** Resolves once the daemon acknowledged and the stream is ready. */
  ready: Promise<void>;
};

/**
 * One WebSocket per session. Audio is forwarded as it arrives; the daemon
 * decides when to call something final.
 */
export function createLocalCaptions(opts: LocalCaptionsOptions): LocalCaptions {
  const wsUrl = opts.wsUrl ?? LOCAL_WS_DEFAULT;
  const CHUNK_MS = 160;               // matches the x-asr model's native chunk

  let ws: WebSocket | null = null;
  let closed = false;
  let readySettled = false;
  let resolveReady: () => void;
  let rejectReady: (e: Error) => void;
  const ready = new Promise<void>((res, rej) => {
    resolveReady = res;
    rejectReady = rej;
  });

  /** Finalised text. partial is replaced, final is appended. */
  let finalText = "";
  let partialText = "";
  let audioMs = 0;
  let connectedAt = 0;
  let firstTokenMs: number | undefined;
  let lastRecvAt = 0;

  const settleReady = (err?: Error) => {
    if (readySettled) return;
    readySettled = true;
    if (err) rejectReady(err);
    else resolveReady();
  };

  const fail = (detail: string) => {
    opts.onStatus?.({ state: "error", detail });
    settleReady(new Error(detail));
  };

  try {
    ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
  } catch (e) {
    fail(`無法建立連線：${e instanceof Error ? e.message : String(e)}`);
    ws = null;
  }

  ws?.addEventListener("open", () => {
    connectedAt = performance.now();
    opts.onStatus?.({ state: "listening", detail: "已連上本機字幕服務" });
  });

  ws?.addEventListener("message", (ev) => {
    if (typeof ev.data !== "string") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== "object") return;
    const d = parsed as Record<string, unknown>;
    lastRecvAt = performance.now();

    switch (d.type) {
      case "ready":
        settleReady();
        break;

      case "partial":
        if (firstTokenMs === undefined && connectedAt) {
          firstTokenMs = performance.now() - connectedAt;
        }
        partialText = String(d.text ?? "");
        // The daemon's partial is the full hypothesis including finalised text,
        // so it is used as-is. Concatenating our own `finalText` on top made
        // the preview repeat the first sentence on every update.
        opts.onPartial?.(partialText);
        break;

      case "final": {
        if (firstTokenMs === undefined && connectedAt) {
          firstTokenMs = performance.now() - connectedAt;
        }
        const text = String(d.text ?? "");
        // A `rewrite` means the model changed earlier text, so the daemon
        // resends everything. Replace instead of append, or the line doubles up.
        if (d.rewrite) {
          finalText = text;
        } else {
          finalText += text;
        }
        partialText = "";
        const now = Date.now();
        opts.onSegment({
          startMs: Math.max(0, now - CHUNK_MS),
          endMs: now,
          text,
        });
        opts.onPartial?.(finalText);
        break;
      }

      case "noop":
        break;

      default:
        // Unknown message types are ignored on purpose: a newer daemon may add
        // fields, and an older page should keep working rather than throw.
        break;
    }

    opts.onMetrics?.({
      provider: "local-daemon",
      latencyMs: connectedAt ? Math.round(performance.now() - connectedAt) : 0,
      ...(firstTokenMs !== undefined ? { firstTokenMs: Math.round(firstTokenMs) } : {}),
      sentMs: Math.round(audioMs),
      receivedMs: Math.round(lastRecvAt),
    });
  });

  ws?.addEventListener("error", () => {
    if (closed) return;
    // Chrome's Local Network Access produces the same `error` event as a dead
    // daemon, so name both possibilities rather than guessing wrong.
    fail(
      `連不上本機字幕服務（${wsUrl}）。` +
        `請確認 ZixiCaption.exe 已啟動，並在網址列左邊允許「存取本機網路」。`
    );
  });

  ws?.addEventListener("close", (ev) => {
    if (closed) return;
    if (ev.code === 1000) {
      settleReady();
      return;
    }
    fail(`本機字幕服務中斷（code ${ev.code}）`);
  });

  return {
    ready,

    push(pcm: Int16Array) {
      if (closed || !ws || ws.readyState !== WebSocket.OPEN) return;

      // Input meter. Reported even before `ready` so the meter starts moving
      // the moment the mic is live — otherwise it looks dead during the
      // ~3s the daemon spends loading the model.
      if (opts.onLevel) {
        let sum = 0;
        for (let i = 0; i < pcm.length; i++) {
          const v = pcm[i] / 32768;
          sum += v * v;
        }
        opts.onLevel(Math.sqrt(sum / Math.max(1, pcm.length)));
      }

      // Keep the daemon's clock aligned even while it is still loading the model.
      if (readySettled) {
        audioMs += (pcm.length / 16000) * 1000;
      }
      ws.send(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength));
    },

    stop() {
      if (closed) return;
      closed = true;
      settleReady();
      try {
        // Ask for whatever is still in flight to be flushed, then close.
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "flush" }));
          ws.close(1000, "client stop");
        }
      } catch {
        /* socket already gone */
      }
      ws = null;
      finalText = "";
      partialText = "";
      opts.onStatus?.({ state: "idle" });
    },
  };
}
