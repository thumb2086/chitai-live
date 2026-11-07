/**
 * scripts/migrate-chitai.js
 * chitai-live 專用遷移腳本：Neon PostgreSQL → Cloudflare D1, Upstash Redis → Workers KV
 * 
 * 使用方式:
 * 1. 設定環境變數 (GitHub Secrets)
 * 2. node scripts/migrate-chitai.js
 */

import { Redis } from '@upstash/redis';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT_DIR, 'migration-output');

// ========== 配置 ==========
const CONFIG = {
  // Neon 連線 (chitai-live)
  neon: {
    chitai: process.env.NEON_CHITAI_URL,
  },

  // Upstash Redis (groq 資料庫)
  upstash: {
    url: process.env.UPSTASH_REDIS_REST_URL || 'https://crack-zebra-292038.upstash.io',
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  },

  // Cloudflare 目標
  cloudflare: {
    accountId: process.env.CF_ACCOUNT_ID || '2513d9129183c9319ad07b504251a69b',
    apiToken: process.env.CF_API_TOKEN,
    d1Databases: {
      chitai: process.env.D1_CHITAI_DATABASE_ID || 'chitai-live',
    },
    kvNamespaces: {
      chitai: process.env.KV_CHITAI_NAMESPACE_ID,
      groq: process.env.KV_GROQ_NAMESPACE_ID,
    }
  }
};

// ========== 工具函數 ==========
function runCmd(cmd, options = {}) {
  console.log(`  $ ${cmd}`);
  try {
    execSync(cmd, { 
      stdio: 'inherit', 
      cwd: ROOT_DIR,
      env: { 
        ...process.env, 
        CF_ACCOUNT_ID: CONFIG.cloudflare.accountId, 
        CF_API_TOKEN: CONFIG.cloudflare.apiToken 
      },
      ...options 
    });
    return true;
  } catch (e) {
    console.error(`  ❌ 指令失敗: ${e.message}`);
    return false;
  }
}

function ensureOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
}

// ========== 1. PostgreSQL → SQLite/D1 語法轉換 ==========
function convertPgToD1(sql) {
  return sql
    .replace(/\bSERIAL\b/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT')
    .replace(/\bBIGSERIAL\b/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT')
    .replace(/TIMESTAMP\s*\(\s*\d+\s*\)\s*WITH\s+TIME\s+ZONE/gi, 'TEXT')
    .replace(/\bTIMESTAMPTZ\b/gi, 'TEXT')
    .replace(/TIMESTAMP\s+WITH\s+TIME\s+ZONE/gi, 'TEXT')
    .replace(/TIMESTAMP\s*\(\s*\d+\s*\)/gi, 'TEXT')
    .replace(/\bUUID\b/gi, 'TEXT')
    .replace(/\bJSONB\b/gi, 'TEXT')
    .replace(/\bJSON\b/gi, 'TEXT')
    .replace(/\w+\[\]/g, 'TEXT')
    .replace(/NOW\(\)/gi, "datetime('now')")
    .replace(/CURRENT_TIMESTAMP/gi, "datetime('now')")
    .replace(/\bBOOLEAN\b/gi, 'INTEGER')
    .replace(/USING\s+\w+/gi, '')
    .replace(/WITH\s+\([^)]+\)/gi, '')
    .replace(/SET\s+\([^)]+\)/gi, '')
    .replace(/COMMENT\s+ON\s+[\s\S]+?;/gi, '')
    .replace(/CREATE\s+EXTENSION\s+[\s\S]+?;/gi, '')
    .replace(/CONSTRAINT\s+\w+\s+/gi, '')
    .replace(/DOUBLE\s+PRECISION/gi, 'REAL');
}

function convertPgDataToD1(sql) {
  return sql
    .replace(/\btrue\b/gi, '1')
    .replace(/\bfalse\b/gi, '0')
    .replace(/::\w+/g, '')
    .replace(/'([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'/gi, "'$1'");
}

// ========== 2. Neon → D1 遷移 ==========
async function migrateNeonToD1() {
  console.log('\n🗄️ [1/3] 遷移 Neon PostgreSQL → D1 (chitai-live)');
  console.log('=====================================');

  const neonUrl = CONFIG.neon.chitai;
  const d1Name = CONFIG.cloudflare.d1Databases.chitai;

  if (!neonUrl) {
    console.log('  ⚠️ 缺少 NEON_CHITAI_URL，跳過');
    return;
  }

  // 導出 Schema
  console.log('  📋 導出 Schema...');
  const schemaFile = path.join(OUTPUT_DIR, 'chitai-schema.sql');
  const d1SchemaFile = path.join(OUTPUT_DIR, 'chitai-schema-d1.sql');
  
  const pgDumpSchema = `pg_dump --schema-only --no-owner --no-privileges "${neonUrl}" > "${schemaFile}"`;
  if (!runCmd(pgDumpSchema)) return;

  let schemaSql = fs.readFileSync(schemaFile, 'utf8');
  schemaSql = convertPgToD1(schemaSql);
  fs.writeFileSync(d1SchemaFile, schemaSql);
  console.log(`  ✅ Schema 已轉換: ${d1SchemaFile}`);

  // 導出資料
  console.log('  📊 導出資料...');
  const dataFile = path.join(OUTPUT_DIR, 'chitai-data.sql');
  const d1DataFile = path.join(OUTPUT_DIR, 'chitai-data-d1.sql');
  
  const pgDumpData = `pg_dump --data-only --column-inserts --no-owner --no-privileges "${neonUrl}" > "${dataFile}"`;
  if (!runCmd(pgDumpData)) return;

  let dataSql = fs.readFileSync(dataFile, 'utf8');
  dataSql = convertPgDataToD1(dataSql);
  fs.writeFileSync(d1DataFile, dataSql);
  console.log(`  ✅ 資料已轉換: ${d1DataFile}`);

  // 匯入 Schema
  console.log('  📥 匯入 Schema 到 D1...');
  if (!runCmd(`wrangler d1 execute ${d1Name} --file="${d1SchemaFile}" --remote`)) return;

  // 匯入資料
  console.log('  📥 匯入資料到 D1...');
  if (!runCmd(`wrangler d1 execute ${d1Name} --file="${d1DataFile}" --remote`)) return;

  console.log(`  ✅ chitai-live → D1 (${d1Name}) 遷移完成`);
}

// ========== 3. Upstash Redis → Workers KV ==========
async function migrateUpstashToKV() {
  console.log('\n☁️ [2/3] 遷移 Upstash Redis → Workers KV');
  console.log('=====================================');

  if (!CONFIG.upstash.token || CONFIG.upstash.token === 'NEEDS_UPDATE_FROM_UPSTASH_CONSOLE') {
    console.log('  ⚠️ UPSTASH_REDIS_REST_TOKEN 未正確設定，跳過');
    return;
  }

  const redis = new Redis({
    url: CONFIG.upstash.url,
    token: CONFIG.upstash.token,
  });

  // 掃描所有 keys
  console.log('  🔍 掃描所有 keys...');
  const allKeys = [];
  let cursor = 0;
  do {
    const [newCursor, keys] = await redis.scan(cursor, 'MATCH * COUNT 1000');
    cursor = parseInt(newCursor);
    allKeys.push(...keys);
  } while (cursor !== 0);

  console.log(`  發現 ${allKeys.length} 個 keys`);

  if (allKeys.length === 0) {
    console.log('  無資料需遷移');
    return;
  }

  // 導出資料
  console.log('  📤 導出資料...');
  const exportData = {};
  for (const key of allKeys) {
    const type = await redis.type(key);
    let value;
    switch (type) {
      case 'string': value = await redis.get(key); break;
      case 'hash': value = await redis.hgetall(key); break;
      case 'list': value = await redis.lrange(key, 0, -1); break;
      case 'set': value = await redis.smembers(key); break;
      case 'zset': value = await redis.zrange(key, 0, -1, { withScores: true }); break;
      default: continue;
    }
    const ttl = await redis.ttl(key);
    exportData[key] = { type, value, ttl: ttl > 0 ? ttl : null };
  }

  // 儲存導出檔
  const exportFile = path.join(OUTPUT_DIR, 'upstash-export.json');
  fs.writeFileSync(exportFile, JSON.stringify(exportData, null, 2));
  console.log(`  ✅ 已導出至 ${exportFile}`);

  // 匯入到 Workers KV (groq-router-kv)
  const kvNamespace = CONFIG.cloudflare.kvNamespaces.groq;
  console.log(`  ☁️ 匯入到 KV: ${kvNamespace}...`);
  
  const kvData = Object.entries(exportData).map(([key, { value, ttl }]) => ({
    key,
    value: JSON.stringify(value),
    expiration_ttl: ttl,
  }));

  // 分批寫入 (每批 500)
  const batchSize = 500;
  for (let i = 0; i < kvData.length; i += batchSize) {
    const batch = kvData.slice(i, i + batchSize);
    const jsonl = batch.map(item => JSON.stringify(item)).join('\n');
    const batchFile = path.join(OUTPUT_DIR, `kv-batch-${i}.jsonl`);
    fs.writeFileSync(batchFile, jsonl);

    const success = runCmd(`wrangler kv:bulk put ${kvNamespace} --binding=KV < "${batchFile}"`);
    if (!success) {
      console.error(`  批次 ${i / batchSize + 1} 失敗，請手動重試`);
    } else {
      console.log(`  批次 ${Math.floor(i / batchSize) + 1}/${Math.ceil(kvData.length / batchSize)} 完成 (${batch.length} keys)`);
    }
  }

  console.log('  ✅ Upstash → KV (groq-router-kv) 遷移完成');
}

// ========== 4. 套用 D1 Schema (建立表格) ==========
async function applyD1Schema() {
  console.log('\n📋 [3/3] 套用 D1 Schema (建立 chitai-live 表格)');
  console.log('=====================================');

  const d1Name = CONFIG.cloudflare.d1Databases.chitai;
  const schemaFile = path.join(ROOT_DIR, 'migrations', '001_initial_schema.sql');

  if (!fs.existsSync(schemaFile)) {
    console.log(`  ⚠️ 找不到 schema 檔案: ${schemaFile}`);
    return;
  }

  console.log('  📥 匯入完整 Schema 到 D1...');
  if (!runCmd(`wrangler d1 execute ${d1Name} --file="${schemaFile}" --remote`)) return;

  console.log(`  ✅ D1 Schema 套用完成`);
}

// ========== 主流程 ==========
async function main() {
  console.log('🚀 開始 chitai-live 遷移到 Cloudflare');
  console.log('=====================================');
  console.log(`專案根目錄: ${ROOT_DIR}`);
  console.log(`輸出目錄: ${OUTPUT_DIR}`);

  ensureOutputDir();

  // 1. 遷移 Neon → D1
  await migrateNeonToD1();

  // 2. 遷移 Upstash → KV
  await migrateUpstashToKV();

  // 3. 套用 D1 Schema (建立 chitai-live 專用表格)
  await applyD1Schema();

  console.log('\n=====================================');
  console.log('✅ chitai-live 遷移步驟完成！');
  console.log('\n下一步驟:');
  console.log('1. 檢查 migration-output/ 目錄下的檔案');
  console.log('2. 更新 apps/api/wrangler.toml 綁定 D1/KV ID');
  console.log('3. 推送到 GitHub 觸發部署');
  console.log('4. 在 Cloudflare Pages 設定自訂域名 zixilive.dpdns.org');
}

main().catch(console.error);