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

    // ★ 依 action 分派，不要讓「統計」默默吃掉所有 GET。
    //
    //   2026-10-14 踩到：GET /api/v1/rag?action=feeds
    //   回傳的是字幕統計 —— 因為原本 GET 只有統計一支，
    //   action 參數被**靜默忽略**。
    //
    //   那是最難查的一種 bug：端點回 200、body 形狀也合法，
    //   只是內容完全不是呼叫方要的。
    //   （AGENTS.md：症狀出現在離根因很遠的地方。）
    const action = new URL(req.url).searchParams.get("action") || "";

    if (action === "feeds") {
      const { listFeeds } = await import("@/lib/podcast");
      return NextResponse.json({ ok: true, feeds: await listFeeds(user.id) });
    }

    if (action === "episodes") {
      const feedId = new URL(req.url).searchParams.get("feedId") || "";
      if (!feedId) {
        return NextResponse.json({ error: "需要 feedId" }, { status: 400 });
      }
      const { listEpisodes } = await import("@/lib/podcast");
      return NextResponse.json({ ok: true, episodes: await listEpisodes(user.id, feedId) });
    }

    if (action === "" || action === "stats") {
      return NextResponse.json({ ok: true, ...(await knowledgeStats()) });
    }

    return NextResponse.json({ error: "未知的 action" }, { status: 400 });
  } catch (e) {
    return fail(e, "get");
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

/**
 * Podcast 來源的寫入動作。與 GET 分開是因為慢。
 *
 * ★ 為什麼不用 POST
 *   POST 已經被知識庫的 index/search/ask 佔用，
 *   再塞 podcast-* 進去會讓一個 handler 裡混兩種生命週期
 *   （查詢是毫秒級、轉錄是數十秒級）。
 *   分開之後要改成分配佇列時，改動只落在這裡。
 */
export async function PATCH(req: Request) {
  try {
    const user = await getOrCreateUser(getSessionId(req));
    if (!user) return unauthorized();

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const action = String(body.action || "");
    const { subscribeFeed, ingestEpisode } = await import("@/lib/podcast");

    if (action === "podcast-subscribe") {
      const feedUrl = String(body.feedUrl || "").trim();
      if (!feedUrl) {
        return NextResponse.json({ error: "請貼上 RSS 網址" }, { status: 400 });
      }
      if (!/^https?:\/\//i.test(feedUrl)) {
        return NextResponse.json(
          { error: "網址必須以 http:// 或 https:// 開頭" },
          { status: 400 },
        );
      }
      const r = await subscribeFeed(user.id, feedUrl);
      return NextResponse.json({ ok: true, ...r });
    }

    if (action === "podcast-ingest") {
      const guid = String(body.guid || "").trim();
      if (!guid) {
        return NextResponse.json({ error: "需要 guid" }, { status: 400 });
      }
      const r = await ingestEpisode(user.id, guid);
      return NextResponse.json({ ok: true, ...r });
    }

    return NextResponse.json({ error: "未知的 action" }, { status: 400 });
  } catch (e) {
    // ★ 這裡把錯誤訊息原樣回給使用者 —— 跟上面不一樣，而且是刻意的。
    //   ingest 的失敗都是使用者能自己處理的
    //   （音檔太大、集數選錯、feed 掛了），
    //   「知識庫操作失敗」這種訊息對他毫無幫助。
    const msg = String((e as Error).message || e);
    console.error("podcast PATCH:", msg);
    return NextResponse.json({ error: msg.slice(0, 300) }, { status: 400 });
  }
}