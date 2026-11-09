// 2026-10-06：從 Prisma 改成 Neon HTTP（Workers 相容）。
//
// 原本寫的是 `(prisma as any).oBSSource.findFirst(...)` —— 而那個
// `as any` cast 讓我的掃描漏掉了這個檔案：
//   · 我只掃了 src/app/overlay/**/route.ts，沒掃共用的 src/lib/
//   · 結論寫成「11 條 overlay 全部零 Prisma」—— 而那 7 條走這裡
//
// ⚠️ 那是今晚最有害的錯誤形狀：**掃描器的盲點讓結論比事實更樂觀。**
//    我不是漏報一個警告，我是報了一個「全綠」。
//    而依那個結論，我就沒有理由來修這裡。
//
// 而這也解釋了為什麼 overlay/{scoreboard,live-viewers,donation-ticker,
// follower-alert,…} 那 7 條在 Workers 上仍然是 500：它們呼叫的是這裡。
import { resolveOverlayViaHttp } from "./db-http";
import { overlayByKey } from "./overlays";

/** Resolve an overlay token to its owning user + saved feature settings. */
export async function resolveOverlay(token: string, sourceKey: string) {
  const resolved = await resolveOverlayViaHttp(token, sourceKey);
  if (!resolved) return null;

  return {
    // 相容層：呼叫端拿的是 `source` / `user` / `settings` / `def`。
    // 這裡保留同樣的形狀，是為了不改動 7 條呼叫端。
    source: { token, sourceKey, userId: resolved.user.id },
    user: resolved.user,
    settings: resolved.settings,
    def: overlayByKey(sourceKey),
  };
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** Serialize settings for embedding into a <script> tag. */
export function jsonScript(data: unknown): string {
  return JSON.stringify(data ?? null)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

/**
 * HTML shell for an OBS Browser Source.
 *
 * Overlays are server-rendered once for the initial paint, then keep
 * themselves fresh by polling `https://api.zixilive.dpdns.org/api/v1/overlay-data/<sourceKey>?token=`.
 */
export function overlayShell({
  title,
  style,
  body,
  script,
  pollMs = 15000,
  sourceKey,
  token,
}: {
  title: string;
  style: string;
  body: string;
  script: string;
  pollMs?: number;
  sourceKey: string;
  token: string;
}) {
  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:transparent;overflow:hidden;
    font-family:"Noto Sans TC","Microsoft JhengHei",system-ui,sans-serif;
    -webkit-font-smoothing:antialiased}
  body{width:100vw;height:100vh}
${style}
</style>
</head>
<body>
<div id="overlay" data-source="${esc(sourceKey)}" data-token="${esc(token)}">${body}</div>
<script>
(function(){
  var root = document.getElementById("overlay");
  function paint(payload){ try { ${script} } catch (e) { console.error(e); } }
  function pull(){
    fetch("https://api.zixilive.dpdns.org/api/v1/overlay-data/${esc(sourceKey)}?token=" + encodeURIComponent(${jsonScript(token)}), {
      headers: { Accept: "application/json" },
      cache: "no-store"
    })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(d){ if (d) paint(d); })
      .catch(function(){});
  }
  pull();
  setInterval(pull, ${pollMs});
  document.addEventListener("visibilitychange", function(){ if (!document.hidden) pull(); });
})();
</script>
</body></html>`;
}

export function overlayHtmlResponse(html: string) {
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      // OBS loads from a file:// or https origin; keep framing unrestricted.
      "X-Content-Type-Options": "nosniff",
    },
  });
}