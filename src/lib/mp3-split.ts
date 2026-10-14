/**
 * MP3 位元組流切分（2026-10-14）
 *
 * ─────────────────────────────────────────────────────────────
 * 為什麼需要它
 * ─────────────────────────────────────────────────────────────
 *
 * 參考實作（Playlist_Administrator / lib/services/groq_native_service.dart）
 * 用 ffmpeg 依**時間**切：300 秒一段，仍太大就 60 秒再切。
 *
 * Cloudflare Workers 沒有 ffmpeg，也不該為了切音檔拉一個 WASM 版
 * （幾 MB 的 bundle + 每個請求的啟動成本）。
 *
 * 所以改用**位元組邊界**切，但**切在 MP3 影格邊界上**：
 * 每個 MP3 frame 是自帶解碼的獨立單位，
 * 切在影格中間會讓開頭那一小段變成雜訊 —— 那正是「轉錄品質突然變差」
 * 的來源。切在影格開頭則只會少掉/多掉一個 frame（約 26 ms），
 * 聽不出來。
 *
 * ─────────────────────────────────────────────────────────────
 * 這個模組只處理 MP3，而且只在**明確辨識為 MP3** 時才動手
 * ─────────────────────────────────────────────────────────────
 *
 * m4a/mp4（ISO BMFF）、ogg、opus 都不能用位元組切分 ——
 * 硬切會產生垃圾，而垃圾的表現是「轉錄看起來亂語」，
 * 那比明確報錯糟得多（使用者會以為內容本身是那樣）。
 * 所以那些格式一律拒絕，並說清楚原因。
 */

const BITRATES_V1_L3 = [
  0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, -1,
];
const BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, -1];
const BITRATES_V1_L1 = [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, -1];
const BITRATES_V1_L2 = [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, -1];
const BITRATES_V2_L1 = [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, -1];

const RATES_V1 = [44100, 48000, 32000, -1];
const RATES_V2 = [22050, 24000, 16000, -1];
const RATES_V25 = [11025, 12000, 8000, -1];

/** ID3v2 標頭長度（10 bytes header + syncsafe size）。找不到回 0。 */
export function id3Size(b: Uint8Array): number {
  if (b.length < 10) return 0;
  if (b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return 0; // "ID3"
  // syncsafe integer：每 byte 只用低 7 bits
  const size =
    ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f);
  const footer = b[5] & 0x10 ? 10 : 0;
  return 10 + size + footer;
}

export interface Mp3Frame {
  /** 影格在緩衝區的起始位置 */
  pos: number;
  /** 整個影格的位元組長度 */
  length: number;
}

/**
 * 從 pos 解析一個 MP3 影格標頭。
 * 解析不出來回 null（呼叫方繼續往後找）。
 */
export function parseFrame(b: Uint8Array, pos: number): Mp3Frame | null {
  if (pos + 4 > b.length) return null;
  if (b[pos] !== 0xff) return null;
  if ((b[pos + 1] & 0xe0) !== 0xe0) return null; // 11-bit frame sync

  const verBits = (b[pos + 1] >> 3) & 0x03; // 0=2.5, 1=reserved, 2=2, 3=1
  const layerBits = (b[pos + 1] >> 1) & 0x03; // 0=reserved, 3=L1, 2=L2, 1=L3
  if (verBits === 1 || layerBits === 0) return null; // 保留值

  const brIdx = (b[pos + 2] >> 4) & 0x0f;
  const srIdx = (b[pos + 2] >> 2) & 0x03;
  if (brIdx === 0 || brIdx === 15) return null; // free / 非法
  if (srIdx === 3) return null; // 保留

  const v1 = verBits === 3;
  let bitrate: number;
  let rate: number;

  if (layerBits === 3) {
    // Layer I
    const tbl = v1 ? BITRATES_V1_L1 : BITRATES_V2_L1;
    bitrate = tbl[brIdx];
    rate = (v1 ? RATES_V1 : RATES_V2)[srIdx];
  } else if (layerBits === 2) {
    // Layer II
    bitrate = (v1 ? BITRATES_V1_L2 : BITRATES_V2_L1)[brIdx];
    rate = (v1 ? RATES_V1 : RATES_V2)[srIdx];
  } else {
    // Layer III
    bitrate = (v1 ? BITRATES_V1_L3 : BITRATES_V2_L3)[brIdx];
    rate = verBits === 0 ? RATES_V25[srIdx] : (v1 ? RATES_V1 : RATES_V2)[srIdx];
  }
  if (!bitrate || bitrate < 0 || !rate || rate < 0) return null;

  const pad = (b[pos + 2] >> 1) & 0x01;
  const samples =
    layerBits === 3 ? 384 : layerBits === 1 ? 1152 : 1152; // L1:384, L2/L3:1152

  const length =
    layerBits === 3
      ? Math.floor((12 * bitrate * 1000) / rate + pad) * 4
      : Math.floor((samples / 8) * (bitrate * 1000) / rate) + pad;

  if (length < 4) return null;
  return { pos, length };
}

/** 這個緩衝區看起來是不是 MP3？（有 ID3 標頭，或開頭就是影格） */
export function looksLikeMp3(b: Uint8Array): boolean {
  if (b.length < 4) return false;
  const id3 = id3Size(b);
  if (id3 > 0 && id3 < b.length) return parseFrame(b, id3) !== null;
  return parseFrame(b, 0) !== null;
}

/**
 * 把 MP3 切成不超過 maxBytes 的片段，**切在影格邊界上**。
 *
 * @param b     完整音檔
 * @param maxBytes 每段上限
 * @returns null = 這不是 MP3（或完全找不到影格），呼叫方該明確拒絕
 */
export function splitMp3(b: Uint8Array, maxBytes: number): Uint8Array[] | null {
  const start = id3Size(b);
  if (start >= b.length) return null;

  let pos = start;
  // 跳過第一個影格 —— 那是 Xing/Info/VBRI 標頭，不是音訊。
  const first = parseFrame(b, pos);
  if (!first) return null;
  pos = first.pos + first.length;

  const out: Uint8Array[] = [];
  // ★ 從 0 開始，不是從 ID3 標頭之後。
  //   ID3 標頭是 MP3 檔案的一部分（標題/藝人等 metadata），
  //   從 start 切會把它單獨漏掉 —— 位元組對不回原檔，
  //   而且第一段也不再是一個結構完整的 MP3。
  //   參考實作是用 ffmpeg 依時間切，沒有這個問題；
  //   位元組切就必須自己把這 10 bytes 算進去。
  let segStart = 0;
  let frames = 0;

  while (pos < b.length) {
    const f = parseFrame(b, pos);
    if (!f) {
      // 尾端通常是 ID3v1 標頭（最後 128 bytes 的 "TAG"）或 padding。
      // 那不是錯誤 —— 直接收尾。
      break;
    }

    // 再加這個影格就會超過上限 → 在**這裡之前**切
    if (f.pos - segStart + f.length > maxBytes && frames > 0) {
      out.push(b.subarray(segStart, f.pos));
      segStart = f.pos;
      frames = 0;
    }

    pos = f.pos + f.length;
    frames++;
  }

  if (segStart < b.length) out.push(b.subarray(segStart, b.length));
  return out.length > 0 ? out : null;
}