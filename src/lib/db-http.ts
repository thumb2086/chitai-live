// db-http.ts — Neon HTTP 查詢（Workers 相容，零 WASM）
//
// ══════════════════════════════════════════════════════════
// 為什麼需要這個
// ══════════════════════════════════════════════════════════
//
// Prisma 7 的 query compiler 是 WASM（query_compiler_fast_bg.wasm, 3.6 MB），
// 而 Cloudflare Workers 拒絕它需要的動態 WASM codegen：
//
//   CompileError: WebAssembly.Module(): Wasm code generation disallowed by embedder
//
// 實測確認（不是推測）：
//   · @prisma/adapter-neon 裡 grep WebAssembly → 0 命中
//     → WASM 在 Prisma core，**換 adapter 繞不過**
//   · @prisma/client/runtime 裡沒有任何 PRISMA_*_ENGINE* / DISABLE_*_WASM 開關
//     → 沒有環境變數能關掉它
//
// 所以走 HTTP 直連 Neon：@neondatabase/serverless 的 neon() 是 fetch-based，
// 純 JS，Workers 原生支援。這是 Workers + Neon 的標準做法。
//
// ── 為什麼現在只做 overlay 那四條 ────────────────────────
//
// 全專案 prisma.* 有 118 個呼叫點（31 個檔案、16 個 model）。
// 那是一次大重寫，不能混在一次部署裡做 ——
// 而且「順手改 118 處」的改法，本質上就是沒有測試的改法。
//
// 但 overlay/* 是**現在就壞著**的（OBS 正在用的路徑），
// 而且每條只有**一個** Prisma 查詢。所以先讓它真的能用，
// 再把其餘的 117 個呼叫點按重要性分批搬。
//
// ── 參數化，不是字串拼接 ──────────────────────────────────
//
// 這裡刻意不用 template literal 組 SQL。
// overlay 的 token 來自 URL，而這些路由是公開的（OBS 會打）。
// 字串拼接等於把 SQL 注入開在公開端點上。
import { neon } from "@neondatabase/serverless";

/**
 * Neon HTTP 查詢。
 *
 * 用 `sql.query()`（參數化模板）而不是 `sql.query(string)`：
 * 前者會把參數送到 Neon 的 HTTP 協議層做綁定，
 * 後者才是在字串層拼接 —— 而 token 來自 URL。
 *
 * ⚠️ 連線字串不能快取成常數：Workers 的 `process.env` 在 module
 *    載入時可能還沒被 populate（OpenNext 是在 request 期間才注入），
 *    所以每次呼叫時讀取。
 */
function client() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    // 與 prisma.ts 同一個理由：寧可在啟動時錯，也不要在第一個查詢時才錯。
    throw new Error("DATABASE_URL 未設定");
  }
  return neon(url);
}

export type Row = Record<string, unknown>;

// ══════════════════════════════════════════════════════════
// 查詢逾時
// ══════════════════════════════════════════════════════════
//
// 為什麼需要（2026-10-14 補）：
//
// Workers 上一個沒有 timeout 的 fetch 可以**永久掛住**。而呼叫端
// 多數是 server component，症狀不是錯誤畫面 —— 是 app/loading.tsx
// 的「載入中…」永遠留在畫面上。沒有錯誤、沒有 500、沒有 log。
//
// 而且「再等等」不會變好：Workers 的 CPU 時間到上限會直接中止整個請求，
// 連逾時錯誤都不會有。所以等待只會把「失敗得很清楚」變成「失敗得沒線索」。
//
// 選 Promise.race 而不是 AbortSignal：
// neon() 的 query() 在不同版本對 signal 的支援不一致，
// 而 race 只需要一個會 reject 的 timer，與底層是 fetch 還是 driver 無關。
export const QUERY_TIMEOUT_MS = Number(process.env.DB_QUERY_TIMEOUT_MS || 8000);

export class QueryTimeoutError extends Error {
  constructor(ms: number, sql: string) {
    super(`資料庫查詢逾時（${ms}ms）：${sql}`);
    this.name = "QueryTimeoutError";
  }
}

/**
 * 只留 SQL 的「形狀」進錯誤訊息 —— 參數可能是 token、個資、會話。
 * 把 params 印出來等於把秘密寫進 log。
 */
function sqlShape(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 120);
}

function rejectAfter(ms: number, text: string): Promise<never> {
  return new Promise<never>((_, reject) => {
    // ★ 這裡**不能** unref()。
    //
    //   我第一版加了 unref 想「不要拖住 event loop」——
    //   而那正好把逾時機制整個廢掉：
    //   unref 掉的 timer 不會讓 Node 保持存活，
    //   若當下沒有別的在途工作，行程會直接結束，
    //   reject 永遠不會發生，呼叫端拿到的不是逾時錯誤而是「沒有結果」。
    //
    //   實測（tools/test-db-timeout.ts，2026-10-14）：
    //   加了 unref → 測試在第一段之後直接 exit 0，逾時路徑沒被執行到。
    //   拿掉 unref → 逾時如預期發生。
    //
    //   timer 的職責就是「維持 loop 直到它觸發」，unref 是自我否定。
    setTimeout(() => reject(new QueryTimeoutError(ms, sqlShape(text))), ms);
  });
}

/**
 * 跑一個參數化查詢並回傳列陣列。
 *
 * @param text  SQL，**只能**用 $1 $2 … 佔位符
 * @param params 依序對應的參數值
 */
// ⚠️ 泛型約束是 `T extends Row`，而 Row = Record<string, unknown>。
//    呼叫端傳 `ZixiDonationRow` 時那個 interface 沒有 index signature，
//    所以 TS 會拒絕 —— 這不是簽名錯，是「明確的形狀」與
//    「開放的字典」之間的衝突。
//
//    正確的修法是讓 Row 接受任何物件形狀，而不是放寬成 any：
//    `T extends Row` 改成 `T extends object`。
//
//    而 queryOne 那個錯誤（`does not satisfy the constraint`）是同一個
//    問題從泛型約束冒出來的連鎖反應。
export async function query<T extends object = Row>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  // ⚠️ 這裡的 cast 不是懶得寫型別，是 neon() 的簽名要求
  //    query<R extends any[], I = any[]>(config, values)
  //    —— 第一個泛型是「回傳列的陣列型別」，而它的約束是 any[]，
  //    傳 T（單列）會不過；傳 T[] 才對。
  //
  //    我第一版傳 T，得到兩個編譯錯誤：
  //      Type 'T[]' does not satisfy the constraint 'boolean'（← 這行本身也編譯不過，
  //        因為第二個泛型被推成 boolean）
  //      Type 'Record<string, any>[]' is not assignable to type 'T[]'
  //
  //    ⚠️ 而回傳值需要 **params 的實際型別**才能推導列型別，
  //       這裡做不到（參數是 unknown[]），
  //       所以型別斷言是必要的，而不是偷懶。
  const res = (await Promise.race([
    client().query(text, params as never[]),
    rejectAfter(QUERY_TIMEOUT_MS, text),
  ])) as
    | T[]
    | { rows: T[] }
    | null;
  // neon() 的 HTTP 路徑回傳陣列；driver 路徑回傳 { rows }。
  // 兩種都處理，因為未來有人改成 Pool 連接時不會靜默壞掉。
  if (Array.isArray(res)) return res;
  if (res && Array.isArray(res.rows)) return res.rows;
  return [];
}

/**
 * 跑一個參數化查詢並回傳第一列（或 null）。
 *
 * 大部分「找一個資源」的查詢都是這個形狀，
 * 而 `rows[0]` 在空結果時會是 undefined ——
 * 那與 null 在後續 `if (!x)` 的判斷上是等價的，
 * 但**型別**不是，所以這裡明確收斂成 null。
 */
export async function queryOne<T extends object = Row>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows.length ? rows[0] : null;
}

/**
 * 取一個 OBS 來源與其擁有者的設定。
 *
 * 這是四條 overlay 路由共同需要的查詢 —— 它們的差別只在
 * 拿到資料之後怎麼渲染 HTML。
 *
 * 回傳 null 代表「token 不存在」或「該來源被停用」，
 * 兩者對呼叫端都是同一件事：404。分開回傳只會讓呼叫端多寫分支。
 */
export interface OverlaySource {
  token: string;
  sourceKey: string;
  name: string;
  user: {
    id: string;
    name: string;
    demoMode: boolean;
    /** stats overlay 的即時追蹤數要顯示。 */
    followers: number;
  };
  /** chat 路由需要；其他路由拿到 null 也没关系。 */
  chatSettings: {
    theme: string;
    maxMessages: string;
    fontSize: string;
  } | null;
}

/**
 * 在一個 transaction 裡跑多個查詢。
 *
 * ─────────────────────────────────────────────────────────
 * ⚠️ 為什麼不能用「一條 SQL 放多個陳述句」
 * ─────────────────────────────────────────────────────────
 *
 * 我第一版把 createUserWithDefaults 寫成一條 SQL 裡塞 6 個 INSERT
 * （用分號分隔），理由是「11 次跨網路往返降到 1 次」。
 *
 * 而 Neon 的 HTTP driver 直接拒絕：
 *
 *     cannot insert multiple commands into a prepared statement
 *
 * 那是 Neon 的 prepared statement 協議限制 —— extended query protocol
 * 一條只帶一個 command。
 *
 * ⚠️ 而 tsc 過、build 過、deploy 過。
 *    只有**真的對 Neon 執行**才會發現 —— 那正是這支測試存在的理由。
 *
 * ── transaction 是正確的替代 ──────────────────────────────
 *
 * Neon 的 transaction() 接受查詢陣列，用單次擴展協議批次送出全部 ——
 * 所以網路往返仍是 1 次（而非 11 次），而且具備全部-or-nothing 語意。
 *
 * 而 all-or-nothing 在這裡是**必需的**而非錦上添花：
 * 建立使用者時若 OBS source 只插了 3 個，
 * 那個帳號的 overlay 就是半壞的，而沒有人會去查。
 */
export async function transaction(
  queries: Array<[string, unknown[]?]>,
): Promise<unknown[]> {
  const sql = client();
  // 同樣要 timeout：transaction 是批次送出，但底層仍是 fetch，
  // 掛住的方式跟單一查詢一模一樣。
  return (await Promise.race([
    sql.transaction(
      queries.map(([text, params]) =>
        params && params.length ? sql.query(text, params as never[]) : sql.query(text),
      ),
    ),
    rejectAfter(QUERY_TIMEOUT_MS, `transaction(${queries.length} 條)`),
  ])) as unknown[];
}

/**
 * 取一個 OBS 來源 + 功能設定（overlay-render.ts 的 resolveOverlay 相容層）。
 *
 * ─────────────────────────────────────────────────────────
 * 為什麼這裡需要另一組查詢，而不是讓那 7 條路由各自呼叫
 * ─────────────────────────────────────────────────────────
 *
 * `resolveOverlay()` 在 src/lib/overlay-render.ts，而它寫的是：
 *
 *     (prisma as any).oBSSource.findFirst(...)
 *
 * **那個 `as any` cast 讓我的掃描漏掉它。**
 *
 * 我用 /\bprisma\.\w/ 掃過 11 條 overlay 路由，結論是
 * 「11 條全部零 Prisma」—— 而那 7 條走的是共享的
 * overlay-render.ts，不是路由本身，所以我根本没看到它。
 *
 * 而「11 條全部乾淨」這個結論還寫進了 commit 訊息。
 *
 * ⚠️ 這是今晚最有害的一類錯誤形狀：
 *    **掃描器的盲點讓結論變得比事實更樂觀。**
 *    我不是漏報一個警告，我是報了一個「全綠」。
 *
 * 所以：掃描的判準必須包含「有沒有別的檔案在共用層用 Prisma」，
 * 而不是只掃當前目錄。
 */
export interface OverlayFeatureSettings {
  sourceKey: string;
  user: { id: string; name: string; demoMode: boolean; followers: number };
  settings: Record<string, unknown>;
}

export async function resolveOverlayViaHttp(
  token: string,
  sourceKey: string,
): Promise<{ sourceKey: string; user: OverlayFeatureSettings['user']; settings: Record<string, unknown> } | null> {
  const base = await getOverlaySource(token, sourceKey);
  if (!base) return null;

  const row = await queryOne<{ settings: string | null }>(
    `SELECT s."settings"
       FROM "FeatureSettings" s
      WHERE s."userId" = $1 AND s."featureKey" = $2
      LIMIT 1`,
    [base.user.id, sourceKey],
  );

  let settings: Record<string, unknown> = {};
  if (row?.settings) {
    try { settings = JSON.parse(row.settings) || {}; } catch { settings = {}; }
  }
  return { sourceKey, user: base.user, settings };
}

/**
 * 取一個 OBS 來源 + 其擁有者的**捐款目標**（依 sortOrder 排序）。
 *
 * 為什麼要另一個函式而不是讓 getOverlaySource 接受關聯：
 * 那是把「這個 overlay 需要什麼」變成呼叫端的負擔，
 * 而各路由需要的關聯完全不同（chat 要 chatSettings、
 * donations 要 donationGoals）。分開函式讓差異留在型別裡。
 */
export interface DonationGoal {
  emoji: string;
  title: string;
  current: number;
  goal: number;
}

export interface OverlaySourceWithGoals extends OverlaySource {
  donationGoals: DonationGoal[];
}

export async function getOverlaySourceWithGoals(
  token: string,
  sourceKey: string,
): Promise<OverlaySourceWithGoals | null> {
  const base = await getOverlaySource(token, sourceKey);
  if (!base) return null;

  const goals = await query<{
    emoji: string | null;
    title: string;
    current: number;
    goal: number;
  }>(
    `SELECT g."emoji", g."title", g."current", g."goal"
       FROM "DonationGoal" g
      WHERE g."userId" = $1
      ORDER BY g."sortOrder" ASC`,
    [base.user.id],
  );

  return {
    ...base,
    donationGoals: goals.map((g) => ({
      emoji: g.emoji ?? "",
      title: g.title,
      current: Number(g.current ?? 0),
      goal: Number(g.goal ?? 0),
    })),
  };
}

export async function getOverlaySource(
  token: string,
  sourceKey: string,
): Promise<OverlaySource | null> {
  const row = await queryOne<{
    token: string;
    source_key: string;
    name: string;
    enabled: boolean;
    user_id: string;
    user_name: string;
    demo_mode: boolean;
    followers: number;
    theme: string | null;
    max_messages: string | null;
    font_size: string | null;
  }>(
    `SELECT s."token",
            s."sourceKey",
            s."name",
            s."enabled",
            u."id"        AS user_id,
            u."name"      AS user_name,
            u."demoMode"  AS demo_mode,
            u."followers" AS followers,
            c."theme"     AS theme,
            c."maxMessages" AS max_messages,
            c."fontSize"  AS font_size
       FROM "OBSSource" s
       JOIN "User" u ON u."id" = s."userId"
       LEFT JOIN "ChatSettings" c ON c."userId" = u."id"
      WHERE s."token" = $1
        AND s."sourceKey" = $2
      LIMIT 1`,
    [token, sourceKey],
  );

  if (!row || row.enabled === false) return null;

  return {
    token: row.token,
    sourceKey: row.source_key,
    name: row.name,
    user: {
      id: row.user_id,
      name: row.user_name,
      demoMode: !!row.demo_mode,
      followers: Number(row.followers ?? 0),
    },
    chatSettings:
      row.theme === null && row.max_messages === null && row.font_size === null
        ? null
        : {
            theme: row.theme ?? "dark",
            maxMessages: row.max_messages ?? "最近 50 則",
            fontSize: row.font_size ?? "中",
          },
  };
}