import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import express from 'express'
import { ROUTE_SHAPES, assertResponseShape } from '../schemas/route-shapes.js'

// ============================================================
// Route-shape contract tests (Discovered 2026-05-14, variant b).
//
// Companion to the runtime mode-leak recorder shipped 2026-05-14
// in commit ab7422b (variant a). Variant a catches *missing mode*
// at request time; this catches *response shape drift* at test time.
//
// Originating bug: 07a9e52 — homeStore parsed /api/tags/preferences
// as { liked, disliked } but the server returned { preferences: [...] }.
// 19 days of silent dead code because no contract caught the drift.
//
// Coverage: the 6 read routes that follow the simple
// `{singular: rows[]}` pattern. Every entry in ROUTE_SHAPES gets a
// positive test against a real in-memory boot of the router. One
// negative test proves the contract assertion actually fails on a
// deliberately-malformed payload.
// ============================================================

let testDb

vi.mock('../database.js', () => ({ get db() { return testDb } }))
vi.mock('../logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

function makeDb() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE videos (
      id TEXT PRIMARY KEY,
      url TEXT,
      title TEXT,
      thumbnail TEXT,
      duration INTEGER,
      tags TEXT,
      source TEXT,
      mode TEXT,
      added_at DATETIME DEFAULT (datetime('now')),
      last_watched DATETIME,
      watch_count INTEGER DEFAULT 0,
      rating INTEGER,
      favorite INTEGER DEFAULT 0,
      watch_later INTEGER DEFAULT 0,
      views TEXT,
      channel TEXT
    );
    CREATE TABLE tag_preferences (
      tag TEXT PRIMARY KEY,
      preference TEXT,
      mode TEXT,
      updated_at DATETIME DEFAULT (datetime('now'))
    );
    CREATE TABLE video_ratings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_url TEXT,
      rating TEXT,
      mode TEXT,
      rated_at DATETIME DEFAULT (datetime('now'))
    );
    CREATE TABLE taste_profile (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      signal_type TEXT,
      signal_value TEXT,
      weight REAL,
      surface_key TEXT,
      mode TEXT,
      updated_at DATETIME DEFAULT (datetime('now'))
    );
  `)
  return db
}

async function buildApp(routerPath) {
  vi.resetModules()
  const { default: router } = await import(routerPath)
  const app = express()
  app.use(router)
  return app
}

function callApp(app, method, url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL('http://x' + url)
    const req = {
      method,
      url,
      headers: {},
      query: Object.fromEntries(parsed.searchParams),
      params: {},
      path: parsed.pathname,
      on(event, cb) { if (event === 'end') queueMicrotask(cb) },
      pipe() {},
      socket: { destroy() {} },
      get() { return undefined },
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

beforeEach(() => {
  testDb = makeDb()
})

// ROUTES drives the per-route positive tests. Each entry needs the route's
// HTTP method + path (must match a ROUTE_SHAPES key) and the router module
// it lives in.
const ROUTES = [
  { method: 'GET', path: '/api/tags/preferences', router: '../routes/recommendations.js' },
  { method: 'GET', path: '/api/tags/popular', router: '../routes/recommendations.js' },
  { method: 'GET', path: '/api/ratings/history', router: '../routes/ratings.js' },
  { method: 'GET', path: '/api/videos', router: '../routes/library.js' },
  { method: 'GET', path: '/api/videos/favorites', router: '../routes/library.js' },
  { method: 'GET', path: '/api/videos/watch-later', router: '../routes/library.js' },
]

describe('manifest coverage', () => {
  it('every ROUTE_SHAPES key has a corresponding ROUTES entry', () => {
    const manifestKeys = Object.keys(ROUTE_SHAPES).sort()
    const routeKeys = ROUTES.map(r => `${r.method} ${r.path}`).sort()
    expect(routeKeys).toEqual(manifestKeys)
  })
})

describe('per-route shape contract (positive)', () => {
  for (const r of ROUTES) {
    it(`${r.method} ${r.path} returns the manifest shape on empty DB`, async () => {
      const app = await buildApp(r.router)
      const result = await callApp(app, r.method, `${r.path}?mode=social`)
      expect(result.status).toBe(200)
      expect(() =>
        assertResponseShape(r.method, r.path, result.body)
      ).not.toThrow()
    })
  }
})

describe('per-route shape contract (with seeded data)', () => {
  it('GET /api/tags/preferences returns { preferences } when rows exist', async () => {
    testDb.prepare(
      'INSERT INTO tag_preferences (tag, preference, mode) VALUES (?, ?, ?)'
    ).run('cooking', 'liked', 'social')
    const app = await buildApp('../routes/recommendations.js')
    const r = await callApp(app, 'GET', '/api/tags/preferences?mode=social')
    expect(r.status).toBe(200)
    expect(() =>
      assertResponseShape('GET', '/api/tags/preferences', r.body)
    ).not.toThrow()
    expect(r.body.preferences).toHaveLength(1)
    expect(r.body.preferences[0]).toMatchObject({ tag: 'cooking', preference: 'liked' })
  })

  it('GET /api/videos returns { videos } when rows exist', async () => {
    testDb.prepare(
      'INSERT INTO videos (id, url, title, mode, source) VALUES (?, ?, ?, ?, ?)'
    ).run('v1', 'https://youtube.com/x', 'Hi', 'social', 'youtube')
    const app = await buildApp('../routes/library.js')
    const r = await callApp(app, 'GET', '/api/videos?mode=social')
    expect(r.status).toBe(200)
    expect(() =>
      assertResponseShape('GET', '/api/videos', r.body)
    ).not.toThrow()
    expect(r.body.videos).toHaveLength(1)
  })
})

describe('assertResponseShape (negative)', () => {
  it('throws when actual response has the wrong key (the 07a9e52 bug shape)', () => {
    // Simulates the original silent-dead-code bug: server-side regression
    // changes response from { preferences } to { liked, disliked }.
    const malformed = { liked: ['cooking'], disliked: [] }
    expect(() =>
      assertResponseShape('GET', '/api/tags/preferences', malformed)
    ).toThrow(/Response shape drift on GET \/api\/tags\/preferences/)
  })

  it('throws when actual response is missing all expected keys', () => {
    expect(() =>
      assertResponseShape('GET', '/api/videos', {})
    ).toThrow(/Response shape drift/)
  })

  it('throws when actual response has extra keys not in the manifest', () => {
    expect(() =>
      assertResponseShape('GET', '/api/videos', { videos: [], extra: 1 })
    ).toThrow(/Response shape drift/)
  })

  it('throws on null body', () => {
    expect(() =>
      assertResponseShape('GET', '/api/videos', null)
    ).toThrow(/expected object/)
  })

  it('throws on array body (top-level array, not wrapped in object)', () => {
    expect(() =>
      assertResponseShape('GET', '/api/videos', [])
    ).toThrow(/expected object/)
  })

  it('throws on unknown route key', () => {
    expect(() =>
      assertResponseShape('GET', '/api/does-not-exist', { foo: 1 })
    ).toThrow(/No response-shape manifest/)
  })
})
