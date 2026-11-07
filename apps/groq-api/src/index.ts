import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

// ========== 型別定義 ==========
interface Env {
  KV: KVNamespace;
  GROQ_KEYS: string;
  NVIDIA_API_KEY: string;
  ROUTER_TOKEN: string;
  ADMIN_TOKEN: string;
  ENVIRONMENT: string;
}

interface GroqKey {
  id: string;
  key: string;
  label: string;
  addedAt: number;
  disabled: boolean;
  credits: number;
  dailyUsed: number;
  lastUsed: number;
}

interface User {
  token: string;
  name: string;
  role: string;
  credits: number;
  createdAt: number;
}

// ========== 常數 ==========
const KV_PREFIX = 'gr:';
const KEYS_KEY = `${KV_PREFIX}keys`;
const USERS_KEY = `${KV_PREFIX}users`;
const META_KEY = `${KV_PREFIX}meta`;

// ========== KV 工具函數 ==========
async function kvGet<T>(kv: KVNamespace, key: string): Promise<T | null> {
  const data = await kv.get(key, 'json');
  return data as T | null;
}

async function kvPut(kv: KVNamespace, key: string, value: unknown, ttl?: number): Promise<void> {
  await kv.put(key, JSON.stringify(value), { expirationTtl: ttl });
}

async function kvDelete(kv: KVNamespace, key: string): Promise<void> {
  await kv.delete(key);
}

// ========== 金鑰管理 ==========
async function getKeys(kv: KVNamespace): Promise<GroqKey[]> {
  return (await kvGet<GroqKey[]>(kv, KEYS_KEY)) || [];
}

async function saveKeys(kv: KVNamespace, keys: GroqKey[]): Promise<void> {
  await kvPut(kv, KEYS_KEY, keys);
}

async function getNextKey(kv: KVNamespace): Promise<GroqKey | null> {
  const keys = await getKeys(kv);
  const available = keys.filter(k => !k.disabled && k.credits > 0);
  if (available.length === 0) return null;
  
  // 簡單輪詢：選擇 credits 最多的
  available.sort((a, b) => b.credits - a.credits);
  return available[0];
}

// ========== 用戶管理 ==========
async function getUsers(kv: KVNamespace): Promise<Record<string, User>> {
  return (await kvGet<Record<string, User>>(kv, USERS_KEY)) || {};
}

async function saveUsers(kv: KVNamespace, users: Record<string, User>): Promise<void> {
  await kvPut(kv, USERS_KEY, users);
}

async function getUser(kv: KVNamespace, token: string): Promise<User | null> {
  const users = await getUsers(kv);
  return users[token] || null;
}

async function chargeUser(kv: KVNamespace, token: string, cost: number): Promise<boolean> {
  const users = await getUsers(kv);
  const user = users[token];
  if (!user || user.credits < cost) return false;
  
  user.credits -= cost;
  await saveUsers(kv, users);
  return true;
}

// ========== 驗證 Schema ==========
const chatCompletionSchema = z.object({
  model: z.string().optional(),
  messages: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string(),
  })),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  stream: z.boolean().optional(),
});

const adminKeySchema = z.object({
  key: z.string().min(10),
  label: z.string().optional(),
});

const adminUserSchema = z.object({
  name: z.string().min(1),
  role: z.enum(['user', 'admin']).default('user'),
  credits: z.number().int().nonnegative().default(0),
});

// ========== 建立 Hono 應用 ==========
const app = new Hono<{ Bindings: Env }>();

app.use('*', logger());
app.use('*', secureHeaders());
app.use('*', cors({
  origin: ['https://groq-router.vercel.app', 'https://zixilive.dpdns.org', 'http://localhost:3000'],
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}));

// ========== 初始化 ==========
async function initialize(kv: KVNamespace, env: Env) {
  const meta = await kvGet(kv, META_KEY);
  if (!meta) {
    // 從環境變數初始化 keys
    const groqKeys = env.GROQ_KEYS.split(/[,;\s]+/).filter(Boolean);
    const keys: GroqKey[] = groqKeys.map((k, i) => ({
      id: `key_${i}`,
      key: k,
      label: `Groq Key ${i + 1}`,
      addedAt: Date.now(),
      disabled: false,
      credits: 1000000,
      dailyUsed: 0,
      lastUsed: 0,
    }));
    
    if (env.NVIDIA_API_KEY) {
      keys.push({
        id: 'nvidia_nim',
        key: env.NVIDIA_API_KEY,
        label: 'NVIDIA NIM',
        addedAt: Date.now(),
        disabled: false,
        credits: 1000000,
        dailyUsed: 0,
        lastUsed: 0,
      });
    }
    
    await saveKeys(kv, keys);
    await saveUsers(kv, {});
    await kvPut(kv, META_KEY, { seeded: true, version: 1 });
  }
}

// ========== 中介軟體：認證 ==========
const authMiddleware = async (c: any, next: any) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ ok: false, error: 'Missing or invalid Authorization header' }, 401);
  }
  
  const token = authHeader.slice(7);
  const user = await getUser(c.env.KV, token);
  
  if (!user) {
    // 檢查是否為管理 token
    if (token === c.env.ADMIN_TOKEN || token === c.env.ROUTER_TOKEN) {
      c.set('user', { token, name: 'admin', role: 'admin', credits: 999999 });
      await next();
      return;
    }
    return c.json({ ok: false, error: 'Invalid token' }, 401);
  }
  
  c.set('user', user);
  c.set('token', token);
  await next();
};

// ========== 健康檢查 ==========
app.get('/health', async (c) => {
  await initialize(c.env.KV, c.env);
  return c.json({ ok: true, service: 'groq-router-api' });
});

// ========== 公開 API：聊天完成 ==========
app.post('/v1/chat/completions', authMiddleware, zValidator('json', chatCompletionSchema), async (c) => {
  await initialize(c.env.KV, c.env);
  
  const user = c.get('user');
  const body = c.req.valid('json');
  
  // 扣點 (每次請求 1 點)
  if (user.role !== 'admin') {
    const charged = await chargeUser(c.env.KV, c.get('token'), 1);
    if (!charged) {
      return c.json({ ok: false, error: 'Insufficient credits' }, 402);
    }
  }
  
  // 選擇金鑰
  const keyInfo = await getNextKey(c.env.KV);
  if (!keyInfo) {
    return c.json({ ok: false, error: 'No available API keys' }, 503);
  }
  
  // 代理請求到 Groq
  const isNvidia = keyInfo.id === 'nvidia_nim';
  const apiUrl = isNvidia 
    ? 'https://integrate.api.nvidia.com/v1/chat/completions'
    : 'https://api.groq.com/openai/v1/chat/completions';
  
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${keyInfo.key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  
  // 更新使用統計
  const keys = await getKeys(c.env.KV);
  const keyIndex = keys.findIndex(k => k.id === keyInfo.id);
  if (keyIndex !== -1) {
    keys[keyIndex].lastUsed = Date.now();
    keys[keyIndex].dailyUsed += 1;
    await saveKeys(c.env.KV, keys);
  }
  
  // 回傳回應
  const data = await response.arrayBuffer();
  return new Response(data, {
    status: response.status,
    headers: {
      'Content-Type': 'application/json',
      'X-Groq-Key-Used': keyInfo.label,
    },
  });
});

// ========== 獲取可用模型 ==========
app.get('/v1/models', authMiddleware, async (c) => {
  await initialize(c.env.KV, c.env);
  // 這裡可以回傳支援的模型列表
  return c.json({
    object: 'list',
    data: [
      { id: 'qwen/qwen3-32b', object: 'model', owned_by: 'groq' },
      { id: 'openai/gpt-oss-120b', object: 'model', owned_by: 'groq' },
      { id: 'openai/gpt-oss-20b', object: 'model', owned_by: 'groq' },
      { id: 'allam-2-7b', object: 'model', owned_by: 'groq' },
    ],
  });
});

// ========== 使用者資訊 ==========
app.get('/me', authMiddleware, async (c) => {
  const user = c.get('user');
  return c.json({
    ok: true,
    name: user.name,
    role: user.role,
    credits: user.credits,
  });
});

// ========== 管理員 API ==========
const admin = new Hono<{ Bindings: Env }>();
admin.use('*', authMiddleware);
admin.use('*', async (c, next) => {
  const user = c.get('user');
  if (user.role !== 'admin') {
    return c.json({ ok: false, error: 'Admin only' }, 403);
  }
  await next();
});

// 列出所有金鑰
admin.get('/keys', async (c) => {
  await initialize(c.env.KV, c.env);
  const keys = await getKeys(c.env.KV);
  // 隱藏實際 key 值
  const safeKeys = keys.map(k => ({ ...k, key: k.key.slice(0, 8) + '...' }));
  return c.json({ ok: true, keys: safeKeys });
});

// 新增金鑰
admin.post('/keys', zValidator('json', adminKeySchema), async (c) => {
  await initialize(c.env.KV, c.env);
  const { key, label } = c.req.valid('json');
  
  const keys = await getKeys(c.env.KV);
  const newKey: GroqKey = {
    id: `key_${Date.now()}`,
    key,
    label: label || `Key ${keys.length + 1}`,
    addedAt: Date.now(),
    disabled: false,
    credits: 1000000,
    dailyUsed: 0,
    lastUsed: 0,
  };
  
  keys.push(newKey);
  await saveKeys(c.env.KV, keys);
  
  return c.json({ ok: true, key: { ...newKey, key: newKey.key.slice(0, 8) + '...' } }, 201);
});

// 刪除金鑰
admin.delete('/keys/:id', async (c) => {
  await initialize(c.env.KV, c.env);
  const id = c.req.param('id');
  
  const keys = await getKeys(c.env.KV);
  const filtered = keys.filter(k => k.id !== id);
  
  if (filtered.length === keys.length) {
    return c.json({ ok: false, error: 'Key not found' }, 404);
  }
  
  await saveKeys(c.env.KV, filtered);
  return c.json({ ok: true });
});

// 切換金鑰啟用/停用
admin.patch('/keys/:id/toggle', async (c) => {
  await initialize(c.env.KV, c.env);
  const id = c.req.param('id');
  
  const keys = await getKeys(c.env.KV);
  const key = keys.find(k => k.id === id);
  if (!key) {
    return c.json({ ok: false, error: 'Key not found' }, 404);
  }
  
  key.disabled = !key.disabled;
  await saveKeys(c.env.KV, keys);
  
  return c.json({ ok: true, disabled: key.disabled });
});

// 列出用戶
admin.get('/users', async (c) => {
  await initialize(c.env.KV, c.env);
  const users = await getUsers(c.env.KV);
  const userList = Object.entries(users).map(([token, u]) => ({
    token: token.slice(0, 8) + '...',
    ...u,
  }));
  return c.json({ ok: true, users: userList });
});

// 建立用戶
admin.post('/users', zValidator('json', adminUserSchema), async (c) => {
  await initialize(c.env.KV, c.env);
  const { name, role, credits } = c.req.valid('json');
  
  const token = `ak_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
  const users = await getUsers(c.env.KV);
  
  users[token] = {
    token,
    name,
    role,
    credits,
    createdAt: Date.now(),
  };
  
  await saveUsers(c.env.KV, users);
  
  return c.json({ ok: true, token }, 201);
});

// 更新用戶點數
admin.patch('/users/:token/credits', zValidator('json', z.object({
  credits: z.number().int(),
})), async (c) => {
  await initialize(c.env.KV, c.env);
  const token = c.req.param('token');
  const { credits } = c.req.valid('json');
  
  const users = await getUsers(c.env.KV);
  if (!users[token]) {
    return c.json({ ok: false, error: 'User not found' }, 404);
  }
  
  users[token].credits = credits;
  await saveUsers(c.env.KV, users);
  
  return c.json({ ok: true });
});

// 刪除用戶
admin.delete('/users/:token', async (c) => {
  await initialize(c.env.KV, c.env);
  const token = c.req.param('token');
  
  const users = await getUsers(c.env.KV);
  if (!users[token]) {
    return c.json({ ok: false, error: 'User not found' }, 404);
  }
  
  delete users[token];
  await saveUsers(c.env.KV, users);
  
  return c.json({ ok: true });
});

app.route('/admin', admin);

// ========== 錯誤處理 ==========
app.onError((err, c) => {
  console.error('API Error:', err);
  return c.json({
    ok: false,
    error: 'Internal server error',
    message: c.env.ENVIRONMENT === 'production' ? undefined : err.message,
  }, 500);
});

app.notFound((c) => c.json({ ok: false, error: 'Not found' }, 404));

export default app;