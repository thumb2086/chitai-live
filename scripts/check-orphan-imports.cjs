#!/usr/bin/env node
/**
 * check-orphan-imports.cjs — 找出指向不存在檔案的 import。
 *
 * 為什麼要這個：zixi-earth 曾因為一個孤兒 import 無法部署長達數月，
 * 而且症狀看起來像「環境壞掉」。孤兒 import 一定是編譯期錯誤，
 * 所以靜態掃描比等部署失敗可靠。
 *
 * 掃描範圍：src/、scripts/、tools/ 下所有 .ts/.tsx/.mjs/.cjs。
 * 解析 @/lib/x → src/lib/x，並嘗試副檔名與目錄 index。
 *
 * 退出碼：0 = 全部命中；1 = 有孤兒（所以 CI 可以擋）。
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");
const EXT = ["", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".jsx", "/index.ts", "/index.tsx", "/index.js"];

// src/generated 是 Prisma 產物（.gitignore 排除），不是我們維護的程式碼。
// ★ `_archive` 是刻意保留的歷史檔案（2026-10-18 從 scripts/ 移過去的）。
//
//   它們本來就因為 Neon 遷移而失效（import 已刪的 `@/lib/prisma`）——
//   移過去不是為了讓它們能跑，而是為了保留原始契約記錄。
//
//   所以掃描**必須跳過**它們：
//     · 把它們算進來 = 這個檢查永遠紅，而且沒辦法在不刪歷史的情況下修好
//     · 那就是「一個永遠失敗的檢查」—— 久了沒人看它，等於沒有
//
//   跳過之後，這支檢查的意義才回來：**現在活著的檔案**有沒有孤兒 import。
const SKIP_DIRS = new Set(["node_modules", "generated", ".next", ".open-opencode", "_archive"]);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|cjs|js|jsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

// 匹配 import ... from "x" / require("x") / import("x")
const SPEC_RE = /(?:\bfrom\s*|\brequire\(\s*|\bimport\(\s*)["']([^"']+)["']/g;

/**
 * 先把註解剝掉再比對。
 *
 * 不剝就會有兩種假陽性，這兩種都真的發生過：
 *   · platform-live.ts 的檔頭註解裡寫著「原本用 await import("./prisma")」，
 *     那是解說已刪除的舊路徑，不是真的 import。
 *   · `//` 開頭的註解與 URL 的 `https://` 開頭相同，不能用 `/^\/\/.*$/gm`。
 * 所以：先拿掉區塊註解，再拿掉「行首到行尾」與「前面是空白」的 // 註解。
 */
function stripComments(text) {
  let out = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  out = out.split("\n").map((line) => (/^(\s*)\/\//.test(line) ? line.replace(/\/\/.*$/, "") : line)).join("\n");
  return out;
}

const roots = [SRC, path.join(ROOT, "scripts"), path.join(ROOT, "tools")]
  .filter((d) => fs.existsSync(d))
  .map((d) => walk(d));

let files = 0;
const orphans = [];

for (const f of roots.flat()) {
  files++;
  const raw = fs.readFileSync(f, "utf8");
  const text = stripComments(raw);
  SPEC_RE.lastIndex = 0;
  let m;
  while ((m = SPEC_RE.exec(text))) {
    const spec = m[1].split("?")[0];
    let base;
    if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
    else if (spec.startsWith("./") || spec.startsWith("../")) base = path.resolve(path.dirname(f), spec);
    else continue; // 套件名稱，交给 bundler
    const found = EXT.some((ext) => fs.existsSync(base + ext) && fs.statSync(base + ext).isFile());
    if (!found) {
      const line = text.slice(0, m.index).split("\n").length;
      orphans.push({ file: path.relative(ROOT, f), line, spec });
    }
  }
}

console.log(`scanned ${files} files`);
if (orphans.length === 0) {
  console.log("OK: no orphan imports");
} else {
  console.log(`FAIL: ${orphans.length} orphan import(s)`);
  for (const o of orphans) console.log(`  ${o.file}:${o.line}  ${o.spec}`);
  process.exitCode = 1;
}