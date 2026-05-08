import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import express from 'express'

// ============================================================
// /api/stream-url ↔ homepage_cache caching tests
// (Discovered task 2026-05-06: Eager pre-resolve homepage stream URLs)
//
// /api/stream-url historically only checked feed_cache for cached
// resolved URLs. Homepage cards live in homepage_cache and aren't in
// feed_cache, so every click hit cold yt-dlp (~5s). This contract
// adds dual-table read + dual-table write so warm-cache pre-resolution
// AND prior /api/stream-url calls hydrate homepage cards too.
// ============================================================

let testDb
let mockGetStreamUrl

vi.mock('../database.js', () => ({ get db() { return testDb } }))
vi.mock('../logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))
vi.mock('../sources/index.js', () => ({
  registry: {
    getStreamUrl: (...args) => mockGetStreamUrl(...args),
    adapters: [],
  },
  ytdlp: { isAvailable: () => false, version: null },
}))
vi.mock('../cookies.js', () => ({ getCookieArgs: () => [] }))
vi.mock('../utils.js', () => ({
  isAllowedCdnUrl: () => true,
  inferMode: () => 'social',
  safeParse: (s, fallback) => { try { return JSON.parse(s) } catch { return fallback } },
  getRefererForUrl: () => null,
}))

function makeDb() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE feed_cache (
      id TEXT PRIMARY KEY,
      url TEXT,
      stream_url TEXT,
      expires_at DATETIME
    );
    CREATE TABLE homepage_cache (
      id TEXT PRIMARY KEY,
      category_key TEXT NOT NULL,
      url TEXT NOT NULL,
      title TEXT,
      stream_url TEXT,
      stream_url_expires_at DATETIME,
      viewed INTEGER DEFAULT 0,
      fetched_at DATETIME DEFAULT (datetime('now')),
      expires_at DATETIME DEFAULT (datetime('now', '+7 days'))
    );
  `)
  return db
}

async function buildApp() {
  vi.resetModules()
  const { default: streamRouter } = await import('../routes/stream.js')
  const app = express()
  app.use(streamRouter)
  return app
}

function callApp(app, method, url) {
  return new Promise((resolve, reject) => {
    const req = {
      method,
      url,
      headers: {},
      query: Object.fromEntries(new URL('http://x' + url).searchParams),
      params: {},
      path: url.split('?')[0],
      on(event, cb) { if (event === 'end') queueMicrotask(cb) },
      pipe() {},
      socket: { destroy() {} },
    }
    let payload = null
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this },
      json(data) { payload = data; resolve({ status: this.statusCode, body: data }) },
      setHeader() {},
      end() { resolve({ status: this.statusCode, body: payload }) },
      on() {},
    }
    try {
      app(req, res, (err) => { if (err) reject(err) })
    } catch (err) {
      reject(err)
    }
  })
}

describe('/api/stream-url + homepage_cache', () => {
  beforeEach(() => {
    testDb = makeDb()
    mockGetStreamUrl = vi.fn().mockResolvedValue('https://cdn.example.com/resolved.mp4')
  })

  it('serves a fresh stream_url from homepage_cache when feed_cache has no row', async () => {
    const url = 'https://www.youtube.com/watch?v=abc'
    testDb.prepare(
      `INSERT INTO homepage_cache (id, category_key, url, stream_url, stream_url_expires_at)
       VALUES (?, ?, ?, ?, datetime('now', '+1 hours'))`
    ).run('hp_abc', 'social_trending', url, 'https://cdn.example.com/cached.mp4')

    const app = await buildApp()
    const r = await callApp(app, 'GET', '/api/stream-url?url=' + encodeURIComponent(url))
    expect(r.status).toBe(200)
    expect(r.body.streamUrl).toBe('https://cdn.example.com/cached.mp4')
    expect(mockGetStreamUrl).not.toHaveBeenCalled()
  })

  it('prefers feed_cache when both tables have a fresh entry', async () => {
    const url = 'https://www.youtube.com/watch?v=both'
    testDb.prepare(
      `INSERT INTO feed_cache (id, url, stream_url, expires_at)
       VALUES (?, ?, ?, datetime('now', '+1 hours'))`
    ).run('fc_both', url, 'https://cdn.example.com/feed.mp4')
    testDb.prepare(
      `INSERT INTO homepage_cache (id, category_key, url, stream_url, stream_url_expires_at)
       VALUES (?, ?, ?, ?, datetime('now', '+1 hours'))`
    ).run('hp_both', 'social_trending', url, 'https://cdn.example.com/homepage.mp4')

    const app = await buildApp()
    const r = await callApp(app, 'GET', '/api/stream-url?url=' + encodeURIComponent(url))
    expect(r.status).toBe(200)
    expect(r.body.streamUrl).toBe('https://cdn.example.com/feed.mp4')
    expect(mockGetStreamUrl).not.toHaveBeenCalled()
  })

  it('falls through to yt-dlp when both cached entries are expired', async () => {
    const url = 'https://www.youtube.com/watch?v=stale'
    testDb.prepare(
      `INSERT INTO feed_cache (id, url, stream_url, expires_at)
       VALUES (?, ?, ?, datetime('now', '-1 hours'))`
    ).run('fc_stale', url, 'https://cdn.example.com/feed-old.mp4')
    testDb.prepare(
      `INSERT INTO homepage_cache (id, category_key, url, stream_url, stream_url_expires_at)
       VALUES (?, ?, ?, ?, datetime('now', '-1 hours'))`
    ).run('hp_stale', 'social_trending', url, 'https://cdn.example.com/hp-old.mp4')

    const app = await buildApp()
    const r = await callApp(app, 'GET', '/api/stream-url?url=' + encodeURIComponent(url))
    expect(r.status).toBe(200)
    expect(r.body.streamUrl).toBe('https://cdn.example.com/resolved.mp4')
    expect(mockGetStreamUrl).toHaveBeenCalledOnce()
  })

  it('falls through to homepage_cache when feed_cache is expired but homepage_cache is fresh', async () => {
    const url = 'https://www.youtube.com/watch?v=mixed'
    testDb.prepare(
      `INSERT INTO feed_cache (id, url, stream_url, expires_at)
       VALUES (?, ?, ?, datetime('now', '-1 hours'))`
    ).run('fc_mixed', url, 'https://cdn.example.com/feed-old.mp4')
    testDb.prepare(
      `INSERT INTO homepage_cache (id, category_key, url, stream_url, stream_url_expires_at)
       VALUES (?, ?, ?, ?, datetime('now', '+1 hours'))`
    ).run('hp_mixed', 'social_trending', url, 'https://cdn.example.com/hp-fresh.mp4')

    const app = await buildApp()
    const r = await callApp(app, 'GET', '/api/stream-url?url=' + encodeURIComponent(url))
    expect(r.status).toBe(200)
    expect(r.body.streamUrl).toBe('https://cdn.example.com/hp-fresh.mp4')
    expect(mockGetStreamUrl).not.toHaveBeenCalled()
  })

  it('writes the resolved URL into homepage_cache when a row exists for that URL', async () => {
    const url = 'https://www.youtube.com/watch?v=fresh'
    testDb.prepare(
      `INSERT INTO homepage_cache (id, category_key, url) VALUES (?, ?, ?)`
    ).run('hp_fresh', 'social_trending', url)

    const app = await buildApp()
    await callApp(app, 'GET', '/api/stream-url?url=' + encodeURIComponent(url))

    const row = testDb.prepare(
      'SELECT stream_url, stream_url_expires_at FROM homepage_cache WHERE id = ?'
    ).get('hp_fresh')
    expect(row.stream_url).toBe('https://cdn.example.com/resolved.mp4')
    expect(row.stream_url_expires_at).not.toBeNull()
  })

  it('refreshes all homepage_cache rows that share the same URL across categories', async () => {
    const url = 'https://www.youtube.com/watch?v=multi'
    testDb.prepare(
      `INSERT INTO homepage_cache (id, category_key, url) VALUES (?, ?, ?)`
    ).run('hp_multi_a', 'social_trending', url)
    testDb.prepare(
      `INSERT INTO homepage_cache (id, category_key, url) VALUES (?, ?, ?)`
    ).run('hp_multi_b', 'social_viral', url)

    const app = await buildApp()
    await callApp(app, 'GET', '/api/stream-url?url=' + encodeURIComponent(url))

    const rows = testDb.prepare(
      'SELECT id, stream_url FROM homepage_cache WHERE url = ?'
    ).all(url)
    expect(rows).toHaveLength(2)
    for (const r of rows) {
      expect(r.stream_url).toBe('https://cdn.example.com/resolved.mp4')
    }
  })

  it('skips the cache lookup when ?format= is provided (forces fresh resolve)', async () => {
    const url = 'https://www.youtube.com/watch?v=fmt'
    testDb.prepare(
      `INSERT INTO homepage_cache (id, category_key, url, stream_url, stream_url_expires_at)
       VALUES (?, ?, ?, ?, datetime('now', '+1 hours'))`
    ).run('hp_fmt', 'social_trending', url, 'https://cdn.example.com/cached.mp4')

    const app = await buildApp()
    const r = await callApp(app, 'GET',
      '/api/stream-url?url=' + encodeURIComponent(url) + '&format=137')
    expect(r.status).toBe(200)
    expect(r.body.streamUrl).toBe('https://cdn.example.com/resolved.mp4')
    expect(mockGetStreamUrl).toHaveBeenCalledOnce()
  })
})
