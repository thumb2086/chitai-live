/**
 * RAG 知識庫（2026-10-14 重寫）
 *
 * ─────────────────────────────────────────────────────────────
 * 為什麼整個重寫而不是修
 * ─────────────────────────────────────────────────────────────
 *
 * 舊版有五個問題，每一個都會讓功能「看起來接好了但跑不出來」：
 *
 * ① **用 Prisma 讀資料。**
 *    這個專案早就從 Prisma 改成 Neon HTTP（Workers 相容）——
 *    `src/app/api/v1/zixi/check-tx/route.ts` 的檔頭就寫著這件事。
 *    舊版在模組層級 `new PrismaClient()`，那是 import 就會炸的形狀。
 *
 * ② **`searchSimilar` 的參數編號整組錯位。**
 *    params 最後變成 [emb, emb, sourceType, threshold, 5]，
 *    但 SQL 裡的佔位符是 $1..$4 ——
 *    `$3 >= threshold` 拿到的是 sourceType 文字，
 *    `LIMIT $4` 拿到的是數字 0.25。
 *    而且 where 為空時 SQL 變成 `... knowledge_chunks  AND 1 - (...)`
 *    （兩個空白夾著 AND）＝ 語法錯誤。
 *
 * ③ **`ragAnswer` 永遠回 `sources: []`。**
 *    system prompt 要求模型標註「[來源 1]」，
 *    但回給前端的 sources 是空的 ——
 *    使用者看到一個引用了來源的答案，卻查不到來源。
 *
 * ④ **`embedTexts` 一律送 `input_type: "passage"`。**
 *    查詢也用 passage，等於拿「文章」去跟「文章」比。
 *    檢索要用 `query`，索引才用 `passage`。
 *
 * ⑤ **欄位名稱不存在。**
 *    舊版讀 `r.order` / `r.source`，
 *    但 CaptionSegment 的欄位是 `seq` / `speaker`（見 prisma/schema.prisma）。
 *
 * 加上重複宣告的 `SearchResult` interface（L89 與 L108）、
 * 死的 `placeholders` 變數、從未使用的 `pgPool` / `prisma` / `TOP_K` /
 * `EMBED_DIM` / `SIMILARITY_THRESHOLD` —— 整個模組沒有被執行過一次。
 */

// ★ 別名匯入：`searchSimilar(query: string, ...)` 的參數名
//   會遮蔽 `query()` 函式（搜尋函式叫 query、DB 查詢也叫 query，
//   兩個都合理但不能同名牌）。
import { query as dbQuery, queryOne } from "@/lib/db-http";

// ── 設定 ────────────────────────────────────────────────
/** 相似度門檻。cosine 距離換成相似度後低於此值就不算相關。 */
const SIMILARITY_THRESHOLD = 0.3;

// ★ 嵌入一律走我們自己的中轉，不直連 NVIDIA NIM（2026-10-14）
//
//   專案規則是「後端一律走我們自己的中轉」。直連 NIM 會造成：
//     1. NVIDIA 憑證散落到每個消費端專案
//     2. 用量在中轉後台看不到
//     3. 換模型要改每一個消費端
//
//   groq-router 本來就有 nvidiaEmbed（做自己歷史訊息的 RAG），
//   只是沒有對外端點；2026-10-14 補上 /v1/embeddings。
//
//   好處不只是少一把 key：detectEmbedDim() 量的是
//   「中轉實際回幾維」，中轉換模型消費端會自動跟上。
const ROUTER_URL =
  process.env.GROQ_ROUTER_URL || "https://vercel-router-khaki.vercel.app";


/**
 * 量出這個模型實際回幾維。
 *
 * ★ 為什麼要「量」而不是寫常數
 *   2026-10-14 實測：nvidia/nemotron-3-embed-1b 回 **2048** 維。
 *   舊 rag.ts 寫死 1024，結果表建成 vector(1024)，
 *   每次寫入都丟「向量長度 2048，預期 1024」。
 *
 *   寫死的數字有兩個問題：
 *     1. 它會過期 —— 模型換版就變錯。
 *     2. 它**不會報錯**，只會讓寫入失敗 —— 失敗點離錯誤點很遠。
 *
 *   所以維度的唯一來源是「送一次、量出來」。
 *   結果快取在 module scope：同一個 isolate 內只量一次。
 *
 *   ⚠️ 換 isolate（冷啟動）會重量一次 —— 那是刻意的，
 *      模型換版要能自動跟上，而不是靠人記得改一個數字。
 */
let dimCache: number | null = null;
/** 中轉實際使用的嵌入模型名（從 /v1/embeddings 回應取得，不寫死）。 */
let modelCache: string | null = null;
/** HNSW 索引是否可用。false = 用精確搜尋。 */
let dimCacheIndexed: boolean | null = null;
/** 降級警告是否已經噴過（避免每個冷啟動都噴一行，久了就變雜訊）。 */
let degradedWarned = false;
/**
 * 本 isolate 是否已經確認過 schema。
 *
 * ⚠️ Workers 每次請求可能是新的 isolate，所以這個 flag **不會**讓
 *   DDL 變成免費 —— 它只避免同一個 isolate 內重複打 Neon。
 *   真正的成本修法是不要在每個請求都呼叫 ensureVectorSchema。
 */
let schemaChecked = false;

export async function detectEmbedDim(): Promise<number> {
  if (dimCache !== null) return dimCache;
  const [v] = await embedTexts(["量測向量長度"], "query");
  dimCache = v.length;
  return dimCache;
}

/** 目前是否走向量索引（false 表示精確搜尋）。頁面要顯示，免得看起來像壞掉。 */
export async function usingVectorIndex(): Promise<boolean> {
  if (dimCacheIndexed === null) {
    await ensureVectorSchema();
  }
  return dimCacheIndexed === true;
}

/** 中轉實際使用的嵌入模型名（不寫死 —— 寫死就等於每個消費端都要跟著改）。 */
export async function embedModelName(): Promise<string> {
  await detectEmbedDim();
  return modelCache || "（中轉未回報）";
}

/** knowledge_chunks.embedding 的實際型別（例如 "vector(2048)"），沒有表則 null。 */
export async function currentVectorType(): Promise<string | null> {
  const r = await queryOne<{ coltype: string }>(
    `SELECT format_type(a.atttypid, a.atttypmod) AS coltype
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
      WHERE c.relname = 'knowledge_chunks' AND a.attname = 'embedding'`,
  );
  return r?.coltype ?? null;
}

export interface KnowledgeChunk {
  id: string;
  sourceType: "caption" | "youtube" | "podcast" | "manual";
  sourceId: string;
  sourceRef?: string | null;
  text: string;
  metadata: Record<string, unknown>;
  createdAt?: Date;
}

export interface SearchResult {
  id: string;
  sourceType: string;
  sourceId: string;
  sourceRef: string | null;
  text: string;
  metadata: Record<string, unknown>;
  similarity: number;
}

export interface RAGAnswer {
  answer: string;
  sources: SearchResult[];
  /** 真的有檢索到東西嗎？false 代表這次回答沒用到知識庫。 */
  grounded: boolean;
  usage?: { promptTokens?: number; completionTokens?: number };
}

// ── 嵌入 ────────────────────────────────────────────────

/**
 * 呼叫 NVIDIA NIM 產生嵌入向量。
 *
 * @param inputType `passage` 用在寫進知識庫的文字，
 *                  `query` 用在搜尋字串 —— 兩者不能混用。
 */
export async function embedTexts(
  texts: string[],
  inputType: "passage" | "query" = "passage",
): Promise<number[][]> {
  if (!texts.length) return [];

  const key = process.env.GROQ_ROUTER_KEY;
  if (!key) {
    throw new Error("GROQ_ROUTER_KEY 未設定 —— 無法產生嵌入向量");
  }

  // 中轉單次請求有輸入上限；超量會直接 400，不會截斷。
  // 分批送，並報出是第幾批失敗（否則只會看到「哪一句失敗」）。
  const BATCH = 32;
  const out: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const res = await fetch(ROUTER_URL + "/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // ★ 不指定 model：讓中轉決定用哪個。
        //   在消費端寫死模型名，等於每個消費端都要記得跟著改。
        input: batch,
        input_type: inputType,
      }),
    });

    if (!res.ok) {
      throw new Error(
        `嵌入服務失敗（第 ${Math.floor(i / BATCH) + 1} 批，HTTP ${res.status}）：` +
          (await res.text()).slice(0, 300),
      );
    }

    const data = (await res.json()) as {
      data?: { index: number; embedding: number[] }[];
      model?: string;
    };
    const arr = data.data || [];

    if (data.model) modelCache = data.model;

    if (arr.length !== batch.length) {
      throw new Error(
        `嵌入服務回傳 ${arr.length} 筆，輸入 ${batch.length} 筆 —— 數量不符`,
      );
    }

    // ★ 以回傳的 index 對位，不假設順序與輸入相同。
    //   NIM 原生不保證順序（它會附 index），舊版假設相同，那是不成立的。
    for (const d of arr) {
      if (!d.embedding?.length) {
        throw new Error(`第 ${i + d.index} 筆回傳的向量是空的`);
      }
      out[i + d.index] = d.embedding;
    }
  }

  return out;
}

// ── Schema ──────────────────────────────────────────────

/**
 * 建立向量表與索引（冪等，每次呼叫都安全）。
 *
 * ★ DDL 是一句一句送的，不是整串一次送。
 *   neon 的 HTTP 查詢端點不接受多指令；
 *   舊版把 4 個 CREATE 串成一個字串，那是給 Pool 用的寫法。
 */
export async function ensureVectorSchema(): Promise<void> {
  if (schemaChecked) return;
  // ★ 先量、再建表。順序反過來會用錯的維度建表。
  const dim = await detectEmbedDim();

  const existing = await currentVectorType();
  if (existing && existing !== `vector(${dim})`) {
    // 維度對不上：舊的向量沒辦法塞進新欄位。
    //
    // ⚠️ 這裡只在「表是空的」時重建。
    //    有資料時不自動丟 —— 那是資料刪除，要人決定。
    const cnt = await queryOne<{ n: number }>(
      "SELECT count(*)::int AS n FROM knowledge_chunks",
    );
    if ((cnt?.n ?? 0) > 0) {
      throw new Error(
        `知識庫現有欄位是 ${existing}，但嵌入模型現在回 ${dim} 維。` +
          `表內有 ${cnt?.n} 筆，不能自動重建（重建會清掉這些向量）。` +
          `請確認要重新索引後再手動 DROP TABLE knowledge_chunks。`,
      );
    }
    console.warn(
      `[rag] 知識庫欄位 ${existing} → vector(${dim})，表為空，重建`,
    );
    await dbQuery("DROP TABLE IF EXISTS knowledge_chunks");
  }

  // ① 表 —— 一定建得起來（vector(N) 沒有 2000 維限制，那是索引的限制）
  await dbQuery("CREATE EXTENSION IF NOT EXISTS vector");
  await dbQuery(`CREATE TABLE IF NOT EXISTS knowledge_chunks (
       id          text PRIMARY KEY,
       source_type text NOT NULL,
       source_id   text NOT NULL,
       source_ref  text,
       text        text NOT NULL,
       metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
       embedding   vector(${dim}) NOT NULL,
       created_at  timestamptz NOT NULL DEFAULT now()
     )`);
  await dbQuery(
    "CREATE INDEX IF NOT EXISTS knowledge_chunks_source_idx ON knowledge_chunks (source_type, source_id)",
  );

  // ② 向量索引 —— 試著建，但不保證建得起來
  //
  //   pgvector 的 HNSW／IVFFlat 上限 2000 維，而實測模型回 2048 維。
  //   建不起來不是錯誤狀態，只是「這次用精確搜尋」。
  //
  //   ⚠️ 必須明確記錄 —— 不知道自己在用精確搜尋的人，
  //      資料量大了之後會以為「索引已經建好」而找不到效能問題。
  try {
    await dbQuery(
      "CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_idx ON knowledge_chunks USING hnsw (embedding vector_cosine_ops)",
    );
    dimCacheIndexed = true;
  } catch (e) {
    const msg = String((e as Error).message || e);
    if (/2000 dimensions/i.test(msg)) {
      dimCacheIndexed = false;
      if (!degradedWarned) {
        degradedWarned = true;
        console.warn(
          `[rag] 嵌入模型回 ${dim} 維，超過 pgvector 索引的 2000 維上限 → ` +
            `改用精確搜尋（幾千筆內可接受）。要索引請換 ≤2000 維的模型。`,
        );
      }
    } else if (/already exists/i.test(msg)) {
      dimCacheIndexed = true;
    } else {
      throw new Error(`建立向量索引失敗：${msg.slice(0, 300)}`);
    }
  }

  // ⚠️ 只在全部成功後才設 —— 中途失敗要能重試。
  schemaChecked = true;
}

// ── 寫入 ────────────────────────────────────────────────

/** 把 chunks 與其向量 upsert 進知識庫，回傳實際寫入筆數。 */
export async function upsertChunks(
  chunks: KnowledgeChunk[],
  embeddings: number[][],
): Promise<number> {
  if (chunks.length !== embeddings.length) {
    throw new Error(
      `chunks ${chunks.length} 筆與向量 ${embeddings.length} 筆數量不符`,
    );
  }
  if (!chunks.length) return 0;

  const BATCH = 50;
  let total = 0;

  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    const embs = embeddings.slice(i, i + BATCH);

    const params: unknown[] = [];
    const tuples = batch.map((c, idx) => {
      const b = idx * 8;
      params.push(
        c.id,
        c.sourceType,
        c.sourceId,
        c.sourceRef ?? null,
        c.text,
        JSON.stringify(c.metadata ?? {}),
        "[" + embs[idx].join(",") + "]",
        c.createdAt ?? new Date(),
      );
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}::jsonb, $${b + 7}::vector, $${b + 8})`;
    });

    await dbQuery(
      `INSERT INTO knowledge_chunks
         (id, source_type, source_id, source_ref, text, metadata, embedding, created_at)
       VALUES ${tuples.join(", ")}
       ON CONFLICT (id) DO UPDATE SET
         source_type = EXCLUDED.source_type,
         source_id   = EXCLUDED.source_id,
         source_ref  = EXCLUDED.source_ref,
         text        = EXCLUDED.text,
         metadata    = EXCLUDED.metadata,
         embedding   = EXCLUDED.embedding,
         created_at  = EXCLUDED.created_at`,
      params,
    );
    total += batch.length;
  }

  return total;
}

// ── 檢索 ────────────────────────────────────────────────

export async function searchSimilar(
  query: string,
  opts: { topK?: number; threshold?: number; sourceType?: string } = {},
): Promise<SearchResult[]> {
  const { topK = 5, threshold = SIMILARITY_THRESHOLD, sourceType } = opts;

  const [qEmb] = await embedTexts([query], "query");
  const qVec = "[" + qEmb.join(",") + "]";

  // ★ 參數編號一次算清楚，參數與佔位符永遠同源。
  //   舊版分兩段組 params（先 push 再 unshift），序號必然對不上。
  const params: unknown[] = [qVec];
  let i = 2;

  let where = "";
  if (sourceType) {
    where += ` WHERE source_type = $${i}`;
    params.push(sourceType);
    i++;
  }
  const thrIdx = i++;
  const limIdx = i++;
  params.push(threshold, topK);

  const sql = `
    SELECT id, source_type, source_id, source_ref, text, metadata,
           1 - (embedding <=> $1::vector) AS similarity
      FROM knowledge_chunks
      ${where ? where + " AND" : "WHERE"}
           1 - (embedding <=> $1::vector) >= $${thrIdx}
      ORDER BY embedding <=> $1::vector
      LIMIT $${limIdx}
  `;

  const rows = await dbQuery<{
    id: string;
    source_type: string;
    source_id: string;
    source_ref: string | null;
    text: string;
    metadata: Record<string, unknown>;
    similarity: number | string;
  }>(sql, params);

  return rows.map((r) => ({
    id: r.id,
    sourceType: r.source_type,
    sourceId: r.source_id,
    sourceRef: r.source_ref,
    text: r.text,
    // neon 有時把 jsonb 回成字串。
    metadata:
      typeof r.metadata === "string"
        ? (JSON.parse(r.metadata) as Record<string, unknown>)
        : (r.metadata ?? {}),
    similarity: Number(r.similarity),
  }));
}

// ── 建立字幕 chunk ───────────────────────────────────────

/**
 * 把 CaptionSegment 轉成知識庫 chunk。
 *
 * ★ 欄位名要對：CaptionSegment 是
 *   id / sessionId / userId / text / speaker / seq / status / createdAt
 *   舊版讀的 `order` 與 `source` 兩個欄位不存在。
 */
export function captionSegmentsToChunks(
  rows: {
    id: string;
    sessionId: string;
    userId: string;
    text: string;
    speaker?: string | null;
    seq?: number | null;
    status?: string | null;
    createdAt?: Date;
  }[],
): KnowledgeChunk[] {
  return rows.map((r) => ({
    // 前綴是為了跟未來的 youtube- / podcast- 區分開。
    id: "cap-" + r.id,
    sourceType: "caption",
    sourceId: r.id,
    sourceRef: r.sessionId,
    text: r.text,
    metadata: {
      userId: r.userId,
      sessionId: r.sessionId,
      seq: r.seq ?? 0,
      speaker: r.speaker ?? "",
      status: r.status ?? "",
    },
    createdAt: r.createdAt,
  }));
}

/** 把已完成的字幕段落索引進知識庫。回傳本次處理的筆數。 */
export async function syncCaptionSegmentsToKnowledge(
  opts: { userId?: string; limit?: number } = {},
): Promise<{ synced: number; segments: number }> {
  const { userId, limit = 2000 } = opts;

  await ensureVectorSchema();

  const params: unknown[] = [];
  let where = `WHERE status = 'final' AND length(trim(text)) > 0`;
  if (userId) {
    params.push(userId);
    where += ` AND "userId" = $${params.length}`;
  }
  params.push(limit);

  const rows = await dbQuery<{
    id: string;
    sessionId: string;
    userId: string;
    text: string;
    speaker: string | null;
    seq: number | null;
    status: string | null;
    createdAt: Date;
  }>(
    `SELECT id, "sessionId", "userId", text, speaker, seq, status, "createdAt"
       FROM "CaptionSegment"
       ${where}
      ORDER BY "createdAt" DESC
      LIMIT $${params.length}`,
    params,
  );

  if (!rows.length) return { synced: 0, segments: 0 };

  const chunks = captionSegmentsToChunks(rows);
  const embeddings = await embedTexts(
    chunks.map((c) => c.text),
    "passage",
  );
  const synced = await upsertChunks(chunks, embeddings);

  return { synced, segments: rows.length };
}

// ── 組上下文 ────────────────────────────────────────────

export function buildContext(results: SearchResult[]): string {
  if (!results.length) return "";
  return results
    .map(
      (r, i) =>
        `[來源 ${i + 1} | ${r.sourceType} | 相似度 ${(r.similarity * 100).toFixed(0)}%]\n${r.text}`,
    )
    .join("\n\n");
}

// ── 生成回答 ────────────────────────────────────────────

const SYSTEM_PROMPT = `你是熾台 CHITAI 的知識庫助理。
使用者問題會附上從知識庫檢索到的片段。

規則：
1. 只根據片段回答。片段沒講的，不要用常識補。
2. 引用時用**半形方括號**寫成 [來源 1]、[來源 2] 的形式。
   不要用【】或《》—— 頁面上顯示的來源編號就是這個格式，
   格式不一致會讓人對不上是哪一筆。
3. 片段不足以回答，就說「知識庫裡沒有這方面的資料」——
   不要為了給答案而猜。
4. 用繁體中文。`;

/**
 * 檢索 + 生成回答。
 *
 * ★ 回傳真實的 sources。舊版永遠回 `sources: []`，
 *   卻要模型標註來源編號 —— 使用者看到引用卻查不到來源。
 */
export async function ragAnswer(
  question: string,
  opts: { topK?: number; model?: string } = {},
): Promise<RAGAnswer> {
  const { topK = 5, model = "openai/gpt-oss-120b" } = opts;

  const results = await searchSimilar(question, { topK });
  const context = buildContext(results);

  const userPrompt = context
    ? `知識庫片段：\n\n${context}\n\n問題：${question}`
    : `知識庫裡沒有與這個問題相關的片段。\n\n問題：${question}\n\n請直接說明查不到，不要推測。`;

  const routerUrl =
    process.env.GROQ_ROUTER_URL || "https://vercel-router-khaki.vercel.app";
  const routerKey = process.env.GROQ_ROUTER_KEY;
  if (!routerKey) {
    throw new Error("GROQ_ROUTER_KEY 未設定 —— 無法生成回答");
  }

  const res = await fetch(routerUrl + "/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + routerKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 1024,
      stream: false,
    }),
  });

  if (!res.ok) {
    throw new Error(`中轉服務回應 ${res.status}：${(await res.text()).slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  return {
    answer: data.choices?.[0]?.message?.content ?? "",
    sources: results,
    grounded: results.length > 0,
    usage: data.usage
      ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
        }
      : undefined,
  };
}

/** 知識庫概況（給頁面顯示用）。 */
export async function knowledgeStats() {
  await ensureVectorSchema();

  const total = await queryOne<{ n: number }>(
    "SELECT count(*)::int AS n FROM knowledge_chunks",
  );
  const byType = await dbQuery<{ source_type: string; n: number }>(
    "SELECT source_type, count(*)::int AS n FROM knowledge_chunks GROUP BY source_type ORDER BY n DESC",
  );
  const segs = await queryOne<{ n: number }>(
    `SELECT count(*)::int AS n FROM "CaptionSegment" WHERE status = 'final'`,
  );

  return {
    total: total?.n ?? 0,
    byType: byType.map((r) => ({ type: r.source_type, n: r.n })),
    captionSegments: segs?.n ?? 0,
  };
}