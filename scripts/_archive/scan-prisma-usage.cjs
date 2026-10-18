// scan-prisma-usage.cjs — 全專案 Prisma 用量盤點（含共用層）
//
// ══════════════════════════════════════════════════════════
// 為什麼要寫這支
// ══════════════════════════════════════════════════════════
//
// 2026-10-06 我掃過 `src/app/overlay/**/route.ts`，結論寫成
// 「11 條 overlay 全部零 Prisma」並 commit 出去。
//
// 而那 7 條走的是**共用層** src/lib/overlay-render.ts，
// 裡面寫的是 `(prisma as any).oBSSource.findFirst(...)` ——
// 那個 `as any` cast 讓我的 regex 掃不到，而且我根本没去掃那個目錄。
//
// 後果：那個 commit 訊息裡的「全部零 Prisma」是**錯的**，
// 而依那個結論我就沒有理由去修它。
//
// ⚠️ 那是今晚最有害的錯誤形狀：
//    **掃描器的盲點讓結論變得比事實更樂觀。**
//    我不是漏報一個警告，我是報了一個「全綠」。
//
// 所以這支的設計重點不是「找出 Prisma」，而是：
//   ① 掃**所有** src/（含 lib/ 等共用層）
//   ② 認得 `(prisma as any)` 這個變體
//   ③ **排除註解行** —— 否則我寫的說明註解會被算成用量
//   ④ 輸出時分開「已被改成 HTTP」與「仍是 Prisma」
//
// 排除註解這點很重要：我自己的註解裡寫著「Prisma 7 的 query compiler
// 是 WASM」，那不是程式碼。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(path.join(__dirname, '..'));
const SRC = path.join(ROOT, 'src');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'generated' || e.name === '.next') continue;
      walk(f, out);
    } else if (/\.(ts|tsx)$/.test(e.name)) out.push(f);
  }
  return out;
}

/** 去掉註解，只留程式碼 —— 否則我自己的說明註解會被算成用量。 */
function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');
}

const files = walk(SRC);

// ── Prisma 的三種寫法 ──
//   1. prisma.model.method(...)
//   2. (prisma as any).model.method(...)
//   3. await import("./prisma")  ← **動態載入**
//
// ⚠️ 第 3 種是我在 2026-10-06 親自踩到的：
//   src/lib/platform-live.ts 裡寫的是
//       const prisma = (await import("./prisma")).prisma;
//   而我的掃描器只認第 1、2 種，於是那個檔案「零 Prisma」。
//
//   結果：`live-viewers` 那條 overlay 在 Workers 上必然 500
//   （它經由 getLiveViewers → platform-live），而我的報告說那條已修好。
//
// ⚠️ **掃描器的 pattern 決定了它看不見什麼。**
//   所以每加一種 pattern，都要配一個對照組 ——
//   否則「沒抓到」會被讀成「不存在」。
//
// 中間那個 `(?:...)` 不能寫成可選群組 ——
// JS regex 不支援「可選的捕獲群組」，會被解讀成群組未終止。
const PRISMA_RE = new RegExp(
  [
    '\\bprisma\\s*\\.\\s*\\w+\\s*\\.\\s*\\w+',                 // prisma.x.y
    '\\(\\s*prisma\\s+as\\s+any\\s*\\)\\s*\\.\\s*\\w+\\s*\\.\\s*\\w+', // (prisma as any).x.y
    'import\\s*\\(\\s*["\'][^"\']*prisma["\']\\s*\\)',          // import("./prisma")
    '\\bprisma\\s*\\.\\w+\\s*\\(',                              // prisma.model.method(
  ].join('|'),
  'g',
);

let total = 0;
const byFile = [];
const byDir = {};

for (const f of files) {
  const raw = fs.readFileSync(f, 'utf8');
  const code = codeOnly(raw);
  const n = (code.match(PRISMA_RE) || []).length;
  if (n === 0) continue;
  total += n;
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  byFile.push({ rel, n, usesHttp: /from ["'][^"']*db-http["']/.test(raw) });
  const top = rel.split('/').slice(0, 3).join('/');
  byDir[top] = (byDir[top] || 0) + n;
}

console.log('');
console.log('════════ Prisma 用量盤點 ════════');
console.log(`  掃描範圍: src/**（${files.length} 個檔案，含 lib/ 等共用層）`);
console.log(`  匹配式: 靜態 prisma.x.y / (prisma as any) / 動態 import("./prisma")`);
console.log(`  已排除: 註解行（區塊 + 行）`);
console.log('');
console.log(`  總用量: ${total}`);
console.log('');

if (total > 0) {
  console.log('  ── 依目錄 ──');
  for (const [d, n] of Object.entries(byDir).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(4)}  ${d}`);
  }
  console.log('');
  console.log('  ── 用量最多的檔案 ──');
  for (const f of byFile.sort((a, b) => b.n - a.n).slice(0, 10)) {
    console.log(`    ${String(f.n).padStart(4)}  ${f.rel}${f.usesHttp ? '   （已 import db-http）' : ''}`);
  }
  console.log('');
}

// ── 盲點自檢 ──
//
// 這支腳本自己也要能被抓出盲點，否則它和前一個掃描器沒有區別。
//
// 每一種寫法都要有對照組 ——「沒抓到」不能被讀成「不存在」。
// 我今天就是因為少一種 pattern 而報了假結論。
console.log('  ── 盲點自檢（對照組）──');

const PROBES = [
  ['靜態 prisma.x.y', 'const y = prisma.a.b();', 1],
  ['(prisma as any)', 'const x = (prisma as any).foo.bar({});', 1],
  ['動態 import("./prisma")', 'const p = (await import("./prisma")).prisma;', 1],
  ['單層 prisma.model(', 'await prisma.user.findMany();', 0], // 已被上面的 pattern 涵蓋
  ['註解不該被算', '// prisma.comment.thing()\nconst z = 1;', 0],
];

let blind = 0;
for (const [label, src, _expected] of PROBES) {
  const n = (codeOnly(src).match(PRISMA_RE) || []).length;
  const shouldHit = _expected > 0 || label.includes('不該被算') === false;
  // 對「註解不該被算」那條，期望是 0
  const expectZero = label.includes('註解');
  const ok = expectZero ? n === 0 : n >= 1;
  if (!ok) blind++;
  console.log(`    ${ok ? '✓' : '★'} ${label.padEnd(26)} 抓到 ${n} 處${expectZero ? '（應為 0）' : '（應 ≥1）'}`);
}

if (blind) {
  console.log('');
  console.log(`    ★ ${blind} 個對照組失效 —— 這個掃描器有盲點，`);
  console.log('      它的「全綠」結論不可信。');
  process.exit(1);
}
console.log('');
console.log('    ✓ 三種寫法都抓得到，且註解不算');
console.log('');