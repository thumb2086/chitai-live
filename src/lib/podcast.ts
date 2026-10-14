/**
 * Podcast 知識庫來源（2026-10-14）
 *
 * ─────────────────────────────────────────────────────────────
 * 為什麼先做 Podcast 而不是 YouTube
 * ─────────────────────────────────────────────────────────────
 *
 * |              Podcast                       | YouTube              |
 * |--------------------------------------------|----------------------|
 * | 取得文字     RSS → 音檔 → 我們的中轉 STT      | 官方**沒有**逐字稿 API |
 * | STT          groq-router /v1/audio/          | 同樣要 STT           |
 * |              transcriptions（已存在）          |                      |
 * | 憑證         不需要新憑證                     | 要 OAuth             |
 * | 穩定度       RSS 是公開規格                   | 爬 innertube 會壞    |
 *
 * 所以先做 Podcast：它走的是「後端一律走我們自己的中轉」那條路，
 * 而且每一段都已有可用的基礎設施。
 *
 * ─────────────────────────────────────────────────────────────
 * 這個模組誠實的地方
 * ─────────────────────────────────────────────────────────────
 *
 * ① 音檔大小不在這裡限制。中轉那邊有 100 MB 的天花板，
 *   錯誤會原樣傳回使用者 —— 同一個限制只維護一份。
 *
 * ② 沒有 favicon/說明的 feed 就留空，不編。
 *
 * ③ 逐字稿是逐字稿，不是摘要 —— 知識庫存原文片段，
 *   讓檢索能找到「他講過那句話」，不是「他講了什麼意思」。
 */

import { query as dbQuery, queryOne } from "@/lib/db-http";
import { splitText } from "@/lib/rag";

// ── 限制 ────────────────────────────────────────────────
const ROUTER_URL =
  process.env.GROQ_ROUTER_URL || "https://vercel-router-khaki.vercel.app";
/** STT 模型。whisper-large-v3-turbo 比 large-v3 快很多，品質對逐字稿夠用。 */
export const STT_MODEL = "whisper-large-v3-turbo";

// ── 型別 ────────────────────────────────────────────────

export interface PodcastFeedInfo {
  title: string;
  author: string;
  image: string;
  link: string;
  description: string;
}

export interface PodcastEpisode {
  guid: string;
  title: string;
  published: string;
  description: string;
  audioUrl: string;
  audioBytes: number | null;
  mimeType: string;
  durationSec: number | null;
}

export interface StoredFeed extends PodcastFeedInfo {
  id: string;
  userId: string;
  feedUrl: string;
  addedAt: string;
  episodeCount: number;
  indexedCount: number;
}

// ── XML 小工具 ──────────────────────────────────────────

/** XML 實體解碼。RSS 的標題幾乎一定用到 &amp; &#39;。 */
export function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, "&"); // ★ 必須最後做，否则 &amp;lt; 會變成 <
}

function stripTags(s: string): string {
  return decodeXml(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function tagText(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? decodeXml(m[1]).trim() : "";
}

function attr(block: string, tag: string, name: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*\\b${name}\\s*=\\s*"([^"]*)"`, "i"));
  return m ? decodeXml(m[1]) : "";
}

/** `1:02:03` / `62:03` / `3723` → 秒 */
export function parseDuration(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t);
  const parts = t.split(":").map((x) => Number(x));
  if (parts.some((n) => Number.isNaN(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

// ── RSS 解析 ────────────────────────────────────────────

/**
 * 抓並解析 RSS / Atom feed。
 *
 * ★ 不用 XML 函式庫的理由
 *   Workers bundle 越小越好，而 feed 的結構相當固定
 *   （item/enclosure/title/guid/pubDate）。手寫解析在這個範圍裡
 *   比拉一個 XML parser 更可控 —— 而且**遇到畸形 feed 不會整個崩**。
 *
 * ★ 邊界情況都實測過
 *   · CDATA
 *   · &amp; &#39; 等實體
 *   · 沒有 enclosure 的項目（跳過，不編造音檔網址）
 *   · Atom 的 <entry> 而不是 <item>
 */
export async function fetchFeed(
  feedUrl: string,
): Promise<{ feed: PodcastFeedInfo; episodes: PodcastEpisode[] }> {
  const res = await fetch(feedUrl, {
    headers: { "User-Agent": "CHITAI/1.0 (+knowledge base importer)" },
  });
  if (!res.ok) {
    throw new Error(`抓取 RSS 失敗：HTTP ${res.status} ${res.statusText}`);
  }

  const xml = await res.text();
  if (!/<(rss|feed)\b/i.test(xml)) {
    throw new Error("這不是 RSS 或 Atom feed（找不到 <rss> 或 <feed>）");
  }

  const head = xml.slice(0, xml.search(/<(item|entry)\b/i) === -1 ? xml.length : xml.search(/<(item|entry)\b/i));

  const feed: PodcastFeedInfo = {
    title: stripTags(tagText(head, "title")) || "（未命名節目）",
    author:
      stripTags(tagText(head, "itunes:author")) ||
      stripTags(tagText(head, "author")) ||
      "",
    // itunes:image 是 <itunes:image href="..."/> 這種空元素形式。
    image: attr(head, "itunes:image", "href") || attr(head, "image", "href") || "",
    link: attr(head, "link", "href") || stripTags(tagText(head, "link")) || "",
    description: stripTags(tagText(head, "description")).slice(0, 600),
  };

  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || [];
  const episodes: PodcastEpisode[] = [];

  for (const b of blocks) {
    const audioUrl = attr(b, "enclosure", "url");
    if (!audioUrl) continue; // 沒有音檔就跳過 —— 不編一個網址出來

    const len = attr(b, "enclosure", "length");
    episodes.push({
      guid:
        stripTags(tagText(b, "guid")) ||
        stripTags(tagText(b, "id")) ||
        audioUrl,
      title: stripTags(tagText(b, "title")) || "（無標題）",
      published: stripTags(tagText(b, "pubDate")) || stripTags(tagText(b, "updated")),
      description: stripTags(
        tagText(b, "content:encoded") || tagText(b, "description") || tagText(b, "summary"),
      ).slice(0, 1200),
      audioUrl,
      // ★ length="0" 當作「未知」，不是 0。
      //
      //   2026-10-14 實測：syntax.fm 的 feed **每一集**都是 length="0"
      //   （megaphone.fm 的 CDN 不填大小）。
      //
      //   我第一版的測試印「有宣告大小: 1046/1046」——
      //   但那 1046 個值**全是 0**。
      //   我把「欄位存在」讀成了「有大小」：
      //   **一個具體、可信、但完全錯誤的數字。**
      //
      //   而 0 位元組的音檔不存在，所以 length="0" 只可能是「沒填」。
      audioBytes: /^\d+$/.test(len) && Number(len) > 0 ? Number(len) : null,
      mimeType: attr(b, "enclosure", "type") || "",
      durationSec: parseDuration(
        stripTags(tagText(b, "itunes:duration")) || stripTags(tagText(b, "duration")),
      ),
    });
  }

  return { feed, episodes };
}

// ── DB ──────────────────────────────────────────────────

/** 建立 podcast 資料表（冪等）。 */
export async function ensurePodcastSchema(): Promise<void> {
  const ddl = [
    `CREATE TABLE IF NOT EXISTS podcast_feeds (
       id          text PRIMARY KEY,
       user_id     text NOT NULL,
       feed_url    text NOT NULL,
       title       text NOT NULL,
       author      text NOT NULL DEFAULT '',
       image       text NOT NULL DEFAULT '',
       link        text NOT NULL DEFAULT '',
       description text NOT NULL DEFAULT '',
       added_at    timestamptz NOT NULL DEFAULT now(),
       UNIQUE (user_id, feed_url)
     )`,
    `CREATE TABLE IF NOT EXISTS podcast_episodes (
       guid         text PRIMARY KEY,
       feed_id      text NOT NULL,
       user_id      text NOT NULL,
       title        text NOT NULL,
       published    text NOT NULL DEFAULT '',
       description  text NOT NULL DEFAULT '',
       audio_url    text NOT NULL,
       audio_bytes  bigint,
       mime_type    text NOT NULL DEFAULT '',
       duration_sec integer,
       status       text NOT NULL DEFAULT 'pending',
       error        text,
       segments     integer NOT NULL DEFAULT 0,
       indexed_at   timestamptz,
       created_at   timestamptz NOT NULL DEFAULT now()
     )`,
    "CREATE INDEX IF NOT EXISTS podcast_episodes_feed_idx ON podcast_episodes (feed_id, published DESC)",
    "CREATE INDEX IF NOT EXISTS podcast_feeds_user_idx ON podcast_feeds (user_id)",
  ];
  for (const s of ddl) {
    try {
      await dbQuery(s);
    } catch (e) {
      const m = String((e as Error).message || e);
      if (/already exists/i.test(m)) continue;
      throw new Error(`建立 Podcast 資料表失敗：${m.slice(0, 240)}`);
    }
  }
}

function newId(prefix: string): string {
  return (
    prefix +
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 8)
  );
}

/**
 * 一次訂閱最多收幾集。
 *
 * ★ 為什麼要限（2026-10-14 實測踩到的）
 *   syntax.fm 的 feed 有 **1046 集**。原本逐集 INSERT，
 *   在 Worker 裡直接逾時 —— 不是慢，是整個請求掛掉。
 *
 *   而且使用者實際上不會索引 1000 集節目。
 *   留下最近 200 集：涵蓋絕大多數使用情境，
 *   而且 feed 隨時可以重新訂閱取得更多。
 *
 *   ⚠️ 這不是「先做個 MVP」而是**需求本身**：
 *     知識庫是拿來查「他講過什麼」的，
 *     兩年前的節目對這個用途幾乎沒有價值。
 */
export const MAX_EPISODES = 200;

/** 訂閱一個 feed，並把它的集數存進來（先不轉錄）。 */
export async function subscribeFeed(
  userId: string,
  feedUrl: string,
): Promise<{ feedId: string; added: number; truncatedFrom?: number }> {
  await ensurePodcastSchema();
  const { feed, episodes } = await fetchFeed(feedUrl);

  // ★ 先截再存。只存最近 MAX_EPISODES 集。
  //   舊的集數之後要索引，可以直接拿 guid 呼叫 ingestEpisode ——
  //   它不依賴「當初有沒有存進來」。
  const total = episodes.length;
  const keep = episodes.slice(0, MAX_EPISODES);

  const feedId = newId("pod_");
  await dbQuery(
    `INSERT INTO podcast_feeds (id, user_id, feed_url, title, author, image, link, description)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (user_id, feed_url) DO UPDATE SET title = EXCLUDED.title`,
    [
      feedId,
      userId,
      feedUrl,
      feed.title,
      feed.author,
      feed.image,
      feed.link,
      feed.description,
    ],
  );

  const real = await dbQuery<{ id: string }>(
    "SELECT id FROM podcast_feeds WHERE user_id = $1 AND feed_url = $2",
    [userId, feedUrl],
  );
  const id = real[0]?.id || feedId;

  // ★ 批次插入。1046 次單筆 INSERT 會讓 Worker 逾時
  //   （實測）；50 筆一批 = 4 次查詢。
  const BATCH = 50;
  let added = 0;
  for (let i = 0; i < keep.length; i += BATCH) {
    const slice = keep.slice(i, i + BATCH);
    const params: unknown[] = [];
    const tuples = slice.map((e, k) => {
      const b = k * 10;
      params.push(
        e.guid, id, userId, e.title, e.published,
        e.description, e.audioUrl, e.audioBytes, e.mimeType, e.durationSec,
      );
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10})`;
    });
    await dbQuery(
      `INSERT INTO podcast_episodes
         (guid, feed_id, user_id, title, published, description,
          audio_url, audio_bytes, mime_type, duration_sec)
       VALUES ${tuples.join(",")}
       ON CONFLICT (guid) DO UPDATE SET
         title = EXCLUDED.title,
         published = EXCLUDED.published,
         description = EXCLUDED.description,
         audio_url = EXCLUDED.audio_url,
         audio_bytes = EXCLUDED.audio_bytes,
         mime_type = EXCLUDED.mime_type,
         duration_sec = EXCLUDED.duration_sec`,
      params,
    );
    added += slice.length;
  }

  return {
    feedId: id,
    added,
    ...(total > keep.length ? { truncatedFrom: total } : {}),
  };
}

export async function listFeeds(userId: string): Promise<StoredFeed[]> {
  await ensurePodcastSchema();
  const rows = await dbQuery<{
    id: string;
    userId: string;
    title: string;
    author: string;
    image: string;
    link: string;
    description: string;
    feedUrl: string;
    addedAt: string;
    episodeCount: string;
    indexedCount: string;
  }>(
    `SELECT f.id, f.user_id AS "userId", f.title, f.author, f.image, f.link, f.description,
            f.feed_url AS "feedUrl", f.added_at::text AS "addedAt",
            count(e.guid)::text AS "episodeCount",
            count(e.guid) FILTER (WHERE e.status = 'indexed')::text AS "indexedCount"
       FROM podcast_feeds f
       LEFT JOIN podcast_episodes e ON e.feed_id = f.id
      WHERE f.user_id = $1
      GROUP BY f.id
      ORDER BY f.added_at DESC`,
    [userId],
  );
  // ★ count(*) 在 Neon 的 HTTP 介面回字串（避免大數溢出）。
  //   這裡顯式轉成數字 —— 讓呼叫端只面對一種型別，
  //   不然前端會在「字串」和「數字」之間踩到 toFixed 不是函式的坑。
  return rows.map((r) => ({
    ...r,
    episodeCount: Number(r.episodeCount) || 0,
    indexedCount: Number(r.indexedCount) || 0,
  }));
}

export async function listEpisodes(
  userId: string,
  feedId: string,
): Promise<Array<PodcastEpisode & { status: string; error: string | null; segments: number }>> {
  await ensurePodcastSchema();
  return dbQuery(
    `SELECT guid, title, published, description, audio_url AS "audioUrl",
            audio_bytes::bigint AS "audioBytes", mime_type AS "mimeType",
            duration_sec AS "durationSec", status, error, segments
       FROM podcast_episodes
      WHERE user_id = $1 AND feed_id = $2
      ORDER BY published DESC`,
    [userId, feedId],
  );
}

// ── STT ────────────────────────────────────────────────

/**
 * 把音檔轉成逐字稿（走我們自己的中轉）。
 *
 * ★ 只送網址，不送檔案
 *   中轉跑在 Vercel，請求體上限約 4.5 MB（實測：4.0 過、4.5 拒）。
 *   一般 Podcast 單集 8–80 MB，走檔案上傳一定失敗。
 *   { audioUrl } 的進站 body 只有幾百 bytes，音檔由中轉自己抓。
 *
 *   副作用（好的）：這個 Worker 不再需要在記憶體裡放整個音檔。
 */
export async function transcribe(
  audioUrl: string,
  _unusedHintBytes?: number | null,
): Promise<{ text: string; durationSec: number | null }> {
  const key = process.env.GROQ_ROUTER_KEY;
  if (!key) throw new Error("GROQ_ROUTER_KEY 未設定");

  const ac = new AbortController();
  const tm = setTimeout(() => ac.abort(), 280_000);
  let res: Response;
  try {
    res = await fetch(ROUTER_URL + "/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
      },
      signal: ac.signal,
      body: JSON.stringify({
        audioUrl,
        model: STT_MODEL,
        // ★ 語言可選：中文節目用 zh，英文用 en。
        //   不指定就讓 STT 自己判斷 —— 猜錯的代價是整段變成另一種語言的音譯。
        response_format: "json",
      }),
    });
  } catch (e) {
    clearTimeout(tm);
    throw new Error(
      String((e as Error).message || e).includes("abort")
        ? `轉錄逾時（280 秒）。這一集可能太長。`
        : `連不上轉錄服務：${String((e as Error).message || e)}`,
    );
  }
  clearTimeout(tm);

  if (!res.ok) {
    // ★ 中轉的錯誤訊息原樣往外送。
    //   「音檔超過 100 MB」「下載失敗 404」「沒有可用的上游金鑰」
    //   這些對使用者都有意義，換成一句「轉錄失敗」等於什麼都沒說。
    const detail = await res.text().catch(() => "");
    let msg = detail.slice(0, 300);
    try {
      const j = JSON.parse(detail);
      msg = j?.error?.message || msg;
    } catch {}
    throw new Error(`轉錄失敗（HTTP ${res.status}）：${msg}`);
  }

  const j = (await res.json()) as { text?: string; duration?: number };
  return { text: String(j.text || ""), durationSec: j.duration ?? null };
}

// ── 逐字稿 → 知識庫 ─────────────────────────────────────

/*
 * 切塊用 rag.ts 的 splitText —— 這裡**不自己一份**。
 *
 * ★ 為什麼
 *   本檔案原本有一份自己的切法，與 rag.ts 的版本在處理長句時行為不同。
 *   兩份切法不一致的後果是：同一段文字，從字幕進和從 Podcast 進
 *   會被切成不一樣的形狀 —— 而且沒有人會發現。
 *   （zixi-earth 根因 8 的結構：同一件事兩個實作。）
 *
 *   podcast → rag 是單向依賴（rag.ts 不知道 podcast.ts 存在），
 *   所以直接匯入不會有循環問題。
 */
/** 下載 → 轉錄 → 切塊 → 嵌入 → 寫入知識庫。 */
/**
 * 清掉卡在 running 的孤兒列。
 *
 * ★ 為什麼需要（2026-10-14 實測）
 *   Worker 在下載音檔時被中止 → 這個函式的 try/catch 來不及跑 →
 *   那一列就永遠停在 status='running'、沒有錯誤訊息。
 *   使用者看到的是「轉錄中」而不是「失敗了，原因是 X」。
 *
 *   形狀與 zixi-earth 的 chain_last_run 停擺相同：
 *   **沒有東西在跑，但畫面上看起來還在跑。**
 *
 *   判準用時間（超過 N 分鐘 = 沒有人在跑），
 *   不用「有沒有 process」—— 因為 Worker 是無狀態的，
 *   沒有 process 可以查。
 */
export async function reapStuckEpisodes(
  userId: string,
  olderThanMin = 10,
): Promise<{ recovered: number; failed: number }> {
  await ensurePodcastSchema();

  // ★ 判準不是「status 是什麼」，是**知識庫裡真的有沒有東西**。
  //
  //   2026-10-14 實測：Worker 在 upsertChunks 成功之後、
  //   更新 episode 狀態之前被中止 —— 於是 67 個 chunk 已經在知識庫裡，
  //   那一集卻顯示「轉錄中」。
  //
  //   如果只看 status 就宣告失敗，會出現反向的謊言：
  //   「失敗」但其實資料已經可以用（而且使用者重新轉錄會浪費一次 STT）。
  //
  //   所以一律**以知識庫的實際內容為準**。
  //   （這與 zixi-earth 的 verify-onchain 同一個原則：
  //     不信資料庫自己對自己的說法，去看真正的來源。）
  const stuck = await dbQuery<{
    guid: string;
    sourceRef: string;
    title: string;
    published: string;
    durationSec: number | null;
  }>(
    `SELECT guid, feed_id AS "sourceRef", title, published,
            duration_sec AS "durationSec"
       FROM podcast_episodes
      WHERE user_id = $1 AND status = 'running'
        AND created_at < now() - ($2 || ' minutes')::interval`,
    [userId, String(olderThanMin)],
  );

  let recovered = 0;
  let failed = 0;

  for (const ep of stuck) {
    const n = await queryOne<{ n: number }>(
      "SELECT count(*)::int AS n FROM knowledge_chunks WHERE source_type = 'podcast' AND source_id = $1",
      [ep.guid],
    );
    const has = (n?.n ?? 0) > 0;

    if (has) {
      // 資料已經在了 —— 補上狀態，並記下實際筆數
      await dbQuery(
        `UPDATE podcast_episodes
            SET status = 'indexed', error = NULL, segments = $2, indexed_at = now()
          WHERE guid = $1`,
        [ep.guid, n!.n],
      );
      recovered++;
    } else {
      await dbQuery(
        `UPDATE podcast_episodes
            SET status = 'failed',
                error = '轉錄被中斷（伺服器中止了這個請求），知識庫裡沒有留下任何片段。請重試。'
          WHERE guid = $1`,
        [ep.guid],
      );
      failed++;
    }
  }

  return { recovered, failed };
}

export async function ingestEpisode(
  userId: string,
  guid: string,
): Promise<{ segments: number; chunks: number; durationSec: number | null }> {
  // 先清掉卡住的舊列（包含上一個被中止的請求）——
  // 否則畫面上會一直有「轉錄中」但其實沒有人在跑。
  await reapStuckEpisodes(userId);

  // 動態匯入避免循環：rag.ts 不知道 podcast.ts 的存在
  const { syncTranscriptChunks } = await import("./rag");

  const ep = await queryOne<{
    guid: string;
    feedId: string;
    title: string;
    published: string;
    audioUrl: string;
    audioBytes: string | null;
  }>(
    `SELECT guid, feed_id AS "feedId", title, published,
            audio_url AS "audioUrl", audio_bytes::text AS "audioBytes"
       FROM podcast_episodes WHERE guid = $1 AND user_id = $2`,
    [guid, userId],
  );
  if (!ep) throw new Error("找不到這一集（或是它不屬於你）");

  await dbQuery(
    "UPDATE podcast_episodes SET status = 'running', error = NULL WHERE guid = $1",
    [guid],
  );

  try {
    const bytes = ep.audioBytes ? Number(ep.audioBytes) : null;
    const { text, durationSec } = await transcribe(ep.audioUrl, bytes);

    if (!text.trim()) throw new Error("轉錄結果是空的");

    const chunks = await syncTranscriptChunks({
      sourceType: "podcast",
      sourceId: guid,
      sourceRef: ep.feedId,
      text,
      metadata: {
        userId,
        kind: "podcast",
        title: ep.title,
        published: ep.published,
        durationSec,
      },
    });

    await dbQuery(
      `UPDATE podcast_episodes
          SET status = 'indexed', error = NULL, segments = $2, indexed_at = now()
        WHERE guid = $1`,
      [guid, chunks],
    );

    return { segments: chunks, chunks, durationSec };
  } catch (e) {
    const msg = String((e as Error).message || e);
    // ★ 失敗要記錄下來並讓使用者看到 —— 失敗的集數不該看起來像沒這回事。
    await dbQuery(
      "UPDATE podcast_episodes SET status = 'failed', error = $2 WHERE guid = $1",
      [guid, msg.slice(0, 500)],
    );
    throw new Error(msg);
  }
}