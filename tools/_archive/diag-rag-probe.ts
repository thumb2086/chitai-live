/**
 * 診斷：test-rag.ts 的「搜尋命中 0 筆」是產品壞掉，還是探針本身不對？
 *
 * 做法：先從資料庫**取一個真的存在的句子**當探針，
 * 再跑 searchSimilar。命中 → 檢索機制是好的，問題在測試的探針。
 * 連那個都命中不了 → 才是產品 bug。
 *
 * ⚠️ 包成 async main()：這個專案沒有 "type": "module"，
 *    tsx 會用 cjs 輸出，而 cjs 不支援 top-level await。
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
function loadEnv(file: string, override: boolean) {
  const p = join(ROOT, file);
  if (!existsSync(p)) return;
  for (const raw of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = raw.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (override || process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadEnv(".env", false);
loadEnv(".env.local", true);

async function main() {
  const { query: dbQuery } = await import("@/lib/db-http");
  const { searchSimilar } = await import("@/lib/rag");
  const rows = await dbQuery<{ id: string; text: string; source_type: string }>(
    `SELECT id, text, source_type FROM knowledge_chunks ORDER BY created_at DESC LIMIT 3`,
  );
  console.log("取樣", rows.length, "筆：");
  for (const r of rows) console.log(`  [${r.source_type}] ${r.text.slice(0, 60)}`);

  const probe = (rows[0]?.text ?? "").slice(0, 40);
  console.log("\n探針（原句前 40 字）:", JSON.stringify(probe));

  const hits = await searchSimilar(probe, { topK: 3 });
  console.log("searchSimilar 命中:", hits.length);
  for (const h of hits) console.log(`  ${h.similarity.toFixed(4)}  ${h.text.slice(0, 60)}`);

  const none = await dbQuery<{ n: number }>(`SELECT count(*)::int AS n FROM knowledge_chunks`);
  console.log("\n知識庫總筆數:", none[0]?.n);
}

main().catch((e) => {
  console.error("diag 失敗:", e);
  process.exitCode = 1;
});