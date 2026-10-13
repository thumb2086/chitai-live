// 建立一個 livestream-dashboard 的測試 session（用瀏覽器實測抽獎 UI）
import { neon } from '@neondatabase/serverless';
import fs from 'node:fs';

function env(name) {
  for (const f of ['.env', '.env.local']) {
    if (!fs.existsSync(f)) continue;
    const m = new RegExp('^' + name + '=(.*)$', 'm').exec(fs.readFileSync(f, 'utf8'));
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  return null;
}

const sql = neon(env('DATABASE_URL') || '');
const userId = 'giveaway_ui_' + Date.now().toString(36);
const sessionId = 'gsess_' + Math.random().toString(36).slice(2, 16);
const uname = 'gwui_' + Math.random().toString(36).slice(2, 6);

await sql.transaction([
  sql.query(
    'INSERT INTO "User" ("id","name","username","email","avatar","createdAt") VALUES ($1,$2,$3,$4,$5,NOW())',
    [userId, '抽獎測試', uname, uname + '@test.invalid', '']),
  sql.query(
    'INSERT INTO "Session" ("id","userId","platform","createdAt") VALUES ($1,$2,$3,NOW())',
    [sessionId, userId, 'twitch']),
  // 建一個抽獎，這樣頁面不是空的
  sql.query(
    'INSERT INTO "Giveaway" ("id","userId","title","keyword","enabled","winner","createdAt") VALUES ($1,$2,$3,$4,true,\'\',NOW())',
    ['gw_' + Math.random().toString(36).slice(2, 10), userId, '抽獎 UI 測試', '抽']),
]);

console.log(JSON.stringify({ userId, sessionId, uname }, null, 2));