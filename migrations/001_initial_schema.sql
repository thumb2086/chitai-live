-- chitai-live D1 Schema (SQLite 相容)
-- 從 Neon PostgreSQL 遷移而來，已轉換語法

-- ========== 用戶表 ==========
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin', 'moderator', 'banned')),
  credits INTEGER DEFAULT 0,
  avatar TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- ========== 直播表 ==========
CREATE TABLE IF NOT EXISTS streams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  scheduled_at TEXT,
  is_private INTEGER DEFAULT 0,
  status TEXT DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'live', 'ended')),
  thumbnail TEXT,
  viewer_count INTEGER DEFAULT 0,
  max_viewers INTEGER DEFAULT 0,
  started_at TEXT,
  ended_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_streams_user_id ON streams(user_id);
CREATE INDEX IF NOT EXISTS idx_streams_status ON streams(status);
CREATE INDEX IF NOT EXISTS idx_streams_scheduled_at ON streams(scheduled_at);

-- ========== 聊天訊息表 ==========
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stream_id INTEGER NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  type TEXT DEFAULT 'text' CHECK (type IN ('text', 'emote', 'system')),
  metadata TEXT,  -- JSON 格式存儲額外資料
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chat_stream_id ON chat_messages(stream_id);
CREATE INDEX IF NOT EXISTS idx_chat_created_at ON chat_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_chat_user_id ON chat_messages(user_id);

-- ========== 關注/訂閱表 ==========
CREATE TABLE IF NOT EXISTS follows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notifications INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(follower_id, following_id)
);

CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id);

-- ========== 通知表 ==========
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  data TEXT,  -- JSON
  read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);

-- ========== 管理員日誌表 ==========
CREATE TABLE IF NOT EXISTS admin_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  target_id TEXT,
  details TEXT,  -- JSON
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_admin_logs_admin_id ON admin_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_logs_action ON admin_logs(action);
CREATE INDEX IF NOT EXISTS idx_admin_logs_created_at ON admin_logs(created_at);

-- ========== 直播分類/標籤 ==========
CREATE TABLE IF NOT EXISTS stream_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#6366f1',
  icon TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stream_category_links (
  stream_id INTEGER NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES stream_categories(id) ON DELETE CASCADE,
  PRIMARY KEY (stream_id, category_id)
);

-- ========== 禮物/打賞 ==========
CREATE TABLE IF NOT EXISTS gifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  price INTEGER NOT NULL,  -- 價格 (點數)
  icon TEXT,
  animation TEXT,
  description TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS donations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stream_id INTEGER NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
  from_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gift_id INTEGER NOT NULL REFERENCES gifts(id),
  quantity INTEGER DEFAULT 1,
  total_price INTEGER NOT NULL,
  message TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_donations_stream_id ON donations(stream_id);
CREATE INDEX IF NOT EXISTS idx_donations_from_user ON donations(from_user_id);
CREATE INDEX IF NOT EXISTS idx_donations_to_user ON donations(to_user_id);

-- ========== KV 模擬表 (用於 D1 適配器) ==========
CREATE TABLE IF NOT EXISTS kv_store (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at INTEGER,
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_kv_expires ON kv_store(expires_at);

-- ========== 觸發器：自動更新 updated_at ==========
CREATE TRIGGER IF NOT EXISTS trigger_users_updated_at
  AFTER UPDATE ON users
  FOR EACH ROW
  WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE users SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trigger_streams_updated_at
  AFTER UPDATE ON streams
  FOR EACH ROW
  WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE streams SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- ========== 預設資料 ==========
INSERT OR IGNORE INTO stream_categories (name, slug, description, color, icon) VALUES
  ('遊戲', 'gaming', '遊戲實況', '#8b5cf6', '🎮'),
  ('音樂', 'music', '音樂表演', '#ec4899', '🎵'),
  ('聊天', 'just-chatting', '閒聊互動', '#06b6d4', '💬'),
  ('程式設計', 'coding', '程式開發', '#22c55e', '💻'),
  ('藝術', 'art', '繪圖創作', '#f59e0b', '🎨'),
  ('教育', 'education', '教學知識', '#3b82f6', '📚');

INSERT OR IGNORE INTO gifts (name, slug, price, icon, description) VALUES
  ('愛心', 'heart', 10, '❤️', '送給主播的愛心'),
  ('火箭', 'rocket', 100, '🚀', '超級火箭'),
  ('皇冠', 'crown', 500, '👑', '榮耀皇冠'),
  ('彩虹', 'rainbow', 1000, '🌈', '綻放彩虹');