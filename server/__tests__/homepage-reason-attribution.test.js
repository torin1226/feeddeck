import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import express from 'express'

// Homepage reason attribution — proves video.reason is attached to
// category-row items when a matching signal exists. Does NOT retest
// buildReason (covered in recommendation-reason.test.js); just proves wiring.

let testDb

vi.mock('../database.js', () => ({ get db() { return testDb } }))
vi.mock('../logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))
vi.mock('../scoring.js', () => ({
  scoreVideos: (videos) => videos.map(v => ({ ...v, _score: 10 })),
  syncSearchToTaste: () => {},
}))
vi.mock('../topics.js', () => ({
  resolveTopics: async () => [],
  recordDiscoveredCreators: () => {},
  buildTrends24FallbackQueries: () => [],
}))
vi.mock('../content-filters.js', () => ({ filterSocialContent: (v) => v }))
vi.mock('../sources/index.js', () => ({
  registry: { list: () => [] },
  ytdlp: {},
  scraper: {},
}))

function makeDb() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE categories (
      key TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'social',
      query TEXT,
      sort_order INTEGER DEFAULT 99
    );
    CREATE TABLE homepage_cache (
      id TEXT PRIMARY KEY,
      category_key TEXT NOT NULL,
      url TEXT,
      title TEXT,
      thumbnail TEXT,
      duration INTEGER DEFAULT 0,
      source TEXT,
      uploader TEXT,
      view_count INTEGER,
      like_count INTEGER,
      subscriber_count INTEGER,
      upload_date TEXT,
      fetched_at DATETIME DEFAULT (datetime('now')),
      tags TEXT DEFAULT '[]',
      viewed INTEGER DEFAULT 0,
      width INTEGER,
      height INTEGER,
      expires_at DATETIME DEFAULT (datetime('now', '+1 day'))
    );
    CREATE TABLE creator_boosts (
      creator TEXT PRIMARY KEY,
      boost_score REAL DEFAULT 1.0,
      surface_boosts TEXT,
      last_updated DATETIME DEFAULT (datetime('now'))
    );
    CREATE TABLE subscription_backups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT,
      handle TEXT,
      display_name TEXT
    );
    CREATE TABLE taste_profile (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      signal_type TEXT,
      signal_value TEXT,
      weight REAL DEFAULT 1.0,
      surface_key TEXT
    );
    CREATE TABLE persistent_rows (
      key TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'nsfw',
      active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 99
    );
    CREATE TABLE persistent_row_items (
      row_key TEXT NOT NULL,
      video_url TEXT NOT NULL,
      title TEXT,
      thumbnail TEXT,
      duration INTEGER,
      uploader TEXT,
      view_count INTEGER,
      like_count INTEGER,
      upload_date TEXT,
      tags TEXT DEFAULT '[]',
      liked_at DATETIME,
      added_at DATETIME DEFAULT (datetime('now')),
      PRIMARY KEY (row_key, video_url)
    );
  `)
  return db
}

async function buildApp() {
  vi.resetModules()
  const { default: contentRouter } = await import('../routes/content.js')
  const app = express()
  app.use(contentRouter)
  return app
}

function callApp(app, method, url) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL('http://x' + url)
    const req = {
      method, url, headers: {},
      query: Object.fromEntries(parsedUrl.searchParams),
      params: {}, body: undefined, path: parsedUrl.pathname,
      on(event, cb) { if (event === 'end') queueMicrotask(cb) },
      pipe() {}, socket: { destroy() {} },
    }
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this },
      json(data) { resolve({ status: this.statusCode, body: data }) },
      setHeader() {}, end() { resolve({ status: this.statusCode, body: null }) },
      on() {},
    }
    try { app(req, res, (err) => { if (err) reject(err) }) }
    catch (err) { reject(err) }
  })
}

beforeEach(() => { testDb = makeDb() })

describe('GET /api/homepage — reason attribution', () => {
  it('attaches reason.kind === "creator" when uploader matches creator_boosts', async () => {
    testDb.prepare("INSERT INTO categories (key, label, mode, sort_order) VALUES ('trending', 'Trending', 'social', 1)").run()
    testDb.prepare("INSERT INTO creator_boosts (creator, boost_score) VALUES ('coolchannel', 2.0)").run()
    testDb.prepare(
      `INSERT INTO homepage_cache (id, category_key, url, uploader, title)
       VALUES ('v1', 'trending', 'https://yt.com/v1', 'CoolChannel', 'Test video')`
    ).run()

    const app = await buildApp()
    const r = await callApp(app, 'GET', '/api/homepage?mode=social')
    expect(r.status).toBe(200)

    const allVideos = (r.body.categories ?? []).flatMap(cat => cat.videos ?? [])
    const boosted = allVideos.find(v => v.uploader === 'CoolChannel')
    expect(boosted).toBeDefined()
    expect(boosted.reason).not.toBeNull()
    expect(boosted.reason.kind).toBe('creator')
  })

  it('sets reason to null when no signal matches', async () => {
    testDb.prepare("INSERT INTO categories (key, label, mode, sort_order) VALUES ('new', 'New', 'social', 1)").run()
    testDb.prepare(
      `INSERT INTO homepage_cache (id, category_key, url, uploader, title)
       VALUES ('v2', 'new', 'https://yt.com/v2', 'UnknownCreator', 'Another video')`
    ).run()

    const app = await buildApp()
    const r = await callApp(app, 'GET', '/api/homepage?mode=social')
    expect(r.status).toBe(200)

    const allVideos = (r.body.categories ?? []).flatMap(cat => cat.videos ?? [])
    const unknown = allVideos.find(v => v.uploader === 'UnknownCreator')
    expect(unknown).toBeDefined()
    expect(unknown.reason).toBeNull()
  })

  it('does not attach reason to pinned (persistent) row videos', async () => {
    testDb.prepare("INSERT INTO creator_boosts (creator, boost_score) VALUES ('pinnedcreator', 3.0)").run()
    testDb.prepare("INSERT INTO persistent_rows (key, label, mode, active) VALUES ('ph_likes', 'My Likes', 'social', 1)").run()
    testDb.prepare(
      `INSERT INTO persistent_row_items (row_key, video_url, title, uploader)
       VALUES ('ph_likes', 'https://yt.com/pinned', 'Pinned Video', 'PinnedCreator')`
    ).run()

    const app = await buildApp()
    const r = await callApp(app, 'GET', '/api/homepage?mode=social')
    expect(r.status).toBe(200)

    const pinnedRows = (r.body.categories ?? []).filter(cat => cat.pinned)
    for (const row of pinnedRows) {
      for (const v of row.videos ?? []) {
        expect(v.reason).toBeUndefined()
      }
    }
  })
})
