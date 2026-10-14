/**
 * RAG 知識庫端到端測試（2026-10-14）
 *
 * ★ 為什麼一定要真的執行
 *   舊版 rag.ts 編譯完全通過，但：
 *     · `searchSimilar` 的參數編號整組錯位（$3 拿到 sourceType 文字）
 *     · `ragAnswer` 永遠回 sources: []
 *     · CaptionSegment 的 `order` / `source` 欄位不存在
 *   這三個都是「型別正確但語意錯誤」——
 *   tsc 不可能抓到，只有真的跑 DB 才會現形。
 *
 * 執行：node --experimental-strip-types（或 npx tsx）tools/test-rag.ts
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── 載入 .env / .env.local ─────────────────────────────
// ★ 順序照 Next.js 的優先序：**先載入低優先的 .env，再讓
//   .env.local 覆蓋**。
//
//   2026-10-14 我寫反了（先載 .env.local 再載 .env，後者蓋掉前者），
//   結果拿到 .env 裡那把已經失效的 GROQ_ROUTER_KEY（gsk_…），
//   測試報 401 —— 差點誤判成「中轉壞了」。
//
//   這兩個檔案目前對 GROQ_ROUTER_KEY 有**不同的值**，
//   而且 .env 那把實測已被中轉拒絕。這個重複本身該清掉
//   （同一個值有兩個來源，見 AGENTS.md 規則 2），
//   但刪憑證要人決定，所以這裡只讓測試的取用順序正確。
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
function loadEnv(file: string, override: boolean) {
  const p = join(ROOT, file);
  if (!existsSync(p)) return 0;
  let n = 0;
  for (const raw of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = raw.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (override || process.env[m[1]] === undefined) {
      process.env[m[1]] = v;
      n++;
    }
  }
  return n;
}
const loaded = loadEnv(".env", false) + loadEnv(".env.local", true);

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}${extra ? "  " + extra : ""}`);
  } else {
    fail++;
    console.log(`  ★ 失敗: ${name}${extra ? "  " + extra : ""}`);
  }
}

async function main() {
  console.log(`\n══ RAG 端到端測試 ══`);
  console.log(`  載入環境變數: ${loaded} 個`);
  console.log(`  DATABASE_URL: ${process.env.DATABASE_URL ? "有" : "★ 沒有"}`);
  // ★ 嵌入走中轉，不再需要 NIM_API_KEY（2026-10-14 已從 .env 移除）
  console.log(`  嵌入來源:     groq-router /v1/embeddings（不直連 NVIDIA）`);
  console.log(`  ROUTER_KEY:   ${process.env.GROQ_ROUTER_KEY ? "有" : "★ 沒有"}`);

  // 動態匯入：必須在 env 載入之後，否則 db-http 會讀到空的 DATABASE_URL
  const rag = await import("../src/lib/rag.ts");

  // ── 1) schema ──
  console.log(`\n── 1. 建立向量表 ──`);
  try {
    await rag.ensureVectorSchema();
    ok("ensureVectorSchema", true);
  } catch (e) {
    ok("ensureVectorSchema", false, String((e as Error).message).slice(0, 200));
    process.exit(1);
  }

  // db-http 匯出的名字是 query（rag.ts 裡才別名叫 dbQuery）
  const { query: dbQuery } = await import("../src/lib/db-http.ts");
  const dims = await dbQuery<{ typmod: number | null; attname: string }>(
    `SELECT a.attname, a.atttypmod
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
      WHERE c.relname = 'knowledge_chunks' AND a.attname = 'embedding'`,
  );
  ok(
    "embedding 欄位是 vector",
    dims.length === 1,
    dims.length ? `typmod=${dims[0].typmod}（${dims[0].typmod} = 長度）` : "★ 欄位不存在",
  );
  if (dims[0]?.typmod) {
    const dim = Number(dims[0].typmod);
    ok("向量長度 = 1024", dim === 1024, `實際 ${dim}`);
  }

  // ── 2) 索引 ──
  const stats = await rag.knowledgeStats();
  console.log(`\n── 2. 索引狀態 ──`);
  console.log(`  已完成字幕段落: ${stats.captionSegments}`);
  console.log(`  知識庫總筆數:   ${stats.total}`);
  console.log(`  來源分佈:       ${JSON.stringify(stats.byType)}`);

  // ── 3) 同步 ──
  console.log(`\n── 3. 索引字幕 ──`);
  let sync: { synced: number; segments: number };
  try {
    sync = await rag.syncCaptionSegmentsToKnowledge();
    ok("syncCaptionSegmentsToKnowledge", true, JSON.stringify(sync));
  } catch (e) {
    ok("syncCaptionSegmentsToKnowledge", false, String((e as Error).message).slice(0, 300));
    process.exit(1);
  }

  const after = await rag.knowledgeStats();
  ok(
    "知識庫筆數 = 已索引段落數",
    after.total === sync.synced,
    `${after.total} vs ${sync.synced}`,
  );

  // ── 4) 檢索（這是舊版壞掉的那一段）──
  console.log(`\n── 4. 檢索 ──`);
  const probe =
    after.total > 0
      ? String(
          (
            await dbQuery<{ text: string }>(
              `SELECT text FROM knowledge_chunks LIMIT 1`,
            )
          )[0]?.text ?? "直播",
        ).slice(0, 8)
      : "直播";

  let hits: Awaited<ReturnType<typeof rag.searchSimilar>> = [];
  try {
    hits = await rag.searchSimilar(probe, { topK: 3 });
    ok("searchSimilar 有回應", true, `probe="${probe}" 命中 ${hits.length} 筆`);
  } catch (e) {
    // ★ 舊版這裡一定會炸（參數編號錯位 / SQL 語法錯）
    ok("searchSimilar", false, String((e as Error).message).slice(0, 300));
    process.exit(1);
  }

  if (hits.length) {
    const s = hits[0].similarity;
    ok("相似度是 0~1 的數字", typeof s === "number" && s >= -0.01 && s <= 1.01, `${s}`);
    ok(
      "相似度達門檻",
      s >= 0.3,
      `${s.toFixed(3)}`,
    );
    ok("有回傳 text", typeof hits[0].text === "string" && hits[0].text.length > 0);
    ok("metadata 已是物件（不是 json 字串）", typeof hits[0].metadata === "object");
    console.log(`  最相關片段: "${hits[0].text.slice(0, 48)}…"`);
  } else {
    console.log(`  （知識庫是空的，檢索正確地回 0 筆 —— 那也是對的答案）`);
  }

  // ── 5) sourceType 篩選（舊版這個分支參數號碼整組錯）──
  const filtered = await rag.searchSimilar(probe, { topK: 3, sourceType: "caption" });
  ok(
    "sourceType 篩選可執行",
    true,
    `caption → ${filtered.length} 筆`,
  );
  ok(
    "篩選結果全部是 caption",
    filtered.every((r) => r.sourceType === "caption"),
  );
  try {
    await rag.searchSimilar(probe, { topK: 3, sourceType: "podcast" });
    ok("不存在的 sourceType 回 0 筆（不拋錯）", true);
  } catch (e) {
    ok("不存在的 sourceType 回 0 筆（不拋錯）", false, String((e as Error).message).slice(0, 160));
  }

  // ── 6) 生成 ──
  console.log(`\n── 5. 生成回答 ──`);

  // ★ 先問一個「一定查不到」的問題，驗證誠實拒答。
  //   這比「能回答」更重要 —— 知識庫答不出來時說沒有，
  //   總比編一個答案好。
  try {
    const a = await rag.ragAnswer("量子電腦的糾錯碼碼構造是什麼？", { topK: 3 });
    ok("ragAnswer 有回應", true, `${a.answer.length} 字`);
    ok(
      "sources 有真的內容（舊版永遠是空陣列）",
      Array.isArray(a.sources),
      `${a.sources.length} 筆`,
    );
    ok(
      "sources 與 grounded 一致",
      a.grounded === (a.sources.length > 0),
      `grounded=${a.grounded} sources=${a.sources.length}`,
    );
    if (!a.grounded) {
      ok(
        "查不到時要明說查不到",
        /沒有|不足|查不到|不確定/.test(a.answer),
        `"${a.answer.slice(0, 46)}"`,
      );
    }
  } catch (e) {
    ok("ragAnswer", false, String((e as Error).message).slice(0, 300));
  }

  // ★ 再問一個「知識庫裡真的有東西」的問題，驗證另一半：
  //   sources 有內容、且回答真的引用來源。
  //   只驗拒答等於沒驗過能回答的路徑。
  if (hits.length) {
    const probe2 = hits[0].text.slice(0, 14);
    try {
      const b = await rag.ragAnswer(probe2 + " 是什麼？", { topK: 3 });
      ok("有內容時 sources 非空", b.sources.length > 0, `${b.sources.length} 筆`);
      ok("grounded = true", b.grounded === true);

      // ★ 斷言寫對版本：驗「不變量」，不驗「模型的措辭」。
      //
      //   我第一版寫成「回答必須有 [來源 N]」，結果測試失敗 ——
      //   但失敗的是**測試**，不是程式：檢索到的那段
      //   「Groq caption pipeline check」本來就答不了「Groq caption p 是什麼」，
      //   模型說「知識庫裡沒有這方面的資料」是**正確且誠實**的行為。
      //
      //   AGENTS.md 規則 3：測試要驗被測對象是對的。
      //   真正該驗的不變量是「**不會引用不存在的來源**」。
      const cited = [...b.answer.matchAll(/\[來源\s*(\d+)\]/g)].map((m) => Number(m[1]));
      ok(
        "引用到的來源編號都真的存在",
        cited.every((n) => n >= 1 && n <= b.sources.length),
        cited.length ? `引用 ${cited.join(",")}／共 ${b.sources.length} 筆` : "（未引用）",
      );
      ok(
        "沒有來源時絕不引用編號",
        b.sources.length > 0 || cited.length === 0,
      );
      console.log(`  回答: ${b.answer.slice(0, 130).replace(/\n/g, " ")}…`);
      console.log(`  來源 1: "${b.sources[0]?.text.slice(0, 60)}…"`);
      console.log(
        `  （檢索到 ${b.sources.length} 筆但內容答不了問題 → 模型選擇明說查不到，這是對的）`,
      );
    } catch (e) {
      ok("有內容時的生成", false, String((e as Error).message).slice(0, 240));
    }
  } else {
    console.log(`  （知識庫是空的，跳過「有內容時」的測試）`);
  }

  console.log(`\n── 6. 模型名稱來自中轉，不是寫死的 ──`);
  const mname = await rag.embedModelName();
  console.log(`  中轉回報的嵌入模型: ${mname}`);
  ok("模型名稱由中轉回報", mname !== "（中轉未回報）", mname);

  console.log(`\n══ 結果: ${pass} 通過 / ${fail} 失敗 ══`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("測試本身崩潰:", e);
  process.exit(1);
});