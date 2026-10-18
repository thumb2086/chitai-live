// body-limit.ts — 帶上限的請求體讀取
//
// ══════════════════════════════════════════════════════════
// 為什麼需要這個
// ══════════════════════════════════════════════════════════
//
// `await req.arrayBuffer()` 沒有上限。單一請求可以塞幾百 MB，
// 而 Next 不會擋，Workers 也不會擋 —— 記憶體直接爆。
//
// 而且 `transcribe` 這條路徑的讀取發生在**驗證身份之前**，
// 所以不需要任何憑證就能佔用記憶體。
//
// ── 為什麼不能用「讀完再檢查長度」───────────────────────
//
// 那樣整個 body 已經躺在記憶體裡了，檢查只是事後通知。
// 要真的擋住，就必須在**讀的過程中**就停手：
//
//   ① Content-Length 快速拒絕 —— O(1)，一個位元組都不用讀
//   ② 串流逐塊累加計數，超標立刻 cancel
//   ③ 收尾再核對一次實際長度
//
// ①②③ 缺一不可：
//   · 只做 ① → 對方省略或偽造 header 就繞過了
//   · 只做 ② → 每個超標請求都要先建立連線、傳幾 MB 才被拒
//   · 只做 ③ → 等於沒做
//
// ── 這個模組刻意不 import 任何東西 ────────────────────────
//
// 因為它被拿來保護「還沒決定要不要信任這個請求」的那一段。
// 在那個位置多引入任何相依，等於多一個可以出事的地方。

/** 讀取請求體時超過上限。呼叫端應該回 413。 */
export class BodyTooLargeError extends Error {
  readonly limit: number;
  /** 實際或宣告的長度；拿不到時為 null。 */
  readonly seen: number | null;

  constructor(limit: number, seen: number | null) {
    super(`請求內容過大，單次上限 ${limit} 個位元組`);
    this.name = "BodyTooLargeError";
    this.limit = limit;
    this.seen = seen;
  }
}

/**
 * 從 Content-Length 讀出宣告長度。
 *
 * 回傳 null 的三種情況，都要留給串流那道閘去處理：
 *   · 沒有這個 header（chunked 傳輸本來就沒有）
 *   · 不是數字
 *   · 是負數
 *
 * ⚠️ 這個值**永遠不能當成可信的長度**。它只是給快速拒絕用的提示。
 */
export function declaredLength(req: Request): number | null {
  const raw = req.headers?.get?.("content-length");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * 讀取請求體，總量不得超過 `limit`。
 *
 * 超過時丟 BodyTooLargeError，並且**已經把串流 cancel 掉** ——
 * 不繼續收資料，呼叫端那邊的連線也會被放掉。
 *
 * 沒有 `req.body` 串流可讀時（例如某些測試環境的 Request polyfill）
 * 退回 arrayBuffer，但仍會在讀完後核對長度。
 */
export async function readBodyCapped(req: Request, limit: number): Promise<Buffer> {
  // ① 快速拒絕：一個位元組都不讀。
  const declared = declaredLength(req);
  if (declared !== null && declared > limit) {
    throw new BodyTooLargeError(limit, declared);
  }

  const stream: unknown = (req as { body?: unknown }).body;

  // ② 串流讀取，過程中計數。
  if (stream && typeof (stream as ReadableStream).getReader === "function") {
    const reader = (stream as ReadableStream<Uint8Array>).getReader();
    const parts: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > limit) throw new BodyTooLargeError(limit, total);
        parts.push(value);
      }
    } catch (e) {
      // 已經讀了多少就別再收 —— cancel 掉會讓對方知道可以放棄，
      // 也讓底層連線進入可回收狀態。
      await reader.cancel().catch(() => {});
      throw e;
    }
    // ③ 收尾核對。正常情況下這裡永遠不會超，但保留是為了防
    //    「計數器被繞過」這類沒想到的情況。
    if (total > limit) throw new BodyTooLargeError(limit, total);
    return Buffer.concat(parts.map((p) => Buffer.from(p.buffer, p.byteOffset, p.byteLength)), total);
  }

  // 沒有串流可讀的退路：仍然要核對實際長度。
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length > limit) throw new BodyTooLargeError(limit, buf.length);
  return buf;
}
