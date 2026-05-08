import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import express from 'express'

// ============================================================
// Feed-route tests — exercises GET /api/feed/next against an
// in-memory SQLite. Specifically locks down:
//
//  * excludeIds param filters out homepage-exposed IDs (M0.3)
//  * filtered-out IDs don't cause a 500 when the pool goes empty
//  * _persistent_row tag propagates when video is in a pinned row
//  * watched=1 rows are excluded regardless of excludeIds
//  * mode scoping: social feed never returns nsfw rows
// ============================================================

let testDb

vi.mock('../database.js', () => ({ get db() { return testDb } }))
vi.mock('../logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))
// scoreVideos passthrough: preserve all fields, add _score so the
// visible-filter doesn't need upload_date/like_count metadata.
vi.mock('../scoring.js', () => ({
  scoreVideos: (videos) => videos.map(v => ({ ...v, _score: 10 })),
  MIN_VISIBLE_SCORE: 0,
}))

function makeDb() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE feed_cache (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL,
      watched INTEGER DEFAULT 0,
      url TEXT,
      stream_url TEXT,
      title TEXT,
      creator TEXT,
      thumbnail TEXT,
      duration INTEGER DEFAULT 0,
      orientation TEXT,
      source_domain TEXT,
      tags TEXT DEFAULT '[]',
      upload_date INTEGER,
      like_count INTEGER,
      view_count INTEGER,
      subscriber_count INTEGER,
      fetched_at DATETIME DEFAULT (datetime('now'))
    );
    CREATE TABLE sources (
      domain TEXT PRIMARY KEY,
      mode TEXT,
      label TEXT,
      weight REAL DEFAULT 1.0,
      active INTEGER DEFAULT 1,
      query TEXT
    );
    CREATE TABLE subscription_backups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      handle TEXT,
      display_name TEXT,
      url TEXT,
      source_domain TEXT
    );
    CREATE TABLE system_searches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query TEXT,
      active INTEGER DEFAULT 1
    );
    CREATE TABLE persistent_rows (
      key TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'nsfw',
      source TEXT,
      fetcher TEXT,
      sort_order INTEGER DEFAULT 99,
      fetch_interval INTEGER DEFAULT 3600
    );
    CREATE TABLE persistent_row_items (
      row_key TEXT NOT NULL,
      video_url TEXT NOT NULL,
      title TEXT,
      thumbnail TEXT,
      duration INTEGER,
      view_count INTEGER,
      liked_at DATETIME,
      added_at DATETIME DEFAULT (datetime('now')),
      tags TEXT DEFAULT '[]',
      PRIMARY KEY (row_key, video_url),
      FOREIGN KEY (row_key) REFERENCES persistent_rows(key) ON DELETE CASCADE
    );
    CREATE TABLE queue (
      id TEXT PRIMARY KEY,
      position INTEGER NOT NULL,
      video_url TEXT,
      title TEXT,
      thumbnail TEXT,
      duration INTEGER,
      duration_formatted TEXT,
      mode TEXT,
      added_at DATETIME DEFAULT (datetime('now'))
    );
  `)
  return db
}

function seedVideos(db, rows) {
  const stmt = db.prepare(
    `INSERT INTO feed_cache (id, mode, watched, url, title, source_domain, duration)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  for (const r of rows) {
    stmt.run(r.id, r.mode ?? 'social', r.watched ?? 0, r.url ?? `https://example.com/${r.id}`, r.title ?? r.id, r.source ?? 'example.com', r.duration ?? 60)
  }
}

async function buildApp() {
  vi.resetModules()
  const { default: feedRouter } = await import('../routes/feed.js')
  const app = express()
  app.use(feedRouter)
  return app
}

function callApp(app, method, url) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL('http://x' + url)
    const req = {
      method,
      url,
      headers: {},
      query: Object.fromEntries(parsedUrl.searchParams),
      params: {},
      body: undefined,
      path: parsedUrl.pathname,
      on(event, cb) { if (event === 'end') queueMicrotask(cb) },
      pipe() {},
      socket: { destroy() {} },
    }
    let statusCode = 200
    const res = {
      statusCode,
      status(code) { this.statusCode = code; return this },
      json(data) { resolve({ status: this.statusCode, body: data }) },
      setHeader() {},
      end() { resolve({ status: this.statusCode, body: null }) },
      on() {},
    }
    try {
      app(req, res, (err) => { if (err) reject(err) })
    } catch (err) {
      reject(err)
    }
  })
}

beforeEach(() => {
  testDb = makeDb()
})

describe('GET /api/feed/next — basic', () => {
  it('returns unwatched videos from feed_cache', async () => {
    seedVideos(testDb, [
      { id: 'v1', mode: 'social', watched: 0 },
      { id: 'v2', mode: 'social', watched: 0 },
    ])
    const app = await buildApp()
    const r = await callApp(app, 'GET', '/api/feed/next?mode=social&count=10')
    expect(r.status).toBe(200)
    expect(r.body.videos).toHaveLength(2)
    expect(r.body.videos.map(v => v.id)).toEqual(expect.arrayContaining(['v1', 'v2']))
  })

  it('excludes watched=1 rows', async () => {
    seedVideos(testDb, [
      { id: 'w1', mode: 'social', watched: 1 },
      { id: 'w2', mode: 'social', watched: 0 },
    ])
    const app = await buildApp()
    const r = await callApp(app, 'GET', '/api/feed/next?mode=social&count=10')
    expect(r.status).toBe(200)
    expect(r.body.videos).toHaveLength(1)
    expect(r.body.videos[0].id).toBe('w2')
  })

  it('scopes to requested mode — social does not return nsfw rows', async () => {
    seedVideos(testDb, [
      { id: 'sf1', mode: 'social', watched: 0 },
      { id: 'nx1', mode: 'nsfw', watched: 0 },
    ])
    const app = await buildApp()
    const r = await callApp(app, 'GET', '/api/feed/next?mode=social&count=10')
    expect(r.status).toBe(200)
    const ids = r.body.videos.map(v => v.id)
    expect(ids).toContain('sf1')
    expect(ids).not.toContain('nx1')
  })
})

describe('GET /api/feed/next — excludeIds (M0.3)', () => {
  it('excludes videos whose IDs appear in excludeIds', async () => {
    seedVideos(testDb, [
      { id: 'hp1', mode: 'social', watched: 0 }, // exposed on homepage
      { id: 'hp2', mode: 'social', watched: 0 }, // exposed on homepage
      { id: 'fd1', mode: 'social', watched: 0 }, // feed-only
    ])
    const app = await buildApp()
    const r = await callApp(app, 'GET', '/api/feed/next?mode=social&count=10&excludeIds=hp1,hp2')
    expect(r.status).toBe(200)
    const ids = r.body.videos.map(v => v.id)
    expect(ids).not.toContain('hp1')
    expect(ids).not.toContain('hp2')
    expect(ids).toContain('fd1')
  })

  it('returns 200 with empty array when all pool IDs are excluded (no crash)', async () => {
    seedVideos(testDb, [
      { id: 'x1', mode: 'social', watched: 0 },
      { id: 'x2', mode: 'social', watched: 0 },
    ])
    const app = await buildApp()
    const r = await callApp(app, 'GET', '/api/feed/next?mode=social&count=10&excludeIds=x1,x2')
    expect(r.status).toBe(200)
    expect(r.body.videos).toEqual([])
  })

  it('ignores blank entries in excludeIds (comma-only or trailing comma)', async () => {
    seedVideos(testDb, [
      { id: 'v1', mode: 'social', watched: 0 },
    ])
    const app = await buildApp()
    // Malformed param: trailing comma and spaces
    const r = await callApp(app, 'GET', '/api/feed/next?mode=social&count=10&excludeIds=,+,')
    expect(r.status).toBe(200)
    // v1 should NOT be excluded — blank tokens aren't real IDs
    expect(r.body.videos.map(v => v.id)).toContain('v1')
  })

  it('watched=1 rows stay excluded even if NOT in excludeIds', async () => {
    seedVideos(testDb, [
      { id: 'w1', mode: 'social', watched: 1 },
      { id: 'v1', mode: 'social', watched: 0 },
    ])
    const app = await buildApp()
    const r = await callApp(app, 'GET', '/api/feed/next?mode=social&count=10&excludeIds=v1')
    expect(r.status).toBe(200)
    // v1 excluded by excludeIds, w1 excluded by watched — nothing returned
    expect(r.body.videos).toEqual([])
  })
})

describe('GET /api/feed/next — _persistent_row tagging (M0.3 pinned cap)', () => {
  it('tags a video with its pinned row key when it appears in persistent_row_items', async () => {
    seedVideos(testDb, [
      { id: 'pl1', mode: 'nsfw', watched: 0, url: 'https://pornhub.com/view_video.php?viewkey=abc' },
      { id: 'fd1', mode: 'nsfw', watched: 0, url: 'https://other.com/video1' },
    ])
    testDb.prepare("INSERT INTO persistent_rows (key, label, mode) VALUES ('ph_likes', 'My PH Likes', 'nsfw')").run()
    testDb.prepare(
      "INSERT INTO persistent_row_items (row_key, video_url) VALUES ('ph_likes', 'https://pornhub.com/view_video.php?viewkey=abc')"
    ).run()

    const app = await buildApp()
    const r = await callApp(app, 'GET', '/api/feed/next?mode=nsfw&count=10')
    expect(r.status).toBe(200)

    const pinned = r.body.videos.find(v => v.id === 'pl1')
    const regular = r.body.videos.find(v => v.id === 'fd1')

    expect(pinned?._persistent_row).toBe('ph_likes')
    expect(regular?._persistent_row).toBeNull()
  })

  it('leaves _persistent_row null for videos not in any pinned row', async () => {
    seedVideos(testDb, [
      { id: 'v1', mode: 'social', watched: 0 },
    ])
    const app = await buildApp()
    const r = await callApp(app, 'GET', '/api/feed/next?mode=social&count=10')
    expect(r.status).toBe(200)
    expect(r.body.videos[0]._persistent_row).toBeNull()
  })
})
