// _alias.cjs — 讓 jiti 認得 tsconfig 的 "@/*" → "src/*" 路徑別名
//
// 為什麼需要這個
// ══════════════════════════════════════════════════════════
//
// jiti 2.x **不會**讀 tsconfig 的 `compilerOptions.paths`。
// 所以 `await import("@/lib/captions-groq")` 在 jiti 底下會是
//   Error: Cannot find module '@/lib/captions-groq'
//
// 而 scripts/ 下的測試幾乎每支都靠 `@/` 拿 route 與 lib。
// （scripts/ 又在 tsconfig 的 `exclude` 裡，所以 `tsc --noEmit`
//   與 `npm run build` 都不會發現這件事 —— 這正是它能一直壞著的原因。）
//
// 修法：掛一個 Module._resolveFilename 攔截器。
// jiti 把 TS 編譯成 CJS 後走的是 require，所以掛在 CJS 這一層有效。
//
// ⚠️ 這是補丁不是取代品。正式解法是換成能讀 tsconfig paths 的 runner，
//    或把 scripts/ 納入 typecheck。但那超出「修一個 bug」��範圍。
const path = require("path");
const Module = require("module");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");

const EXTS = ["", ".ts", ".tsx", ".mts", ".js", ".mjs", ".cjs",
  path.sep + "index.ts", path.sep + "index.tsx"];

function resolveWithExts(base) {
  for (const e of EXTS) {
    const p = base + e;
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  return null;
}

let patched = false;
function installAlias() {
  if (patched) return;
  patched = true;
  const orig = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (typeof request === "string" && request.startsWith("@/")) {
      const hit = resolveWithExts(path.join(SRC, request.slice(2)));
      if (hit) return hit;
    }
    return orig.call(this, request, ...rest);
  };
}

installAlias();
module.exports = { installAlias };
