import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { SignJWT, jwtVerify } from 'jose';

// ========== 型別定義 ==========
interface Env {
  DB: D1Database;
  KV: KVNamespace;
  JWT_SECRET: string;
  ENVIRONMENT: string;
  JWT_ISSUER: string;
  JWT_AUDIENCE: string;
}

interface User {
  id: number;
  email: string;
  password_hash: string;
  name: string;
  role: string;
  credits: number;
  created_at: string;
  updated_at: string;
}

interface Session {
  user_id: number;
  token: string;
  expires_at: number;
}

type JWTPayload = {
  sub: string;
  email: string;
  role: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string;
};

// ========== 常數 ==========
const JWT_ALG = 'HS256';
const TOKEN_EXPIRY = 7 * 24 * 60 * 60; // 7 天
const REFRESH_EXPIRY = 30 * 24 * 60 * 60; // 30 天

// ========== 工具函數 ==========
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const hashed = await hashPassword(password);
  return hashed === hash;
}

async function createJWT(user: User, env: Env): Promise<string> {
  const secret = new TextEncoder().encode(env.JWT_SECRET);
  const now = Math.floor(Date.now() / 1000);
  
  return new SignJWT({
    sub: user.id.toString(),
    email: user.email,
    role: user.role,
  })
    .setProtectedHeader({ alg: JWT_ALG })
    .setIssuedAt(now)
    .setIssuer(env.JWT_ISSUER)
    .setAudience(env.JWT_AUDIENCE)
    .setExpirationTime(now + TOKEN_EXPIRY)
    .sign(secret);
}

async function verifyJWT(token: string, env: Env): Promise<JWTPayload | null> {
  try {
    const secret = new TextEncoder().encode(env.JWT_SECRET);
    const { payload } = await jwtVerify(token, secret, {
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    });
    return payload as unknown as JWTPayload;
  } catch {
    return null;
  }
}

async function getUserFromToken(authHeader: string | undefined, env: Env): Promise<User | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const payload = await verifyJWT(token, env);
  if (!payload) return null;
  
  const user = await env.DB.prepare(
    'SELECT * FROM users WHERE id = ?'
  ).bind(payload.sub).first<User>();
  
  return user || null;
}

// ========== 驗證 Schema ==========
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(2).max(50),
});

const refreshSchema = z.object({
  refresh_token: z.string(),
});

// ========== 建立 Hono 應用 ==========
const app = new Hono<{ Bindings: Env }>();

// 全域中介軟體
app.use('*', logger());
app.use('*', secureHeaders());
app.use('*', cors({
  origin: ['https://zixilive.dpdns.org', 'https://master.livestream-dashboard-cs8.pages.dev', 'http://localhost:3000'],
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
}));

// ========== 健康檢查 ==========
app.get('/health', (c) => c.json({ 
  ok: true, 
  service: 'chitai-live-api',
  timestamp: new Date().toISOString(),
  env: c.env.ENVIRONMENT,
}));

// ========== 認證路由 ==========
const auth = new Hono<{ Bindings: Env }>();

// 登入
auth.post('/login', zValidator('json', loginSchema), async (c) => {
  const { email, password } = c.req.valid('json');
  
  const user = await c.env.DB.prepare(
    'SELECT * FROM users WHERE email = ?'
  ).bind(email).first<User>();
  
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return c.json({ 
      success: false, 
      error: 'Invalid credentials' 
    }, 401);
  }
  
  const token = await createJWT(user, c.env);
  const refreshToken = crypto.randomUUID();
  
  // 儲存 refresh token 到 KV (7天過期)
  await c.env.KV.put(
    `refresh:${refreshToken}`,
    JSON.stringify({ user_id: user.id }),
    { expirationTtl: REFRESH_EXPIRY }
  );
  
  // 更新最後登入時間
  await c.env.DB.prepare(
    'UPDATE users SET updated_at = datetime("now") WHERE id = ?'
  ).bind(user.id).run();
  
  return c.json({
    success: true,
    data: {
      token,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        credits: user.credits,
      }
    }
  });
});

// 註冊
auth.post('/register', zValidator('json', registerSchema), async (c) => {
  const { email, password, name } = c.req.valid('json');
  
  // 檢查 email 是否已存在
  const existing = await c.env.DB.prepare(
    'SELECT id FROM users WHERE email = ?'
  ).bind(email).first();
  
  if (existing) {
    return c.json({ 
      success: false, 
      error: 'Email already registered' 
    }, 409);
  }
  
  const passwordHash = await hashPassword(password);
  
  const result = await c.env.DB.prepare(
    'INSERT INTO users (email, password_hash, name, role, credits, created_at) VALUES (?, ?, ?, ?, ?, datetime("now")) RETURNING id'
  ).bind(email, passwordHash, name, 'user', 0).first<{ id: number }>();
  
  if (!result) {
    return c.json({ 
      success: false, 
      error: 'Registration failed' 
    }, 500);
  }
  
  const user = await c.env.DB.prepare(
    'SELECT * FROM users WHERE id = ?'
  ).bind(result.id).first<User>();
  
  const token = await createJWT(user!, c.env);
  const refreshToken = crypto.randomUUID();
  
  await c.env.KV.put(
    `refresh:${refreshToken}`,
    JSON.stringify({ user_id: user!.id }),
    { expirationTtl: REFRESH_EXPIRY }
  );
  
  return c.json({
    success: true,
    data: {
      token,
      refresh_token: refreshToken,
      user: {
        id: user!.id,
        email: user!.email,
        name: user!.name,
        role: user!.role,
        credits: user!.credits,
      }
    }
  }, 201);
});

// 刷新 Token
auth.post('/refresh', zValidator('json', refreshSchema), async (c) => {
  const { refresh_token } = c.req.valid('json');
  
  const sessionData = await c.env.KV.get(`refresh:${refresh_token}`);
  if (!sessionData) {
    return c.json({ success: false, error: 'Invalid refresh token' }, 401);
  }
  
  const { user_id } = JSON.parse(sessionData);
  const user = await c.env.DB.prepare(
    'SELECT * FROM users WHERE id = ?'
  ).bind(user_id).first<User>();
  
  if (!user) {
    return c.json({ success: false, error: 'User not found' }, 404);
  }
  
  // 刪除舊 refresh token，發新的
  await c.env.KV.delete(`refresh:${refresh_token}`);
  const newRefreshToken = crypto.randomUUID();
  
  await c.env.KV.put(
    `refresh:${newRefreshToken}`,
    JSON.stringify({ user_id: user.id }),
    { expirationTtl: REFRESH_EXPIRY }
  );
  
  const token = await createJWT(user, c.env);
  
  return c.json({
    success: true,
    data: {
      token,
      refresh_token: newRefreshToken,
    }
  });
});

// 登出
auth.post('/logout', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    // 可以選擇性地將 token 加入黑名單
    // 目前只回傳成功
  }
  return c.json({ success: true, message: 'Logged out' });
});

// 獲取當前用戶資訊
auth.get('/me', async (c) => {
  const user = await getUserFromToken(c.req.header('Authorization'), c.env);
  if (!user) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  
  return c.json({
    success: true,
    data: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      credits: user.credits,
      created_at: user.created_at,
    }
  });
});

app.route('/api/auth', auth);

// ========== 受保護路由中介軟體 ==========
const authMiddleware = async (c: any, next: any) => {
  const user = await getUserFromToken(c.req.header('Authorization'), c.env);
  if (!user) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  c.set('user', user);
  await next();
};

// ========== 用戶資料路由 ==========
const user = new Hono<{ Bindings: Env }>();
user.use('*', authMiddleware);

// 更新個人資料
user.put('/profile', zValidator('json', z.object({
  name: z.string().min(2).max(50).optional(),
  avatar: z.string().url().optional(),
})), async (c) => {
  const user = c.get('user');
  const { name, avatar } = c.req.valid('json');
  
  const updates = [];
  const params = [];
  
  if (name) { updates.push('name = ?'); params.push(name); }
  if (avatar) { updates.push('avatar = ?'); params.push(avatar); }
  
  if (updates.length === 0) {
    return c.json({ success: false, error: 'No fields to update' }, 400);
  }
  
  updates.push('updated_at = datetime("now")');
  params.push(user.id);
  
  await c.env.DB.prepare(
    `UPDATE users SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...params).run();
  
  const updated = await c.env.DB.prepare(
    'SELECT id, email, name, role, credits, avatar FROM users WHERE id = ?'
  ).bind(user.id).first();
  
  return c.json({ success: true, data: updated });
});

// 修改密碼
user.put('/password', zValidator('json', z.object({
  current_password: z.string(),
  new_password: z.string().min(8),
})), async (c) => {
  const user = c.get('user');
  const { current_password, new_password } = c.req.valid('json');
  
  if (!(await verifyPassword(current_password, user.password_hash))) {
    return c.json({ success: false, error: 'Current password incorrect' }, 401);
  }
  
  const newHash = await hashPassword(new_password);
  await c.env.DB.prepare(
    'UPDATE users SET password_hash = ?, updated_at = datetime("now") WHERE id = ?'
  ).bind(newHash, user.id).run();
  
  // 使所有 refresh token 失效
  // (實作時可掃描 KV 刪除該用戶的所有 refresh token)
  
  return c.json({ success: true, message: 'Password updated' });
});

app.route('/api/user', user);

// ========== 直播相關路由 ==========
const streams = new Hono<{ Bindings: Env }>();

// 獲取直播列表
streams.get('/', async (c) => {
  const page = parseInt(c.req.query('page') || '1');
  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
  const status = c.req.query('status'); // live, upcoming, ended
  
  let query = 'SELECT * FROM streams';
  const params = [];
  
  if (status) {
    query += ' WHERE status = ?';
    params.push(status);
  }
  
  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, (page - 1) * limit);
  
  const result = await c.env.DB.prepare(query).bind(...params).all();
  
  // 獲取總數
  let countQuery = 'SELECT COUNT(*) as total FROM streams';
  const countParams = [];
  if (status) {
    countQuery += ' WHERE status = ?';
    countParams.push(status);
  }
  const total = await c.env.DB.prepare(countQuery).bind(...countParams).first<{ total: number }>();
  
  return c.json({
    success: true,
    data: result.results,
    pagination: {
      page,
      limit,
      total: total?.total || 0,
      totalPages: Math.ceil((total?.total || 0) / limit),
    }
  });
});

// 獲取單一直播
streams.get('/:id', async (c) => {
  const id = c.req.param('id');
  const stream = await c.env.DB.prepare(
    'SELECT * FROM streams WHERE id = ?'
  ).bind(id).first();
  
  if (!stream) {
    return c.json({ success: false, error: 'Stream not found' }, 404);
  }
  
  return c.json({ success: true, data: stream });
});

// 建立直播 (需認證)
streams.post('/', authMiddleware, zValidator('json', z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  scheduled_at: z.string().datetime().optional(),
  is_private: z.boolean().default(false),
})), async (c) => {
  const user = c.get('user');
  const { title, description, scheduled_at, is_private } = c.req.valid('json');
  
  const result = await c.env.DB.prepare(
    `INSERT INTO streams (user_id, title, description, scheduled_at, is_private, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime("now")) RETURNING id`
  ).bind(user.id, title, description || '', scheduled_at || null, is_private ? 1 : 0, scheduled_at ? 'upcoming' : 'live').first<{ id: number }>();
  
  const stream = await c.env.DB.prepare('SELECT * FROM streams WHERE id = ?').bind(result!.id).first();
  
  return c.json({ success: true, data: stream }, 201);
});

// 更新直播狀態
streams.patch('/:id/status', authMiddleware, zValidator('json', z.object({
  status: z.enum(['live', 'ended', 'upcoming']),
})), async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const { status } = c.req.valid('json');
  
  // 檢查擁有權
  const stream = await c.env.DB.prepare('SELECT user_id FROM streams WHERE id = ?').bind(id).first<{ user_id: number }>();
  if (!stream || stream.user_id !== user.id) {
    return c.json({ success: false, error: 'Not authorized' }, 403);
  }
  
  await c.env.DB.prepare('UPDATE streams SET status = ?, updated_at = datetime("now") WHERE id = ?')
    .bind(status, id).run();
  
  const updated = await c.env.DB.prepare('SELECT * FROM streams WHERE id = ?').bind(id).first();
  return c.json({ success: true, data: updated });
});

app.route('/api/streams', streams);

// ========== 聊天/訊息路由 ==========
const messages = new Hono<{ Bindings: Env }>();

// 獲取直播聊天訊息
messages.get('/stream/:streamId', async (c) => {
  const streamId = c.req.param('streamId');
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 200);
  const before = c.req.query('before'); // timestamp
  
  let query = 'SELECT * FROM chat_messages WHERE stream_id = ?';
  const params = [streamId];
  
  if (before) {
    query += ' AND created_at < ?';
    params.push(before);
  }
  
  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);
  
  const result = await c.env.DB.prepare(query).bind(...params).all();
  
  return c.json({
    success: true,
    data: result.results.reverse(), // 由舊到新
  });
});

// 發送訊息 (需認證)
messages.post('/stream/:streamId', authMiddleware, zValidator('json', z.object({
  content: z.string().min(1).max(1000),
  type: z.enum(['text', 'emote', 'system']).default('text'),
})), async (c) => {
  const user = c.get('user');
  const streamId = c.req.param('streamId');
  const { content, type } = c.req.valid('json');
  
  // 檢查直播是否存在且正在直播
  const stream = await c.env.DB.prepare('SELECT status FROM streams WHERE id = ?').bind(streamId).first<{ status: string }>();
  if (!stream) {
    return c.json({ success: false, error: 'Stream not found' }, 404);
  }
  if (stream.status !== 'live') {
    return c.json({ success: false, error: 'Stream is not live' }, 400);
  }
  
  const result = await c.env.DB.prepare(
    `INSERT INTO chat_messages (stream_id, user_id, content, type, created_at)
     VALUES (?, ?, ?, ?, datetime("now")) RETURNING id`
  ).bind(streamId, user.id, content, type).first<{ id: number }>();
  
  const message = await c.env.DB.prepare('SELECT * FROM chat_messages WHERE id = ?').bind(result!.id).first();
  
  // 這裡可以加入 WebSocket 廣播邏輯 (使用 Durable Objects 或 Pusher 等)
  
  return c.json({ success: true, data: message }, 201);
});

app.route('/api/messages', messages);

// ========== 管理員路由 ==========
const admin = new Hono<{ Bindings: Env }>();
admin.use('*', authMiddleware);
admin.use('*', async (c, next) => {
  const user = c.get('user');
  if (user.role !== 'admin' && user.role !== 'moderator') {
    return c.json({ success: false, error: 'Forbidden' }, 403);
  }
  await next();
});

// 獲取所有用戶
admin.get('/users', async (c) => {
  const page = parseInt(c.req.query('page') || '1');
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 200);
  const search = c.req.query('search');
  
  let query = 'SELECT id, email, name, role, credits, created_at FROM users';
  const params = [];
  
  if (search) {
    query += ' WHERE email LIKE ? OR name LIKE ?';
    params.push(`%${search}%`, `%${search}%`);
  }
  
  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, (page - 1) * limit);
  
  const result = await c.env.DB.prepare(query).bind(...params).all();
  
  return c.json({ success: true, data: result.results });
});

// 更新用戶點數
admin.patch('/users/:id/credits', zValidator('json', z.object({
  credits: z.number().int(),
  reason: z.string().optional(),
})), async (c) => {
  const id = c.req.param('id');
  const { credits, reason } = c.req.valid('json');
  
  await c.env.DB.prepare(
    'UPDATE users SET credits = ?, updated_at = datetime("now") WHERE id = ?'
  ).bind(credits, id).run();
  
  // 記錄管理操作
  await c.env.DB.prepare(
    `INSERT INTO admin_logs (admin_id, action, target_id, details, created_at)
     VALUES (?, ?, ?, ?, datetime("now"))`
  ).bind(c.get('user').id, 'adjust_credits', id, JSON.stringify({ credits, reason })).run();
  
  return c.json({ success: true, message: 'Credits updated' });
});

// 封禁/解封用戶
admin.patch('/users/:id/ban', zValidator('json', z.object({
  banned: z.boolean(),
  reason: z.string().optional(),
})), async (c) => {
  const id = c.req.param('id');
  const { banned, reason } = c.req.valid('json');
  
  await c.env.DB.prepare(
    'UPDATE users SET role = ?, updated_at = datetime("now") WHERE id = ?'
  ).bind(banned ? 'banned' : 'user', id).run();
  
  await c.env.DB.prepare(
    `INSERT INTO admin_logs (admin_id, action, target_id, details, created_at)
     VALUES (?, ?, ?, ?, datetime("now"))`
  ).bind(c.get('user').id, banned ? 'ban' : 'unban', id, JSON.stringify({ reason })).run();
  
  return c.json({ success: true, message: banned ? 'User banned' : 'User unbanned' });
});

app.route('/api/admin', admin);

// ========== 錯誤處理 ==========
app.onError((err, c) => {
  console.error('API Error:', err);
  return c.json({
    success: false,
    error: 'Internal server error',
    message: c.env.ENVIRONMENT === 'production' ? undefined : err.message,
  }, 500);
});

app.notFound((c) => c.json({ success: false, error: 'Not found' }, 404));

export default app;