import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { logger } from './logger.js'

// ============================================================
// Database Setup
// SQLite via Node.js built-in node:sqlite (DatabaseSync).
// Single file, no server needed, easy to backup.
// Stores: videos, preferences, watch history
// ============================================================

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH = join(__dirname, '..', 'data', 'library.db')

export let db = null

export function initDatabase() {
  // Ensure data directory exists
  const dataDir = dirname(DB_PATH)
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true })
  }

  db = new DatabaseSync(DB_PATH)

  // Enable WAL mode for better concurrent performance
  db.exec('PRAGMA journal_mode = WAL')

  // Create tables
  db.exec(`
    -- Video library
    CREATE TABLE IF NOT EXISTS videos (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      title TEXT,
      thumbnail TEXT,
      duration INTEGER DEFAULT 0,
      tags TEXT DEFAULT '[]',
      source TEXT,
      added_at DATETIME DEFAULT (datetime('now')),
      last_watched DATETIME,
      watch_count INTEGER DEFAULT 0,
      rating INTEGER,
      favorite INTEGER DEFAULT 0
    );

    -- User preferences (key-value)
    CREATE TABLE IF NOT EXISTS preferences (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    -- Watch history (for future AI recommendations)
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id TEXT,
      watched_at DATETIME DEFAULT (datetime('now')),
      watch_duration INTEGER DEFAULT 0,
      completed INTEGER DEFAULT 0,
      FOREIGN KEY (video_id) REFERENCES videos(id)
    );

    -- Homepage categories (social and nsfw modes have separate categories)
    CREATE TABLE IF NOT EXISTS categories (
      key TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      query TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'social' CHECK(mode IN ('social', 'nsfw')),
      sort_order INTEGER DEFAULT 0
    );

    -- Homepage video cache (videos fetched for homepage display)
    CREATE TABLE IF NOT EXISTS homepage_cache (
      id TEXT PRIMARY KEY,
      category_key TEXT NOT NULL,
      url TEXT NOT NULL,
      title TEXT,
      thumbnail TEXT,
      duration INTEGER DEFAULT 0,
      source TEXT,
      uploader TEXT,
      view_count INTEGER DEFAULT 0,
      tags TEXT DEFAULT '[]',
      fetched_at DATETIME DEFAULT (datetime('now')),
      expires_at DATETIME DEFAULT (datetime('now', '+24 hours')),
      viewed INTEGER DEFAULT 0,
      FOREIGN KEY (category_key) REFERENCES categories(key)
    );

    -- Feed sources (domains that the feed pulls from)
    CREATE TABLE IF NOT EXISTS sources (
      domain TEXT PRIMARY KEY,
      mode TEXT NOT NULL DEFAULT 'social' CHECK(mode IN ('social', 'nsfw')),
      label TEXT,
      query TEXT,
      weight REAL DEFAULT 1.0,
      active INTEGER DEFAULT 1,
      fetch_interval INTEGER DEFAULT 1800,
      last_fetched DATETIME,
      added_at DATETIME DEFAULT (datetime('now'))
    );

    -- Feed video cache (short-form videos for the swipe feed)
    CREATE TABLE IF NOT EXISTS feed_cache (
      id TEXT PRIMARY KEY,
      source_domain TEXT,
      mode TEXT NOT NULL DEFAULT 'social',
      url TEXT NOT NULL UNIQUE,
      stream_url TEXT,
      title TEXT,
      creator TEXT,
      thumbnail TEXT,
      duration INTEGER DEFAULT 0,
      orientation TEXT DEFAULT 'horizontal',
      fetched_at DATETIME DEFAULT (datetime('now')),
      expires_at DATETIME DEFAULT (datetime('now', '+6 hours')),
      watched INTEGER DEFAULT 0,
      FOREIGN KEY (source_domain) REFERENCES sources(domain)
    );

    -- Indexes for common queries
    CREATE INDEX IF NOT EXISTS idx_videos_added ON videos(added_at DESC);
    CREATE INDEX IF NOT EXISTS idx_videos_source ON videos(source);
    CREATE INDEX IF NOT EXISTS idx_history_video ON history(video_id);
    CREATE INDEX IF NOT EXISTS idx_history_date ON history(watched_at DESC);
    CREATE INDEX IF NOT EXISTS idx_homepage_cache_category ON homepage_cache(category_key);
    CREATE INDEX IF NOT EXISTS idx_homepage_cache_expires ON homepage_cache(expires_at);
    CREATE INDEX IF NOT EXISTS idx_categories_mode ON categories(mode, sort_order);
    CREATE INDEX IF NOT EXISTS idx_feed_cache_mode ON feed_cache(mode, watched, expires_at);
    CREATE INDEX IF NOT EXISTS idx_feed_cache_url ON feed_cache(url);
    CREATE INDEX IF NOT EXISTS idx_sources_mode ON sources(mode, active);
  `)

  // Seed default categories if empty
  const catCount = db.prepare('SELECT COUNT(*) as n FROM categories').get()
  if (catCount.n === 0) {
    const insert = db.prepare('INSERT INTO categories (key, label, query, mode, sort_order) VALUES (?, ?, ?, ?, ?)')
    const defaults = [
      ['social-trending', 'Trending Now', 'trending videos', 'social', 0],
      ['social-popular', 'Popular This Week', 'most viewed this week', 'social', 1],
      ['social-new', 'New Arrivals', 'newest uploads', 'social', 2],
      ['social-picks', 'Staff Picks', 'editor picks best of', 'social', 3],
      ['nsfw-trending', 'Trending Now', 'trending', 'nsfw', 0],
      ['nsfw-popular', 'Popular This Week', 'most viewed', 'nsfw', 1],
      ['nsfw-new', 'New Arrivals', 'newest', 'nsfw', 2],
      ['nsfw-picks', 'Staff Picks', 'best rated', 'nsfw', 3],
    ]
    for (const row of defaults) {
      insert.run(...row)
    }
  }

  // Seed default feed sources if empty
  const srcCount = db.prepare('SELECT COUNT(*) as n FROM sources').get()
  if (srcCount.n === 0) {
    const insertSrc = db.prepare('INSERT INTO sources (domain, mode, label, query, weight) VALUES (?, ?, ?, ?, ?)')
    const defaultSources = [
      ['youtube.com', 'social', 'YouTube Shorts', 'ytsearch20:viral shorts 2025', 1.0],
      ['tiktok.com', 'social', 'TikTok', 'ytsearch20:tiktok compilation funny', 0.8],
      ['pornhub.com', 'nsfw', 'PornHub', 'trending', 1.0],
    ]
    for (const row of defaultSources) {
      insertSrc.run(...row)
    }
  }

  // Migrate: add fetch_interval and last_fetched to sources if missing
  try {
    const cols = db.prepare("PRAGMA table_info(sources)").all()
    const colNames = cols.map(c => c.name)
    if (!colNames.includes('fetch_interval')) {
      db.exec("ALTER TABLE sources ADD COLUMN fetch_interval INTEGER DEFAULT 1800")
    }
    if (!colNames.includes('last_fetched')) {
      db.exec("ALTER TABLE sources ADD COLUMN last_fetched DATETIME")
    }
  } catch {}

  logger.info('Database initialized', { path: DB_PATH })
  return db
}
