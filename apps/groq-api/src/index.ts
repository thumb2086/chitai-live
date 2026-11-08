import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { zValidator } from '@huno/zod-validator';
import { z } from 'zod';

interface Env { KV: KVNamespace; GROQ_KEYS: string; NVIDIA_API_KEY: string; ROUTER_TOKEN: string; ADMIN_TOKEN: string; ENVIRONMENT: string; }

const KV_PREFIX = 'gr:';
const KEYS_KEY = 'gr:keys'; const USERS_KEY = 'gr:users'; const META_KEY = 'gr:meta'; const USAGE_KEY = 'gr:usage';

const MODEL_PRICING = { 'qwen/qwen3-32b': { inputPer1k: 0, outputPer1k: 0, isPaid: false }, 'openai/gpt-oss-120b': { inputPer1k: 0, outputPer1k: 0, isPaid: false }, 'openai/gpt-oss-20b': { inputPer1k: 0, outputPer1k: 0, isPaid: false }, 'allam-2-7b': { inputPer1k: 0, outputPer1k: 0, isPaid: false }, 'meta-llama/llama-3.1-8b-instant': { inputPer1k: 0, outputPer1k: 0, isPaid: false }, 'gemma2-9b-it': { inputPer1k: 0, outputPer1k: 0, isPaid: false }, 'llama-3.1-70b-versatile': { inputPer1k: 0.59, outputPer1k: 0.79, isPaid: true }, 'llama-3.1-8b-instant': { inputPer1k: 0.05, outputPer1k: 0.08, isPaid: true }, 'mixtral-8x7b-32768': { inputPer1k: 0.24, outputPer1k: 0.24, isPaid: true }, 'gemma-7b-it': { inputPer1k: 0.07, outputPer1k: 0.07, isPaid: true }, 'nvidia/nemotron-3-ultra': { inputPer1k: 2.00, outputPer1k: 2.00, isPaid: true }, 'nvidia/llama-3.1-nemotron-70b': { inputPer1k: 1.50, outputPer1k: 1.50, isPaid: true } };

const USER_BILLING = {
  'ak_me': { rpm: 300, rpd: 5000, billingLimit: 211, used: 0, allowedModels: ['*'], canUsePaid: true }, // $2.11
  'ak_duckkk': { rpm: 600, rpd: 10000, billingLimit: 789, used: 0, allowedModels: ['*'], canUsePaid: true }, // $7.89
};

const DEFAULT_CONFIG = { rpm: 60, rpd: 1000, billingLimit: 0, allowedModels: ['free'], canUsePaid: false };

function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = MODEL_PRICING[model];
  if (!p) return 0;
  return Math.round((inputTokens / 1000) * p.inputPer1k + (outputTokens / 1000) * p.outputPer1k);
}

async function getUsers(kv: KVNamespace): Promise<Record<string, any>> { return (await kv.get('gr:users', 'json')) || {}; }
async function saveUsers(kv: KVNamespace, users: Record<string, any>): Promise<void> { await kv.put('gr:users', JSON.stringify(users)); }
async function saveUser(kv: KVNamespace, token: string, user: any): Promise<void> { const users = await getUsers(kv); users[token] = user; await saveUsers(kv, users); }

async function initialize(kv: KVNamespace, env: Env) {
  const meta = await kv.get('gr:meta', 'json');
  if (meta) return;
  const groqKeys = env.GROQ_KEYS.split(/[,;\s]+/).filter(Boolean);
  const keys = groqKeys.map((k, i) => ({ id: `key_${i}`, key: k, label: `Groq Key ${i + 1}`, addedAt: Date.now(), disabled: false, credits: 1000000, dailyUsed: 0, lastUsed: 0 }));
  if (env.NVIDIA_API_KEY) keys.push({ id: 'nvidia_nim', key: env.NVIDIA_API_KEY, label: 'NVIDIA NIM', addedAt: Date.now(), disabled: false, credits: 1000000, dailyUsed: 0, lastUsed: 0 });
  await kv.put('gr:keys', JSON.stringify(keys));
  await kv.put('gr:users', JSON.stringify({}));
  await kv.put('gr:meta', JSON.stringify({ seeded: true, version: 3 }));
}

const app = new Hono<{ Bindings: Env }>();
app.use('*', logger());
app.use('*', secureHeaders());
app.use('*', cors({ origin: ['https://groq-router.vercel.app', 'https://zixilive.dpdns.org', 'http://localhost:3000'], allowHeaders: ['Content-Type', 'Authorization'], allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] }));

const authMiddleware = async (c: any, next: any) => {
  await initialize(c.env.KV, c.env);
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return c.json({ ok: false, error: 'Missing or invalid Authorization header' }, 401);
  const token = authHeader.slice(7);
  const users = (await c.env.KV.get('gr:users', 'json')) || {};
  let user = users[token];
  if (!user) {
    if (token === c.env.ADMIN_TOKEN || token === c.env.ROUTER_TOKEN) { user = { token, name: 'admin', role: 'admin', credits: 999999, rpmLimit: 9999, rpdLimit: 999999, billingLimit: 0, billingUsed: 0, allowedModels: ['*'], canUsePaidModels: true, rpmUsed: 0, rpmWindowStart: 0, rpdUsed: 0, rpdWindowStart: 0, createdAt: Date.now() }; } else { return c.json({ ok: false, error: 'Invalid token' }, 401); }
  }
  const preset = USER_BILLING[user.name];
  if (preset) { user.rpmLimit = preset.rpm; user.rpdLimit = preset.rpd; user.billingLimit = preset.billingLimit; user.canUsePaidModels = preset.canUsePaid; user.allowedModels = preset.allowedModels; }
  const now = Date.now();
  if (now - user.rpmWindowStart > 60000) { user.rpmUsed = 0; user.rpmWindowStart = now; }
  if (user.rpmUsed >= user.rpmLimit) return c.json({ ok: false, error: 'RPM limit exceeded' }, 429);
  user.rpmUsed++;
  const dayMs = 86400000;
  if (now - user.rpdWindowStart > dayMs) { user.rpdUsed = 0; user.rpdWindowStart = now; }
  if (user.rpdUsed >= user.rpdLimit) return c.json({ ok: false, error: 'RPD limit exceeded' }, 429);
  user.rpdUsed++;
  c.set('user', user);
  c.set('token', token);
  await next();
  users[token] = user;
  await c.env.KV.put('gr:users', JSON.stringify(users));
};

app.get('/health', async (c) => { await initialize(c.env.KV, c.env); return c.json({ ok: true, service: 'groq-router-api', version: '2.1.0' }); });

app.post('/v1/chat/completions', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const model = body.model || 'qwen/qwen3-32b';
  const pricing = MODEL_PRICING[model];
  if (!pricing) return c.json({ ok: false, error: `Unknown model: ${model}` }, 400);
  if (pricing.isPaid && !user.canUsePaidModels) return c.json({ ok: false, error: `Model ${model} is paid. Upgrade your plan to access.` }, 403);
  if (user.allowedModels.length > 0 && !user.allowedModels.includes('*') && !user.allowedModels.includes(model)) return c.json({ ok: false, error: `Model ${model} not allowed` }, 403);
  if (user.billingLimit > 0) {
    const maxTokens = body.max_tokens || 4096;
    const estCost = calculateCost(model, 4096, maxTokens);
    if (user.billingUsed + estCost > user.billingLimit) return c.json({ ok: false, error: `Billing limit exceeded ($${(user.billingUsed/100).toFixed(2)}/$${(user.billingLimit/100).toFixed(2)})` }, 402);
  }
  const keys = await c.env.KV.get('gr:keys', 'json') || [];
  const available = keys.filter(k => !k.disabled && k.credits > 0);
  if (!available.length) return c.json({ ok: false, error: 'No available API keys' }, 503);
  available.sort((a, b) => b.credits - a.credits);
  const keyInfo = available[0];
  const isNvidia = keyInfo.id === 'nvidia_nim';
  const apiUrl = isNvidia ? 'https://integrate.api.nvidia.com/v1/chat/completions' : 'https://api.groq.com/openai/v1/chat/completions';
  const response = await fetch(apiUrl, { method: 'POST', headers: { 'Authorization': `Bearer ${keyInfo.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const responseText = await response.text();
  
  // 記錄計費 (非阻塞，只在成功時)
  if (response.status === 200) {
    try {
      const respJson = JSON.parse(responseText);
      const promptTokens = respJson?.usage?.prompt_tokens || 0;
      const completionTokens = respJson?.usage?.completion_tokens || 0;
      const actualCost = calculateCost(model, promptTokens, completionTokens);
      
      user.billingUsed += actualCost;
      await saveUser(c.env.KV, token, user);
      
      const today = new Date().toISOString().split('T')[0];
      const usageKey = `gr:usage:${token}:${today}`;
      const existingUsage = await c.env.KV.get(usageKey, 'json') as any || { requests: 0, totalCost: 0, models: {} };
      existingUsage.requests++;
      existingUsage.totalCost += actualCost;
      existingUsage.models[model] = (existingUsage.models[model] || 0) + 1;
      await c.env.KV.put(usageKey, JSON.stringify(existingUsage), { expirationTtl: 86400 * 2 });
    } catch (e) {
      // 記錄計費失敗不影響回應
    }
  }
  
  return new Response(responseText, { status: response.status, headers: { 'Content-Type': 'application/json', 'X-Groq-Key-Used': keyInfo.label } });
});

app.get('/v1/models', authMiddleware, async (c) => {
  const user = c.get('user');
  return c.json({ object: 'list', data: Object.entries(MODEL_PRICING).map(([id, p]) => ({ id, object: 'model', owned_by: p.isPaid ? 'groq-paid' : 'groq-free', pricing: { input_per_1k: p.inputPer1k, output_per_1k: p.outputPer1k, is_paid: p.isPaid }, accessible: user.allowedModels.includes('*') || user.allowedModels.includes(id) })) });
});

app.get('/me', authMiddleware, async (c) => {
  const user = c.get('user');
  return c.json({ ok: true, name: user.name, role: user.role, credits: user.credits, limits: { rpm: { limit: user.rpmLimit, used: user.rpmUsed, remaining: Math.max(0, user.rpmLimit - user.rpmUsed) }, rpd: { limit: user.rpdLimit, used: user.rpdUsed, remaining: Math.max(0, user.rpdLimit - user.rpdUsed) }, billing: user.billingLimit > 0 ? { limit: user.billingLimit / 100, used: user.billingUsed / 100, remaining: (user.billingLimit - user.billingUsed) / 100 } : { unlimited: true } }, permissions: { canUsePaidModels: user.canUsePaidModels, allowedModels: user.allowedModels } });
});

app.get('/usage', authMiddleware, async (c) => {
  const user = c.get('user');
  const today = new Date().toISOString().split('T')[0];
  const usage = await c.env.KV.get(`gr:usage:${c.get('token')}:${today}`, 'json') || { requests: 0, totalCost: 0, models: {} };
  return c.json({ ok: true, date: today, requests: usage.requests || 0, totalCost: (usage.totalCost || 0) / 100, models: usage.models || {} });
});

const admin = new Hono();
admin.use('*', authMiddleware);
admin.use('*', async (c, next) => { const user = c.get('user'); if (user.role !== 'admin') return c.json({ ok: false, error: 'Admin only' }, 403); await next(); });
admin.get('/users', async (c) => { await initialize(c.env.KV, c.env); const users = await getUsers(c.env.KV); return c.json({ ok: true, users: Object.entries(users).map(([token, u]) => ({ token: token.slice(0, 8) + '...', name: u.name, role: u.role, credits: u.credits, rpmLimit: u.rpmLimit, rpdLimit: u.rpdLimit, billingLimit: u.billingLimit, billingUsed: u.billingUsed, canUsePaidModels: u.canUsePaidModels, allowedModels: u.allowedModels })) }); });
admin.post('/users', async (c) => { await initialize(c.env.KV, c.env); const body = await c.req.json(); const users = await getUsers(c.env.KV); const name = body.name; let user = Object.values(users).find(u => u.name === name); let token; if (user) { token = Object.keys(users).find(k => users[k].name === name)!; } else { token = `ak_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`; } const newUser = { token, name, role: body.role ?? 'user', credits: 0, rpmLimit: body.rpmLimit ?? 60, rpdLimit: body.rpdLimit ?? 1000, billingLimit: body.billingLimit ?? 0, billingUsed: 0, allowedModels: body.allowedModels ?? ['*'], canUsePaidModels: body.canUsePaidModels ?? false, rpmUsed: 0, rpmWindowStart: 0, rpdUsed: 0, rpdWindowStart: 0, createdAt: Date.now() }; users[token] = newUser; await saveUsers(c.env.KV, users); return c.json({ ok: true, token, user: newUser }, 201); });
admin.patch('/users/:name/quota', async (c) => { await initialize(c.env.KV, c.env); const name = c.req.param('name'); const body = await c.req.json(); const users = await getUsers(c.env.KV); const entry = Object.entries(users).find(([_, u]) => u.name === name); if (!entry) return c.json({ ok: false, error: 'User not found' }, 404); const [token, user] = entry; if (body.rpmLimit !== undefined) user.rpmLimit = body.rpmLimit; if (body.rpdLimit !== undefined) user.rpdLimit = body.rpdLimit; if (body.billingLimit !== undefined) user.billingLimit = body.billingLimit; if (body.allowedModels !== undefined) user.allowedModels = body.allowedModels; if (body.canUsePaidModels !== undefined) user.canUsePaidModels = body.canUsePaidModels; await saveUser(c.env.KV, token, user); return c.json({ ok: true, user }); });
admin.post('/users/:name/reset-billing', async (c) => { await initialize(c.env.KV, c.env); const name = c.req.param('name'); const users = await getUsers(c.env.KV); const entry = Object.entries(users).find(([_, u]) => u.name === name); if (!entry) return c.json({ ok: false, error: 'User not found' }, 404); const [token, user] = entry; user.billingUsed = 0; await saveUser(c.env.KV, token, user); return c.json({ ok: true }); });
admin.get('/keys', async (c) => { await initialize(c.env.KV, c.env); return c.json({ ok: true, keys: await getKeys(c.env.KV) }); });
admin.post('/keys', async (c) => { const { key, label } = await c.req.json(); const keys = await getKeys(c.env.KV); const newKey = { id: `key_${Date.now()}`, key, label: label || `Key ${keys.length + 1}`, addedAt: Date.now(), disabled: false, credits: 1000000, dailyUsed: 0, lastUsed: 0 }; keys.push(newKey); await saveKeys(c.env.KV, keys); return c.json({ ok: true, key: { ...newKey, key: newKey.key.slice(0, 8) + '...' } }, 201); });
admin.delete('/keys/:id', async (c) => { const keys = await getKeys(c.env.KV); const filtered = keys.filter(k => k.id !== c.req.param('id')); if (filtered.length === keys.length) return c.json({ ok: false, error: 'Key not found' }, 404); await saveKeys(c.env.KV, filtered); return c.json({ ok: true }); });
admin.patch('/keys/:id/toggle', async (c) => { const id = c.req.param('id'); const keys = await getKeys(c.env.KV); const key = keys.find(k => k.id === id); if (!key) return c.json({ ok: false, error: 'Key not found' }, 404); key.disabled = !key.disabled; await saveKeys(c.env.KV, keys); return c.json({ ok: true, disabled: key.disabled }); });

app.route('/admin', admin);
app.onError((err, c) => { console.error('API Error:', err); return c.json({ ok: false, error: 'Internal server error', message: c.env.ENVIRONMENT === 'production' ? undefined : err.message }, 500); });
app.notFound((c) => c.json({ ok: false, error: 'Not found' }, 404));

export default app;