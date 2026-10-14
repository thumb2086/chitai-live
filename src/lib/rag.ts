/**
 * chitai-live RAG 知識庫模組
 */

import { Pool } from "@neondatabase/serverless";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const pgPool = new Pool({ connectionString: process.env.DATABASE_URL! });

const EMBED_MODEL = "nvidia/nemotron-3-embed-1b";
const EMBED_DIM = 1024;
const TOP_K = 5;
const SIMILARITY_THRESHOLD = 0.25;
const NIM_EMBED_URL = process.env.NIM_EMBED_URL || "https://integrate.api.nvidia.com/v1/embeddings";
const NIM_API_KEY = process.env.NIM_API_KEY!;

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const res = await fetch(NIM_EMBED_URL, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + NIM_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts, input_type: "passage", encoding_format: "float" }),
  });
  if (!res.ok) throw new Error("NIM embed failed: " + await res.text());
  const data = await res.json();
  return data.data.map((d: any) => d.embedding);
}

export interface KnowledgeChunk {
  id: string;
  sourceType: "caption" | "youtube" | "podcast" | "manual";
  sourceId: string;
  sourceRef?: string;
  text: string;
  metadata: Record<string, any>;
  createdAt: Date;
}

export function captionSegmentsToChunks(rows: any[]): any[] {
  return rows.map(function(r) {
    return {
      id: "cap-" + r.id,
      sourceType: "caption",
      sourceId: r.id,
      sourceRef: r.sessionId,
      text: r.text,
      metadata: { userId: r.userId, sessionId: r.sessionId, order: r.order, status: r.status, source: r.source },
      createdAt: r.createdAt,
    };
  });
}
 
export async function ensureVectorSchema(): Promise<void> {
  const pgPool2 = new (require("@neondatabase/serverless").Pool)({ connectionString: process.env.DATABASE_URL! });
  const sql = "CREATE EXTENSION IF NOT EXISTS vector; CREATE TABLE IF NOT EXISTS knowledge_chunks (id text PRIMARY KEY, source_type text NOT NULL, source_id text NOT NULL, source_ref text, text text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}', embedding vector(1024) NOT NULL, created_at timestamptz NOT NULL DEFAULT now()); CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_idx ON knowledge_chunks USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64); CREATE INDEX IF NOT EXISTS knowledge_chunks_source_idx ON knowledge_chunks (source_type, source_id);";
  await pgPool2.query(sql);
}

export async function upsertChunks(chunks: any[], embeddings: number[][]): Promise<number> {
  if (chunks.length !== embeddings.length) throw new Error("length mismatch");
  if (!chunks.length) return 0;
  const pgPool2 = new (require("@neondatabase/serverless").Pool)({ connectionString: process.env.DATABASE_URL! });
  let total = 0;
  for (let i = 0; i < chunks.length; i += 100) {
    const batch = chunks.slice(i, i + 100);
    const embs = embeddings.slice(i, i + 100);
    const values = batch.map((c, idx) => ({
      id: c.id, source_type: c.sourceType, source_id: c.sourceId, source_ref: c.sourceRef ?? null,
      text: c.text, metadata: c.metadata, embedding: "[" + embs[idx].join(",") + "]", created_at: c.createdAt,
    }));
    const placeholders = values.map((_, idx) => {
      const base = idx * 7;
      return "($" + (base + 1) + ", $" + (base + 2) + ", $" + (base + 3) + ", $" + (base + 4) + ", $" + (base + 5) + ", $" + (base + 6) + "::vector, $" + (base + 7) + ")";
    }).join(", ");
    const params = values.flatMap(v => [v.id, v.source_type, v.source_id, v.source_ref, v.text, v.metadata, v.embedding, v.created_at]);
    const query = "INSERT INTO knowledge_chunks (id, source_type, source_id, source_ref, text, metadata, embedding, created_at) VALUES " +
      values.map((_, idx) => { const base = idx * 7; return "($" + (base + 1) + ", $" + (base + 2) + ", $" + (base + 3) + ", $" + (base + 4) + ", $" + (base + 5) + ", $" + (base + 6) + "::vector, $" + (base + 7) + ")"; }).join(", ") +
      " ON CONFLICT (id) DO UPDATE SET source_type=EXCLUDED.source_type, source_id=EXCLUDED.source_id, source_ref=EXCLUDED.source_ref, text=EXCLUDED.text, metadata=EXCLUDED.metadata, embedding=EXCLUDED.embedding";
    await pgPool2.query(query, params);
    total += batch.length;
  }
  return total;
}

export interface SearchResult { id: string; sourceType: string; sourceId: string; sourceRef: string | null; text: string; metadata: Record<string, any>; similarity: number; }

export async function searchSimilar(query: string, opts: { topK?: number; threshold?: number; sourceType?: string } = {}): Promise<any[]> {
  const { topK = 5, threshold = 0.25, sourceType } = opts;
  const [qEmb] = await embedTexts([query]);
  let where = ""; const params: any[] = [JSON.stringify(qEmb)]; let paramIdx = 2;
  if (sourceType) { where = "WHERE source_type = $" + paramIdx++; params.push(sourceType); }
  const sqlQuery = "SELECT id, source_type, source_id, source_ref, text, metadata, 1 - (embedding <=> $1::vector) AS similarity FROM knowledge_chunks " + where + " AND 1 - (embedding <=> $1::vector) >= $" + paramIdx + " ORDER BY embedding <=> $1::vector LIMIT $" + (paramIdx + 1);
  params.push(threshold, 5); params.unshift(JSON.stringify(qEmb));
  const pgPool = new (require("@neondatabase/serverless").Pool)({ connectionString: process.env.DATABASE_URL! });
  const result = await pgPool.query(sqlQuery, params);
  return result.rows.map(r => ({ id: r.id, sourceType: r.source_type, sourceId: r.source_id, sourceRef: r.source_ref, text: r.text, metadata: r.metadata, similarity: Number(r.similarity) }));
}

export function buildContext(results: any[]): string {
  if (!results.length) return "";
  return results.map((r, i) => "[來源 " + (i + 1) + " | " + r.sourceType + ":" + r.sourceId + " | 相似度 " + (r.similarity * 100).toFixed(1) + "%]\n" + r.text).join("\n\n---\n\n");
}

export interface SearchResult { id: string; sourceType: string; sourceId: string; sourceRef: string | null; text: string; metadata: Record<string, any>; similarity: number; }

export async function syncCaptionSegmentsToKnowledge() {
  const rows = await (new (require("@prisma/client").PrismaClient)()).captionSegment.findMany({ where: { status: "final" }, orderBy: { createdAt: "desc" } });
  const chunks = rows.map(r => ({ id: "cap-" + r.id, sourceType: "caption", sourceId: r.id, sourceRef: r.sessionId, text: r.text, metadata: { userId: r.userId, sessionId: r.sessionId, order: r.order, status: r.status, source: r.source }, createdAt: r.createdAt }));
  const texts = chunks.map(c => c.text); const embeddings = await embedTexts(texts); await ensureVectorSchema(); const n = await upsertChunks(chunks, embeddings); return { synced: n, chunks: chunks.length };
}

export interface RAGAnswer { answer: string; sources: any[]; usage?: any; }

export async function ragAnswer(question: string, opts: { topK?: number; model?: string; stream?: boolean } = {}): Promise<any> {
  const { topK = 5, model = "openai/gpt-oss-120b" } = opts;
  const results = await searchSimilar(question, { topK });
  const context = results.map((r, i) => "[來源 " + (i + 1) + " | " + r.sourceType + ":" + r.sourceId + " | 相似度 " + (r.similarity * 100).toFixed(1) + "%]\n" + r.text).join("\n\n---\n\n");
  const systemPrompt = "你是熾台 CHITAI 的助理。\n使用者的問題會附上從知識庫檢索到的相關片段。\n規則：\n1. 只根據提供的片段回答，不要憑空捏造。\n2. 如果片段不足以回答，誠實說「根據現有資料無法確定」。\n3. 回答時標註來源編號，如 [來源 1]。\n4. 語言跟隨使用者（繁體中文）。";
  const userPrompt = context ? "以下是知識庫檢索到的相關片段：\n\n" + context + "\n\n使用者問題：" + question : "知識庫目前沒有相關資料。使用者問題：" + question + "\n\n請誠實說明資料不足。";
  const routerUrl = process.env.GROQ_ROUTER_URL || "https://vercel-router-khaki.vercel.app";
  const routerKey = process.env.GROQ_ROUTER_KEY!;
  const res = await fetch(routerUrl + "/v1/chat/completions", { method: "POST", headers: { Authorization: "Bearer " + routerKey, "Content-Type": "application/json" }, body: JSON.stringify({ model: "openai/gpt-oss-120b", messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], temperature: 0.3, max_tokens: 1024, stream: false }) });
  if (!res.ok) throw new Error("Router " + res.status + ": " + await res.text());
  const data = await res.json(); return { answer: data.choices[0]?.message?.content ?? "", sources: [], usage: data.usage };
}