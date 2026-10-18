import { NextResponse } from "next/server";
import {
  transcribePcm, pcmRms, looksLikeHallucination, groqConfigured, providerStatus, providerHost,
  SAMPLE_RATE,
} from "@/lib/captions-groq";
import { getOrCreateUser, getSessionId, unauthorized } from "@/lib/getUser";
import { checkQuota, quotaMessage, recordUsage } from "@/lib/usage";
import { audioSecondsToCredits, usageNote } from "@/lib/ai-cost";
import { readBodyCapped, BodyTooLargeError, declaredLength } from "@/lib/body-limit";

export const dynamic = "force-dynamic";
// Audio upload + a Whisper round trip; keep well under the platform ceiling.
export const maxDuration = 30;

// ══════════════════════════════════════════════════════════
// 請求體大小上限
// ══════════════════════════════════════════════════════════
//
// 8 MB 怎麼來的（不是隨便抓一個整數）：
//
//   16 kHz、mono、Int16 PCM → 每秒 16000 × 2 = 32,000 bytes。
//   8 MB = 8,388,608 bytes → 262 秒 ≈ 4.4 分鐘音訊。
//
//   而實際的正常請求：
//     WINDOW_MS = 2400（src/lib/captions-live.ts）
//     TARGET_RATE = 16000
//     2400ms × 16000 × 2 = 76,800 bytes ≈ 75 KB
//
//   也就是**正常請求只佔上限的 0.9%**，有 109 倍餘裕。
//   就算有人在頁面上把 windowMs 拉到最大，也不會接近 8 MB。
//
//   另外 Groq Whisper 自己的單次檔案上限是 25 MB，
//   8 MB 在那之下，所以這道閘不會比供應商更早擋掉任何合法請求。
//
// ⚠️ 這道閘在**驗證身份之前**就必須成立。
//    身份檢查在下面（要打 Neon，~1.5s），而記憶體不能等那 1.5 秒。
//    沒有上限的話，��要任何憑證的人都能靠重複送大 body 打爆 Worker。
export const MAX_TRANSCRIBE_BYTES = 8 * 1024 * 1024;

function tooLarge(limit: number, seen: number | null) {
  const mb = (limit / (1024 * 1024)).toFixed(0);
  const detail =
    seen !== null && seen !== limit
      ? `（收到 ${(seen / (1024 * 1024)).toFixed(1)} MB）`
      : "";
  return NextResponse.json(
    { error: `音訊片段過大，單次請求上限 ${mb} MB${detail}。請縮短視窗後再試。` },
    { status: 413 }
  );
}

/**
 * POST raw 16kHz mono Int16 PCM -> transcript.
 *
 * The body is the raw buffer rather than multipart so the upload path stays
 * short; the WAV container is added here. Query params:
 *   startMs   absolute stream position of the first sample
 *   language  ISO-639-1, default zh
 *   model     whisper-large-v3-turbo (default) | whisper-large-v3
 *   minRms    skip silent windows, default 0.006
 *
 * Overlapping windows deliberately re-transcribe the same audio; the caller
 * joins the fragments with `mergeCaption` (src/lib/caption-merge.ts). Groq only
 * returns segment-level timestamps, so de-duplicating on time would drop text.
 */
export async function POST(req: Request) {
  // ── 第 0 道：Content-Length 快速拒絕 ────────────────────
  //
  // 放最前面，因為它 O(1) 且不碰 body。服務就算處於未設定狀態，
  // 一個 500MB 的宣告長度也不該讓它先做任何別的事。
  //
  // ⚠️ 這一道**單獨不足以保護**：Content-Length 可以省略，也可以說謊。
  //    真正的保證在下面那道串流計數。
  const declared = declaredLength(req);
  if (declared !== null && declared > MAX_TRANSCRIBE_BYTES) {
    return tooLarge(MAX_TRANSCRIBE_BYTES, declared);
  }

  if (!groqConfigured()) {
    return NextResponse.json(
      { error: "Groq 未設定，請設定 GROQ_API_KEY（直連）或 STT_PROXY_URL + GROQ_ROUTER_KEY（錄音備援）" },
      { status: 503 }
    );
  }

  const q = new URL(req.url).searchParams;
  const startMs = Number(q.get("startMs") ?? 0) || 0;
  const language = q.get("language") || "zh";
  const model = (q.get("model") || "whisper-large-v3-turbo") as
    | "whisper-large-v3-turbo"
    | "whisper-large-v3";
  const minRms = Number(q.get("minRms") ?? 0.006) || 0;

  // NB: identity resolution deliberately happens AFTER the silence gate below.
  // This route is on the caption latency path, and a Neon round trip costs ~1.5s
  // -- more than the Whisper call itself. A skipped window spends nothing and
  // reveals nothing, so it must not pay for auth or quota lookup.
  //
  // ⚠️ 所以「把讀取整個移到 auth 之後」是**不對的**，理由見上面
  //    MAX_TRANSCRIBE_BYTES：記憶體的保護靠的是「有上限的讀取」，
  //    不是把讀取往後挪。挪到 auth 之後，會讓每一個被靜音門擋下的視窗
  //    都先付 1.5s 的 Neon 往返 —— 而客戶端是每 STEP_MS 就送一個重疊視窗。
  //    未驗證請求能佔用的記憶體已被壓在 8 MB，不需要拿延遲去換。

  let pcm: Buffer;
  try {
    // ── 第 1、2、3 道：串流讀取 + 過程中計數 + 收尾核對 ──
    pcm = await readBodyCapped(req, MAX_TRANSCRIBE_BYTES);
    if (pcm.length < 2048) {
      return NextResponse.json({ error: "音訊片段太短" }, { status: 400 });
    }
  } catch (e) {
    if (e instanceof BodyTooLargeError) return tooLarge(e.limit, e.seen);
    return NextResponse.json({ error: "無法解析音訊" }, { status: 400 });
  }

  const windowMs = Math.round((pcm.length / 2 / SAMPLE_RATE) * 1000);

  // Cheap gate: don't spend a request (and latency) on near-silence.
  const rms = pcmRms(pcm);
  if (rms < minRms) {
    return NextResponse.json({ skipped: true, reason: "silence", windowMs, rms });
  }

  // Past this point the provider gets called, so this is where the spend starts:
  // check the granted plan's limit first, then meter what was actually decoded.
  // Deliberately after the silence gate -- a skipped window costs nothing and
  // must not be blocked or billed.
  //
  // This route spends money on every call (a Whisper round trip) and previously
  // took no identity at all, so anyone who reached the origin could burn the
  // Groq quota and nothing would ever appear on the billing pages.
  const user = await getOrCreateUser(getSessionId(req));
  if (!user) return unauthorized();

  const windowSec = Math.max(1, Math.round(windowMs / 1000));

  // ── 唯一的額度判斷：ai_credits ────────────────────────────
  //
  // 原本這裡還有一道 caption_minutes 的檢查，現在拿掉了。
  // 兩個上限並存時，`caption_minutes` 一定先撞到（ai_credits 的數字寬鬆 8~24 倍），
  // 於是 ai_credits 永遠只是裝飾 —— 而「永遠不會觸發的額度」比沒有額度更糟，
  // 因為它在方案頁上讓人以為有這回事。
  //
  // 時間（caption_minutes）改為**只記錄不擋**，用途是用量明細的
  // 分項顯示（「這期轉了 1,200 分鐘字幕，合計 50.4 點」）。
  const wantCredits = audioSecondsToCredits(windowSec);
  const creditQuota = await checkQuota(user.id, "ai_credits", wantCredits);
  if (!creditQuota.allowed) {
    return NextResponse.json({ error: quotaMessage("ai_credits", creditQuota, " 點") }, { status: 429 });
  }

  try {
    const r = await transcribePcm(pcm, { model, language });

    // Re-base segment timestamps onto the absolute stream timeline. Segments
    // that only cover already-shown audio still come back — windows overlap on
    // purpose — so the caller merges the text, it does not filter on time.
    const kept = r.segments
      .map((s) => ({
        startMs: Math.round(startMs + s.start * 1000),
        endMs: Math.round(startMs + s.end * 1000),
        text: s.text,
      }))
      .filter((s) => !looksLikeHallucination(s.text, 0));

    // Meter the audio that was actually decoded, not the caller's claim about it.
    const billedSec = Math.max(1, Math.round(r.durationSec || windowSec));

    // 點數 = 唯一的額度帳。它決定這次呼叫該不該被允許。
    await recordUsage(
      user.id,
      "ai_credits",
      audioSecondsToCredits(billedSec),
      usageNote("字幕轉寫", `${r.provider}/${model} · ${billedSec}s`)
    );

    // 分鐘 = 只記錄，用於用量明細的分項顯示，不再是獨立額度。
    // 秒數取實際解碼出來的值（與上面同一個 billedSec），不是呼叫端宣稱的時長。
    await recordUsage(user.id, "caption_minutes", billedSec / 60, `Groq ${r.provider}/${model}`);

    return NextResponse.json({
      ok: true,
      windowMs,
      rms,
      latencyMs: r.latencyMs,
      provider: r.provider,
      attempts: r.attempts,
      ...(r.fellBackFrom ? { fellBackFrom: r.fellBackFrom, failReason: r.failReason } : {}),
      durationSec: r.durationSec,
      billedSec,
      text: kept.map((s) => s.text).join(""),
      segments: kept,
    });
  } catch (e: any) {
    console.error("POST /api/v1/captions/transcribe error:", e);
    return NextResponse.json({ error: e?.message || "轉寫失敗" }, { status: 502 });
  }
}

/** Lets the client show which provider is live before starting. */
export async function GET() {
  const s = providerStatus();
  return NextResponse.json({
    configured: s.order.length > 0,
    provider: s.primary,
    order: s.order,
    direct: s.direct,
    router: s.router,
    // ★ 這裡曾經讀 GROQ_ROUTER_URL，而那個變數是給 chat/embedding 用的。
    //   轉寫的備援早就搬到 STT_PROXY_URL，所以診斷頁顯示的主機
    //   **從來不是實際在轉寫的那一台** —— 照著它排查會一路查錯方向。
    routerHost: providerHost("router"),
    sampleRate: SAMPLE_RATE,
    models: ["whisper-large-v3-turbo", "whisper-large-v3"],
  });
}