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
  origin: ['https://zixilive.dpdns.org', 'https://www.zixilive.dpdns.org', 'https://livestream-dashboard-cs8.pages.dev', 'https://master.livestream-dashboard-cs8.pages.dev', 'http://localhost:3000'],
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
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

// ========== OAuth provider stubs (Twitch / YouTube / Google / Discord) ==========
// �@
auth.get('/:provider{youtube|twitch|google|discord}', async (c) => {
  const provider = c.req.param('provider');
  const env = c.env as any;
  const supported = ['youtube', 'twitch', 'google', 'discord'];
  if (!supported.includes(provider)) {
    return c.json({ success: false, error: `Unknown OAuth provider: ${provider}` }, 404);
  }
  const clientIdVar = `${provider.toUpperCase()}_CLIENT_ID`;
  const clientId = env[clientIdVar];
  if (!clientId) {
    return c.json({
      success: false,
      error: `OAuth provider '${provider}' is not configured. Set ${clientIdVar} and ${provider.toUpperCase()}_CLIENT_SECRET secrets on the chitai-live-api Worker.`,
      hint: `npx wrangler secret put ${clientIdVar} --config wrangler.toml`,
    }, 503);
  }
  const redirectUri = 'https://api.zixilive.dpdns.org/api/auth/callback';
  let oauthUrl: string;
  if (provider === 'youtube' || provider === 'google') {
    const scope = 'openid email profile https://www.googleapis.com/auth/youtube.readonly';
    oauthUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope, access_type: 'offline', prompt: 'consent', state: provider }).toString();
  } else if (provider === 'twitch') {
    oauthUrl = 'https://id.twitch.tv/oauth2/authorize?' + new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'user:read:email', state: provider }).toString();
  } else {
    oauthUrl = 'https://discord.com/api/oauth2/authorize?' + new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'identify email', state: provider }).toString();
  }
  return c.redirect(oauthUrl, 302);
});

auth.get('/callback', async (c) => {
  const code = c.req.query('code');
  const error = c.req.query('error');
  const state = c.req.query('state') || '';
  const provider = state || 'youtube';
  const env = c.env as any;
  if (error) return c.json({ success: false, error: `OAuth denied: ${error}` }, 400);
  if (!code) return c.json({ success: false, error: 'Missing OAuth authorization code.' }, 400);

  const providerKey = provider.toUpperCase();
  const clientId = env[`${providerKey}_CLIENT_ID`];
  const clientSecret = env[`${providerKey}_CLIENT_SECRET`];
  if (!clientId || !clientSecret) return c.json({ success: false, error: `OAuth provider '${provider}' is not configured.` }, 503);

  const redirectUri = 'https://api.zixilive.dpdns.org/api/auth/callback';
  let email: string | undefined, name: string | undefined, avatar: string | undefined;
  try {
    if (provider === 'youtube' || provider === 'google') {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, grant_type: 'authorization_code', redirect_uri: redirectUri }).toString(),
      });
      const tokenJson = await tokenRes.json() as any;
      if (!tokenRes.ok || !tokenJson.access_token) throw new Error(tokenJson?.error_description || 'Google token exchange failed');
      const userRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${tokenJson.access_token}` } });
      const info = await userRes.json() as any;
      email = info.email; name = info.name || info.given_name; avatar = info.picture;
    } else if (provider === 'twitch') {
      const tokenRes = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, grant_type: 'authorization_code', redirect_uri: redirectUri }).toString(),
      });
      const tokenJson = await tokenRes.json() as any;
      if (!tokenRes.ok || !tokenJson.access_token) throw new Error(tokenJson?.message || 'Twitch token exchange failed');
      const userRes = await fetch('https://api.twitch.tv/helix/users', { headers: { 'Client-Id': clientId, Authorization: `Bearer ${tokenJson.access_token}` } });
      const userJson = await userRes.json() as any;
      const u = userJson?.data?.[0] || {};
      email = u.email; name = u.display_name || u.login; avatar = u.profile_image_url;
    } else {
      return c.json({ success: false, error: `Unsupported provider: ${provider}` }, 400);
    }
  } catch (e: any) {
    return c.json({ success: false, error: e?.message || 'OAuth exchange failed' }, 500);
  }

  if (!email) return c.json({ success: false, error: 'Provider did not return an email (scope missing?).' }, 502);
  name = name || email.split('@')[0];

  // Find or create user
  let user = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<User>();
  if (!user) {
    const fakeHash = await hashPassword(`oauth:${provider}:${email}`);
    await c.env.DB.prepare(
      'INSERT INTO users (email, password_hash, name, role, credits, avatar, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime("now"))'
    ).bind(email, fakeHash, name, 'user', 0, avatar || null).run();
    user = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<User>();
  } else if (avatar && !user.avatar) {
    await c.env.DB.prepare('UPDATE users SET avatar = ?, updated_at = datetime("now") WHERE id = ?').bind(avatar, user.id).run();
    user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first<User>();
  }

  const token = await createJWT(user!, c.env);
  const refreshToken = crypto.randomUUID();
  await c.env.KV.put(`refresh:${refreshToken}`, JSON.stringify({ user_id: user!.id }), { expirationTtl: REFRESH_EXPIRY });

  const dest = 'https://www.zixilive.dpdns.org/dashboard?token=' + encodeURIComponent(token);
  const res = new Response(null, { status: 302, headers: { Location: dest } });
  res.headers.set('Set-Cookie', `token=${token}; Path=/; Max-Age=604800; Secure; SameSite=Lax`);
  return res;
});

app.route('/api/auth', auth);
app.route('/api/v1/auth', auth);

// ========== 受保護路由中介軟體 ==========
const authMiddleware = async (c: any, next: any) => {
  if (c.req.path.includes('/by-username/')) return await next();
  const user = await getUserFromToken(c.req.header('Authorization'), c.env);
  if (!user) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  c.set('user', user);
  await next();
};

// ========== 用戶資料路由 ==========

// Public profile lookup (no auth) — mounted at /api/v1/user/by-username/*
app.get('/api/v1/user/by-username/:username', async (c) => {
  const username = c.req.param('username');
  if (!username) return c.json({ success: false, error: 'Missing username' }, 400);
  const row = await c.env.DB.prepare(
    'SELECT id, email, name, username, avatar, role, credits FROM users WHERE username = ?'
  ).bind(username).first();
  if (!row) return c.json({ success: false, error: 'User not found' }, 404);
  const connections = await c.env.DB.prepare(
    'SELECT platform, channel_id, channel_name, channel_avatar, connected FROM platform_connections WHERE user_id = ?'
  ).bind((row as any).id).all();
  return c.json({ success: true, data: { ...(row as any), connections: connections.results || [] } });
});

const user = new Hono<{ Bindings: Env }>();
// Public profile lookup must be registered before auth middleware
user.get('/', async (c) => {
  const me = c.get('user') as any;
  return c.json({ success: true, data: { id: me.id, email: me.email, name: me.name, role: me.role, credits: me.credits, avatar: me.avatar, created_at: me.created_at } });
});

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

// PATCH /user — frontend api.updateUser + account page save.
// Whitelist only: name/avatar are real columns. Other keys sent by the
// dashboard (username, publicPage, demoMode, zixiWallet, …) have no column
// in the D1 schema, so they are ignored rather than erroring — returning
// 404/400 here made every save look like a failure. Never accept
// role/credits/email/password_hash from this route (privilege escalation).
user.patch('/', async (c) => {
  const me = c.get('user') as any;
  const body = await c.req.json().catch(() => ({} as any));
  const updates: string[] = [];
  const params: any[] = [];
  if (typeof body?.name === 'string' && body.name.trim().length > 0) {
    updates.push('name = ?'); params.push(body.name.trim().slice(0, 50));
  }
  if (typeof body?.avatar === 'string' && body.avatar.length > 0) {
    updates.push('avatar = ?'); params.push(body.avatar);
  }
  if (updates.length > 0) {
    updates.push('updated_at = datetime("now")');
    params.push(me.id);
    await c.env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run();
  }
  const updated = await c.env.DB.prepare(
    'SELECT id, email, name, role, credits, avatar, created_at FROM users WHERE id = ?'
  ).bind(me.id).first();
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
app.route('/api/v1/user', user);

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
app.route('/api/v1/streams', streams);

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
app.route('/api/v1/messages', messages);

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
  credits: z.number().int().min(0),
  reason: z.string().optional(),
})), async (c) => {
  const id = c.req.param('id');
  const { credits, reason } = c.req.valid('json');
  const actor = c.get('user') as any;
  const target = await c.env.DB.prepare('SELECT id, role FROM users WHERE id = ?').bind(id).first<{ id: number; role: string }>();
  if (!target) return c.json({ success: false, error: 'User not found' }, 404);
  // Moderators must not adjust other admins' credits (IDOR / privilege guard).
  if (target.role === 'admin' && actor.role !== 'admin') {
    return c.json({ success: false, error: 'Forbidden' }, 403);
  }

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
  const actor = c.get('user') as any;
  if (Number(id) === actor.id) return c.json({ success: false, error: 'Cannot change your own role' }, 400);
  const target = await c.env.DB.prepare('SELECT id, role FROM users WHERE id = ?').bind(id).first<{ id: number; role: string }>();
  if (!target) return c.json({ success: false, error: 'User not found' }, 404);
  if (target.role === 'admin' && actor.role !== 'admin') {
    return c.json({ success: false, error: 'Forbidden' }, 403);
  }

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
app.route('/api/v1/admin', admin);

// ========== 錯誤處理 ==========
app.get('/.well-known/services.json', (c) => {
  return c.json({
    version: '1.0',
    services: {
      'zixi-earth': { name: 'zixi-earth', baseUrl: 'https://zixiearth.dpdns.org', health: '/health', capabilities: ['company-management', 'stock-trading', 'mining', 'casino-games', 'wallet'] },
      'groq-router': { name: 'groq-router', baseUrl: 'https://groq.zixilive.dpdns.org', health: '/health', capabilities: ['chat-completion', 'models-list', 'usage-tracking'] },
      'chitai-live-api': { name: 'chitai-live-api', baseUrl: 'https://api.zixilive.dpdns.org', health: '/health', capabilities: ['stream-management', 'chat', 'donations', 'user-management'] },
      'chitai-live-web': { name: 'chitai-live-web', baseUrl: 'https://www.zixilive.dpdns.org', health: '/', capabilities: ['stream-dashboard', 'chat-ui', 'donation-alerts'] },
    },
    shared: { jwt: { issuer: 'zixi-ecosystem', audience: 'zixi-services' } }
  }, 200, { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' });
});

app.get('/.well-known/services/health', async (c) => {
  const services: { name: string; url: string | null }[] = [
    { name: 'groq-router', url: 'https://groq-router-api.bold-waterfall-5f4d.workers.dev/health' },
    { name: 'chitai-live-api', url: null },
  ];
  const results = await Promise.allSettled(services.map(async (svc) => {
    if (!svc.url) return { name: svc.name, healthy: true, status: 200, self: true };
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(svc.url, { method: 'GET', signal: controller.signal, headers: { 'Accept': 'application/json' } });
      clearTimeout(timeout);
      const ok = res.status < 502;
      return { name: svc.name, healthy: ok, status: res.status };
    } catch (e: any) { return { name: svc.name, healthy: false, error: e.message }; }
  }));
  const health = results.map(r => r.status === 'fulfilled' ? r.value : { name: 'unknown', healthy: false });
  const overall = health.filter(h => h.name !== 'zixi-earth').every(h => h.healthy) ? 'healthy' : 'degraded';
  return c.json({ overall, services: health, timestamp: new Date().toISOString() });
});

app.onError((err, c) => {
  console.error('API Error:', err);
  return c.json({
    success: false,
    error: 'Internal server error',
    message: c.env.ENVIRONMENT === 'production' ? undefined : err.message,
  }, 500);
});

// ========== Legacy dashboard module stubs (return empty state, not 404) ==========
// These keep the static-export dashboard quiet while the real modules are migrated.
// Real wallet summary (Sidebar member-points ribbon)
for (const base of ['/api/v1/zixi/proxy', '/api/zixi/proxy']) {
  app.post(base, authMiddleware, async (c) => {
    const user = c.get('user') as any;
    const body = await c.req.json().catch(() => ({}));
    if (body?.action === 'wallet-summary') {
      const u = await c.env.DB.prepare('SELECT id, email, name, credits, role FROM users WHERE id = ?').bind(user.id).first();
      return c.json({ success: true, data: { connected: true, balances: { ZXC: u ? Number((u as any).credits || 0) : 0, YJC: 0 }, email: user.email } });
    }
    return c.json({ success: true, data: { connected: false } });
  });
}

// zixi/check-tx + zixi-donations (dashboard pages fetch these; without a
// stub they 404 and spam the console even though the page renders empty).
for (const base of ['/api/v1/zixi/check-tx', '/api/zixi/check-tx']) {
  app.post(base, (c) => c.json({ success: true, data: { checked: true, found: 0 } }));
}
for (const base of ['/api/v1/zixi-donations', '/api/zixi-donations']) {
  app.all(base, (c) => c.json({ success: true, data: { donations: [] } }));
  app.all(`${base}/*`, (c) => c.json({ success: true, data: { donations: [] } }));
}
// features/:key (useFeature in ui.tsx) — settings blob, empty by default.
for (const base of ['/api/v1/features', '/api/features']) {
  app.get(`${base}/*`, (c) => c.json({ success: true, data: { settings: {} } }));
  app.put(`${base}/*`, async (c) => {
    const body = await c.req.json().catch(() => ({} as any));
    return c.json({ success: true, data: { settings: body?.settings ?? {} } });
  });
  app.post(`${base}/*`, async (c) => {
    const body = await c.req.json().catch(() => ({} as any));
    return c.json({ success: true, data: { settings: body?.settings ?? {} } });
  });
}
// captions/transcribe + captions/segments (subtitles page probe + post).
for (const base of ['/api/v1/captions', '/api/captions']) {
  app.all(base, (c) => c.json({ success: true, data: { configured: false, provider: null, order: [], direct: false, router: false, routerHost: null } }));
  app.all(`${base}/*`, (c) => c.json({ success: true, data: { configured: false, provider: null, order: [], direct: false, router: false, routerHost: null, ok: true } }));
}
// live-viewers, replay-jobs, donation-records — empty lists, not 404.
for (const [base, data] of [
  ['live-viewers', { viewers: null, known: false, connections: [] }],
  ['replay-jobs', { jobs: [] }],
  ['donation-records', { records: [] }],
] as const) {
  for (const b of [`/api/v1/${base}`, `/api/${base}`]) {
    app.all(b, (c) => c.json({ success: true, data }));
    app.all(`${b}/*`, (c) => c.json({ success: true, data }));
  }
}
// rag / knowledge base — shape varies by action/query; empty results.
for (const base of ['/api/v1/rag', '/api/rag']) {
  app.all(base, async (c) => {
    const action = c.req.query('action');
    const body = await c.req.json().catch(() => ({} as any));
    const act = action || body?.action;
    if (act === 'feeds') return c.json({ success: true, data: { ok: true, feeds: [] } });
    if (act === 'episodes') return c.json({ success: true, data: { ok: true, episodes: [] } });
    if (act === 'search') return c.json({ success: true, data: { ok: true, results: [] } });
    if (act === 'ask') return c.json({ success: true, data: { ok: true, answer: '', grounded: false, sources: [] } });
    if (act === 'index') return c.json({ success: true, data: { ok: true, synced: 0, chunks: 0 } });
    if (act === 'podcast-subscribe') return c.json({ success: true, data: { ok: true, feedId: '', added: 0 } });
    if (act === 'podcast-ingest') return c.json({ success: true, data: { ok: true, segments: 0, chunks: 0, durationSec: null } });
    return c.json({ success: true, data: { ok: true, total: 0, byType: [], captionSegments: 0, captionIndexed: 0 } });
  });
}

const stubModules: Record<string, any> = {
  obs: { outputs: [], sources: [] },
  onboard: { completed: false, steps: [] },
  giveaways: { giveaways: [], items: [], total: 0 },
  commands: { commands: [], items: [], total: 0 },
  donations: { goals: [], items: [], total: 0, totalReceived: 0, donorCount: 0, minAmount: 0 },
  connections: {
    twitch: { connected: false, channelName: null, channelAvatar: null },
    youtube: { connected: false, channelName: null, channelAvatar: null },
    channels: [], total: 0,
  },
  zixi: { wallet: null, transactions: [] },
  'zixi/proxy': null,  // special-cased below
  chat: {},
  subtitles: {},
  stats: { sessions: [], total: 0, connections: [] },
  seed: { ok: true, userId: '1' },
};
for (const prefix of Object.keys(stubModules)) {
  for (const base of [`/api/v1/${prefix}`, `/api/${prefix}`]) {
    const handler = (c: any) => c.json({ success: true, data: stubModules[prefix] });
    app.all(base, handler);
    app.all(`${base}/*`, handler);
  }
}

app.notFound((c) => c.json({ success: false, error: 'Not found' }, 404));

export default app;