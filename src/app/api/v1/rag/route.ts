import { NextResponse } from "next/server";
import { getOrCreateUser, getSessionId, unauthorized } from "@/lib/getUser";
import {
  knowledgeStats,
  syncCaptionSegmentsToKnowledge,
  searchSimilar,
  ragAnswer,
} from "@/lib/rag";

/**
 * 知識庫 API（2026-10-14）
 *
 *   GET                            → 索引概況
 *   POST { action:"index" }        → 把字幕段落寫進知識庫
 *   POST { action:"search", query} → 只檢索，不生成
 *   POST { action:"ask", question } → 檢索 + 生成回答
 *
 * ─────────────────────────────────────────────────────────────
 * 為什麼 search 與 ask 是兩個動作
 * ─────────────────────────────────────────────────────────────
 *
 * 生成要花 Groq 的錢。「東西在不在知識庫裡」不該花錢。
 * 而且 search 的結果可以先給使用者看，
 * 要不要展開成回答由他決定 —— 不是每次都替他決定。
 *
 * ─────────────────────────────────────────────────────────────
 * 為什麼現在只有字幕一種來源
 * ─────────────────────────────────────────────────────────────
 *
 * 三種來源共用同一張 knowledge_chunks（用 source_type 區分），
 * 所以新增 YT／Podcast 不需要改任何既有程式。
 * 但一次做三個來源等於三倍出錯面積，
 * 而且連一條鏈路都還沒真的跑過 ——
 * 先把字幕端到端驗通，再往上加。
 */

function fail(e: unknown, where: string) {
  // ★ 上游錯誤訊息可能含 NIM 端點細節或 Neon 的表名欄名。
  //   那不是給使用者看的，寫進 log 就行。
  console.error(`rag ${where}:`, e);
  return NextResponse.json({ error: "知識庫操作失敗" }, { status: 500 });
}

export async function GET(req: Request) {
  try {
    const user = await getOrCreateUser(getSessionId(req));
    if (!user) return unauthorized();
    return NextResponse.json({ ok: true, ...(await knowledgeStats()) });
  } catch (e) {
    return fail(e, "stats");
  }
}

export async function POST(req: Request) {
  try {
    const user = await getOrCreateUser(getSessionId(req));
    if (!user) return unauthorized();

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const action = String(body.action || "");

    if (action === "index") {
      const r = await syncCaptionSegmentsToKnowledge();
      return NextResponse.json({ ok: true, ...r });
    }

    if (action === "search") {
      const q = String(body.query || "").trim();
      if (!q) {
        return NextResponse.json({ error: "請輸入要搜尋的內容" }, { status: 400 });
      }
      const results = await searchSimilar(q, { topK: Number(body.topK) || 5 });
      return NextResponse.json({ ok: true, results });
    }

    if (action === "ask") {
      const q = String(body.question || "").trim();
      if (!q) {
        return NextResponse.json({ error: "請輸入問題" }, { status: 400 });
      }
      return NextResponse.json({ ok: true, ...(await ragAnswer(q, { topK: Number(body.topK) || 5 })) });
    }

    return NextResponse.json({ error: "未知的 action" }, { status: 400 });
  } catch (e) {
    return fail(e, "post");
  }
}