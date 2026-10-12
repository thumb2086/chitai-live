/**
 * ai-cost.ts — AI 點數費率的**單一來源**
 *
 * ═══════════════════════════════════════════════════════════
 * 為什麼要有這個檔案
 * ═══════════════════════════════════════════════════════════
 *
 * 方案頁的「AI 點數」在 plans.ts 宣告了卻從未被計量過 ——
 * 字幕只記 caption_minutes，於是那個數字永遠是 0，
 * 使用者看到「已用 0 / 500」而實際用量去了別的帳。
 *
 * 補上計量時最大的陷阱是**費率會有兩個來源**：
 * 一份寫在呼叫端、一份寫在中轉，兩邊數字只要有一個不同，
 * 對帳就永遠對不上，而且症狀會出現在很遠的地方。
 *
 * 所以：費率只定義在這裡，其他地方一律 import。
 * （同 AGENTS.md 規則 2：同一個數字只能有一個來源）
 *
 * ═══════════════════════════════════════════════════════════
 * 單位定義
 * ═══════════════════════════════════════════════════════════
 *
 * **1 點 = US$1**，與 groq-router 的 credits 定義一致。
 * 兩邊同義才能對帳 —— 若這邊是「行銷點」、那邊是「美元」，
 * 換算會隨匯率漂移，而沒有人會去查。
 *
 * ═══════════════════════════════════════════════════════════
 * ai_credits 與 caption_minutes 的分工（兩本帳，不是重複計算）
 * ═══════════════════════════════════════════════════════════
 *
 *   caption_minutes  「字幕這功能能用多久」  時間制，功能上限
 *   ai_credits       「AI 總共能花多少」      點數制，**通用**預算
 *
 * ai_credits 涵蓋所有 AI 服務，字幕只是其中一項。
 * 現在只有字幕在消費它，等 chat / TTS 接上時會共用同一個池子。
 *
 * 兩者同時存在不是冗余：caption_minutes 先擋住高用量的人，
 * ai_credits 擋住「在每個功能配額內、但總量超標」的情況。
 * 只有一個的話，跨功能的總量無從限制。
 */

export const POINTS_PER_USD = 1;

/**
 * 各服務的費率。每個服務只准在這裡出現一次。
 *
 * ⚠️ 不要憑印象填數字。groq-router 那邊的實際費率由
 *    lib/store.js 的 ASR_PER_SEC 定義，兩邊必須一致 ——
 *    不一致時症狀會出現在對帳那一步，而不是計費那一步。
 */
export const AI_RATES = {
  /** 語音轉文字：每音訊秒的點數。對齊中轉 asrCost 的 ASR_PER_SEC。 */
  asrPerSecond: 0.0007,
  // TODO(chat): 對話按 token 計。接入時在此新增，並在呼叫端統一走 aiCredits()。
  // TODO(tts) : 語音合成按字元計。同上。
} as const;

/** 音訊秒數 → 點數。回傳未四捨五入的數字，由 recordUsage 統一處理精度。 */
export function audioSecondsToCredits(seconds: number): number {
  const s = Math.max(0, Number(seconds) || 0);
  return s * AI_RATES.asrPerSecond;
}

/**
 * 寫入 UsageEvent 的 note 格式。
 *
 * 統一格式才能在方案頁按服務分項顯示 —— 否則用量明細只會是
 * 一串無法拆解的數字，而「哪個服務花的」正是使用者會問的第一個問題。
 */
export function usageNote(service: string, detail = ""): string {
  const base = `${service} 計費`;
  return detail ? `${base} · ${detail}` : base;
}