import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import express from 'express'

// ============================================================
// library route error-contract tests (Discovered 2026-05-06).
//
// GET /api/videos[/favorites|/watch-later] previously returned
// `{videos: []}` with status 200 even on real DB errors, conflating
// "empty" with "failed". Clients couldn't tell them apart and
// libraryStore.loadFromServer would silently keep stale cross-mode
// rows. New contract: 5xx on real failures, 200 on actual empty.
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
  `)
  return db
}

async function buildApp() {
  vi.resetModules()
  const { default: libraryRouter } = await import('../routes/library.js')
  const app = express()
  app.use(libraryRouter)
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

beforeEach(() => {
  testDb = makeDb()
})

describe('GET /api/videos error contract', () => {
  it('returns 200 with empty array when no rows match (true empty)', async () => {
    const app = await buildApp()
    const r = await callApp(app, 'GET', '/api/videos?mode=social')
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ videos: [] })
  })

  it('returns 200 with the matching row when one exists', async () => {
    testDb.prepare(
      'INSERT INTO videos (id, url, title, mode, source) VALUES (?, ?, ?, ?, ?)'
    ).run('v1', 'https://youtube.com/x', 'Hi', 'social', 'youtube')
    const app = await buildApp()
    const r = await callApp(app, 'GET', '/api/videos?mode=social')
    expect(r.status).toBe(200)
    expect(r.body.videos).toHaveLength(1)
    expect(r.body.videos[0].id).toBe('v1')
  })

  it('returns 5xx (NOT 200) when the DB read throws', async () => {
    testDb.exec('DROP TABLE videos')
    const app = await buildApp()
    const r = await callApp(app, 'GET', '/api/videos?mode=social')
    expect(r.status).toBe(500)
    expect(r.body).toMatchObject({ error: expect.stringMatching(/load videos/i) })
  })
})

describe('GET /api/videos/favorites error contract', () => {
  it('returns 200 with empty array on no matching rows', async () => {
    const app = await buildApp()
    const r = await callApp(app, 'GET', '/api/videos/favorites?mode=social')
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ videos: [] })
  })

  it('returns 5xx when the DB read throws', async () => {
    testDb.exec('DROP TABLE videos')
    const app = await buildApp()
    const r = await callApp(app, 'GET', '/api/videos/favorites?mode=social')
    expect(r.status).toBe(500)
    expect(r.body).toMatchObject({ error: expect.stringMatching(/favorites/i) })
  })
})

describe('GET /api/videos/watch-later error contract', () => {
  it('returns 200 with empty array on no matching rows', async () => {
    const app = await buildApp()
    const r = await callApp(app, 'GET', '/api/videos/watch-later?mode=social')
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ videos: [] })
  })

  it('returns 5xx when the DB read throws', async () => {
    testDb.exec('DROP TABLE videos')
    const app = await buildApp()
    const r = await callApp(app, 'GET', '/api/videos/watch-later?mode=social')
    expect(r.status).toBe(500)
    expect(r.body).toMatchObject({ error: expect.stringMatching(/watch later/i) })
  })
})
