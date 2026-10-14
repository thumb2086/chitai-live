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
import { splitMp3 } from "@/lib/mp3-split";

// ── 限制 ────────────────────────────────────────────────
/**
 * STT 服務網址（2026-10-14 換到獨立主機）。
 *
 * ★ 為什麼換
 *   舊路徑是 chitai 上傳音檔給 groq-router（Vercel），
 *   而 **Vercel 的請求體上限約 4.5 MB**（實測二分：4.0 過、4.5 拒）。
 *   一般 Podcast 單集 8–80 MB，那條路幾乎每一集都失敗。
 *   新主機是放在中轉前面的代理，自己回報 maxBytes = 96 MB。
 *
 * ★ 不要在這裡寫死
 *   env 優先，預設值只是萬一沒設定時的後路。
 */
const STT_URL =
  process.env.STT_URL ||
  "https://stt.twonline.dpdns.org/v1/audio/transcriptions";

/**
 * 每段上傳的大小上限 —— **20 MB**。
 *
 * 數值來自參考實作（Playlist_Administrator 的 _defaultMaxFileSize），
 * 不是自己挑的。STT 端 /health 自己回報 maxBytes = 96 MB，
 * 所以 20 MB 是我們這邊較保守的選項，留了餘裕。
 */
export const CHUNK_MAX_BYTES = 20 * 1024 * 1024;

/** 同時併發上傳幾段。對齊參考實作（它用真正的 worker pool，不是分批輪流）。 */
export const TRANSCRIBE_CONCURRENCY = 4;

/**
 * 整個音檔的下載上限 —— **80 MB，這個數字來自 Worker 記憶體，不是 STT 服務。**
 *
 * ★ 為什麼還要一個總量上限
 *   分段解決了「單次請求不能太大」，但沒解決「Worker 記憶體放不下整個檔」。
 *   Workers 是 128 MB，而我們要同時持有原始音檔 + 一個分段。
 *   20 MB 的分段 + 原始檔 → 原始檔必須 <= 約 90 MB 才安全。
 *   取 80 MB，理由寫在這裡而不是散在程式碼裡。
 *
 * ★ ★ 這個 80 和 STT 服務回報的 96 MB 毫無關係 —— 別混為一談
 *
 *   兩個上限來自完全不同的東西，搞混會導致調錯參數：
 *
 *     80 MB  ← Cloudflare Workers 記憶體 128 MB，扣掉分段與暫存
 *              問的是「我們的 Worker 能不能把整個檔讀進來」
 *              STT 那邊就算給你 1 TB，這個數也不會變大
 *
 *     96 MB  ← 自架 STT 代理自己回報的 maxBytes（GET /health 查得到）
 *              問的是「單次請求送過去，對方收不收得下」
 *              Worker 就算有 10 GB 記憶體，這個數也不會變大
 *
 *   實際生效的是兩者取小。我們的 80 比它的 96 小，所以先卡在我們這邊。
 *   真要放大單集上限，先量 Worker 記憶體，不是去調 STT 那邊。
 *
 *   （名字用 WORKER_ 而不是 TOTAL_，就是為了讓人一眼看出這 80 從哪來。
 *    「total」會讓人以為那是音訊本身的容量，正好製造上面那個誤解。）
 */
export const WORKER_AUDIO_MAX_BYTES = 80 * 1024 * 1024;
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
 * 把音檔轉成逐字稿。
 *
 * ★ 走 multipart 上傳，不是送網址
 *   2026-10-14 中間版本曾改成送 { audioUrl }，繞開 Vercel 4.5 MB 限制。
 *   但換到新主機後實測：**新端點只收 multipart/***
 *   （錯誤「multipart/* content type expected」），JSON 模式不受支援。
 *
 * ★ 認證用 X-API-Key
 *   維護者的指定。實測 Authorization: Bearer 也收得到，
 *   但照規格走 —— 兩種都work不代表該用兩種。
 */
export interface TranscribeResult {
  text: string;
  durationSec: number | null;
  /** 分成幾段 */
  chunks: number;
  /**
   * ★ 失敗的段。空陣列 = 全部成功。
   *   這個欄位存在的理由在檔頭：靜默回傳「短一點的逐字稿」
   *   會讓人以為內容本來就那麼短。
   */
  failed: { chunk: number; error: string }[];
}

export async function transcribe(audioUrl: string): Promise<TranscribeResult> {
  const key = process.env.GROQ_ROUTER_KEY;
  if (!key) throw new Error("GROQ_ROUTER_KEY 未設定");

  const bytes = await downloadAudio(audioUrl);
  const parts = planChunks(bytes);

  // ── 併發上傳（真正的 worker pool，對齊參考實作）──
  //
  // ★ 不用 Promise.all(map(...)) 的理由
  //   那會一次開全部併發。48 分鐘的節目切成 3 段還好，
  //   但 2 小時的切成 9 段就是 9 個同時上傳 → 上游 429 + Worker 記憶體爆。
  //   參考實作踩過這個（註解寫「strided batching 第一批就全開 → 429 風暴」）。
  const texts: string[] = new Array(parts.length).fill("");
  const failed: { chunk: number; error: string }[] = [];
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= parts.length) return;
      try {
        texts[i] = await uploadChunk(parts[i], key);
      } catch (e) {
        failed.push({
          chunk: i + 1,
          error: String((e as Error).message || e).slice(0, 160),
        });
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(TRANSCRIBE_CONCURRENCY, parts.length) }, worker),
  );

  // ── 全部失敗 → 拋真因 ──
  const okCount = texts.filter((t) => t.trim().length > 0).length;
  if (okCount === 0) {
    throw new Error(
      `全部 ${parts.length} 段都轉錄失敗：` +
        failed.map((f) => `第 ${f.chunk} 段 ${f.error}`).join("；").slice(0, 400),
    );
  }

  // ── 部分失敗 → 照實回報，不假裝完整 ──
  return {
    // 用換行接，不用直接接 —— 否則兩段邊界會黏成一個詞。
    text: texts.filter((t) => t.trim()).join("\n"),
    durationSec: null,
    chunks: parts.length,
    failed,
  };
}

/** 下載音檔，帶兩道上限檢查（見檔頭說明為什麼在讀之前就要看 Content-Length）。 */
async function downloadAudio(audioUrl: string): Promise<Uint8Array> {
  const ac = new AbortController();
  const tm = setTimeout(() => ac.abort(), 280_000);
  try {
    const dl = await fetch(audioUrl, {
      signal: ac.signal,
      headers: { "User-Agent": "CHITAI/1.0 (+knowledge base importer)" },
    });
    if (!dl.ok) throw new Error(`下載音檔失敗 HTTP ${dl.status}`);

    const declared = Number(dl.headers.get("content-length") || "0");
    if (declared > WORKER_AUDIO_MAX_BYTES) {
      throw new Error(
        `這一集是 ${(declared / 1048576).toFixed(1)} MB，超過 ` +
          `${(WORKER_AUDIO_MAX_BYTES / 1048576).toFixed(0)} MB 的上限` +
          `（我們伺服器的記憶體，不是轉錄服務的容量）。`,
      );
    }

    return new Uint8Array(await dl.arrayBuffer());
  } catch (e) {
    const msg = String((e as Error).message || e);
    if (/^這一集是/.test(msg)) throw new Error(msg); // 已經是給使用者看的
    // ★ 不要把 undici/Node 的原始錯誤往外送。
    //   實測「下載壞網址」會回 "fetch failed" —— 使用者看到這個
    //   完全不知道要檢查網址還是等一下再試。
    if (/abort/i.test(msg)) {
      throw new Error("下載音檔逾時（280 秒）。檔案可能在慢速的 CDN 上，或網址已失效。");
    }
    if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONN/i.test(msg)) {
      throw new Error(
        `連不到音檔伺服器（${audioUrl.split("?")[0].slice(0, 60)}…）。` +
          `可能是網址失效或 DNS 查不到。`,
      );
    }
    throw new Error(`下載音檔失敗：${msg.slice(0, 160)}`);
  } finally {
    clearTimeout(tm);
  }
}

/**
 * 決定怎麼切。
 *
 * ★ 不支援的格式要明確拒絕，不要硬切
 *   m4a/mp4、ogg、opus 不能用位元組切 —— 硬切的表現是
 *   「轉錄看起來像亂語」，而那比明確報錯糟得多
 *   （使用者會以為內容本來就那樣）。
 */
function planChunks(bytes: Uint8Array): Uint8Array[] {
  if (bytes.length <= CHUNK_MAX_BYTES) return [bytes];

  const parts = splitMp3(bytes, CHUNK_MAX_BYTES);
  if (!parts) {
    const kind = bytes.length >= 4 ? Array.from(bytes.subarray(0, 4)).map((b) => b.toString(16).padStart(2, "0")).join(" ") : "?";
    throw new Error(
      `這一集是 ${(bytes.length / 1048576).toFixed(1)} MB，超過 ` +
        `${(CHUNK_MAX_BYTES / 1048576).toFixed(0)} MB，需要分段。` +
        `但我們只能切 MP3（檔頭 ${kind}）—— ` +
        `m4a/ogg/opus 硬切會產生亂語，那比不支援更糟。` +
        `請選 MP3 版的音檔，或這一集先用其他方式處理。`,
    );
  }
  return parts;
}

/** 送一段音檔給 STT，回逐字稿。 */
async function uploadChunk(part: Uint8Array, key: string): Promise<string> {
  const form = new FormData();
  form.append("model", STT_MODEL);
  form.append("response_format", "json");
  // ★ 不指定 language：中文用 zh、英文用 en、中間 podcast 也有，
  //   猜錯的代價是整段變成另一種語言的音譯，
  //   而那看起來會像「轉錄品質差」而不是「猜錯了」。
  // ★ 這個 cast 只為了過 TS 的 BlobPart 型別。
  //   新版 lib.dom 的 BlobPart 要 ArrayBufferView<ArrayBuffer>，
  //   而 splitMp3 的 subarray 回傳型別是 ArrayBufferLike（可能不是 ArrayBuffer）。
  //   執行期完全一樣 —— Blob 只讀取位元組，不在意背後是哪種 ArrayBuffer。
  //   （用「複製一份成新 ArrayBuffer」來避開會多佔一倍記憶體，
  //     而我們的限制本來就是記憶體 —— 那個修法比型別問題更糟。）
  form.append("file", new Blob([part as unknown as BlobPart], { type: "audio/mpeg" }), "audio.mp3");

  const res = await fetch(STT_URL, {
    method: "POST",
    headers: { "X-API-Key": key },
    body: form,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    let msg = detail.slice(0, 200);
    try {
      const j = JSON.parse(detail);
      msg = j?.error?.message || msg;
    } catch {}
    // ★ 保留 HTTP 狀態碼 —— 上游 413（段太大）與 401（憑證錯）
    //   是完全不同的問題，籠統的「轉錄失敗」會讓人查錯方向。
    throw new Error(`HTTP ${res.status} ${msg}`);
  }

  const j = (await res.json()) as { text?: string };
  return String(j.text || "");
}

/** 猜副檔名。上游看的是副檔名與 content-type。 */
function guessExt(url: string, mimeType: string): string {
  const m = url.split("?")[0].match(/\.([a-z0-9]{2,5})$/i);
  const ok = ["mp3", "m4a", "mp4", "wav", "ogg", "opus", "aac", "flac", "webm", "mpeg", "mpga"];
  if (m && ok.includes(m[1].toLowerCase())) return "." + m[1].toLowerCase();
  if (mimeType.includes("mp4")) return ".m4a";
  if (mimeType.includes("ogg")) return ".ogg";
  if (mimeType.includes("wav")) return ".wav";
  if (mimeType.includes("flac")) return ".flac";
  if (mimeType.includes("webm")) return ".webm";
  return ".mp3";
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
    const { text, durationSec } = await transcribe(ep.audioUrl);

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