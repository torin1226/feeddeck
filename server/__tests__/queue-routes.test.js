import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import express from 'express'

// ============================================================
// Queue route tests — exercises every CRUD path against an
// in-memory SQLite. Specifically locks down:
//
//  * DELETE /api/queue (clear all for a mode) returns 200, not 500
//    Ref: Discovered Tasks "queueStore audit" (2026-04-26)
//  * Per-item DELETE /api/queue/:id reindexes positions
//  * Mode firewall: clearing one mode doesn't touch the other
// ============================================================

let testDb

vi.mock('../database.js', () => ({ get db() { return testDb } }))
vi.mock('../logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

function makeDb() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
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
    CREATE TABLE feed_cache (
      id TEXT PRIMARY KEY,
      mode TEXT,
      watched INTEGER DEFAULT 0,
      url TEXT,
      stream_url TEXT,
      title TEXT,
      creator TEXT,
      thumbnail TEXT,
      duration INTEGER,
      orientation TEXT,
      source_domain TEXT,
      tags TEXT,
      upload_date INTEGER,
      like_count INTEGER,
      view_count INTEGER,
      subscriber_count INTEGER
    );
    CREATE TABLE sources (
      domain TEXT PRIMARY KEY,
      mode TEXT,
      label TEXT,
      weight REAL,
      active INTEGER,
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
      active INTEGER
    );
  `)
  return db
}

function seedQueue(db, rows) {
  const stmt = db.prepare(
    `INSERT INTO queue (id, position, video_url, title, thumbnail, duration, duration_formatted, mode)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (const r of rows) {
    stmt.run(r.id, r.position, r.video_url, r.title || '', r.thumbnail || '', r.duration || 0, r.duration_formatted || '0:00', r.mode)
  }
}

async function buildApp() {
  // Reset module cache so the router's _stmts cache rebinds against
  // the per-test in-memory DB. Without this, prepared statements stay
  // bound to whichever testDb was current at first import.
  vi.resetModules()
  const { default: feedRouter } = await import('../routes/feed.js')
  const app = express()
  app.use(feedRouter)
  return app
}

// Tiny fetch-like helper that drives the express app via an
// in-memory request stream. Avoids pulling in supertest as a dep.
function callApp(app, method, url, body) {
  return new Promise((resolve, reject) => {
    const req = {
      method,
      url,
      headers: body ? { 'content-type': 'application/json' } : {},
      query: Object.fromEntries(new URL('http://x' + url).searchParams),
      params: {},
      body: undefined,
      path: url.split('?')[0],
      on(event, cb) {
        if (event === 'data' && body) cb(Buffer.from(JSON.stringify(body)))
        if (event === 'end') queueMicrotask(cb)
      },
      pipe() {},
      socket: { destroy() {} },
    }
    let statusCode = 200
    let payload = null
    const res = {
      statusCode,
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

describe('DELETE /api/queue (clear all for mode)', () => {
  it('returns 200 with empty queue when called with ?mode=social', async () => {
    seedQueue(testDb, [
      { id: 'a1', position: 0, video_url: 'https://youtube.com/x', mode: 'social' },
      { id: 'a2', position: 1, video_url: 'https://youtube.com/y', mode: 'social' },
    ])
    const app = await buildApp()
    const r = await callApp(app, 'DELETE', '/api/queue?mode=social')
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ queue: [] })
  })

  it('does not delete the other mode\'s items', async () => {
    seedQueue(testDb, [
      { id: 's1', position: 0, video_url: 'https://youtube.com/x', mode: 'social' },
      { id: 'n1', position: 0, video_url: 'https://pornhub.com/y', mode: 'nsfw' },
    ])
    const app = await buildApp()
    const r = await callApp(app, 'DELETE', '/api/queue?mode=social')
    expect(r.status).toBe(200)
    const survivors = testDb.prepare('SELECT id, mode FROM queue').all()
    expect(survivors).toHaveLength(1)
    expect(survivors[0]).toMatchObject({ id: 'n1', mode: 'nsfw' })
  })

  it('returns 200 even on an empty queue (idempotent)', async () => {
    const app = await buildApp()
    const r = await callApp(app, 'DELETE', '/api/queue?mode=nsfw')
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ queue: [] })
  })
})

describe('DELETE /api/queue/:id (single item)', () => {
  it('removes the matching id and reindexes survivors', async () => {
    seedQueue(testDb, [
      { id: 'a', position: 0, video_url: 'https://youtube.com/1', mode: 'social' },
      { id: 'b', position: 1, video_url: 'https://youtube.com/2', mode: 'social' },
      { id: 'c', position: 2, video_url: 'https://youtube.com/3', mode: 'social' },
    ])
    const app = await buildApp()
    const r = await callApp(app, 'DELETE', '/api/queue/b?mode=social')
    expect(r.status).toBe(200)
    const remaining = testDb
      .prepare('SELECT id, position FROM queue WHERE mode = ? ORDER BY position')
      .all('social')
    expect(remaining).toEqual([
      { id: 'a', position: 0 },
      { id: 'c', position: 1 },
    ])
  })
})

describe('GET /api/queue', () => {
  it('returns only items for the requested mode', async () => {
    seedQueue(testDb, [
      { id: 's1', position: 0, video_url: 'https://youtube.com/x', mode: 'social', title: 'social-only' },
      { id: 'n1', position: 0, video_url: 'https://pornhub.com/y', mode: 'nsfw', title: 'nsfw-only' },
    ])
    const app = await buildApp()
    const r = await callApp(app, 'GET', '/api/queue?mode=social')
    expect(r.status).toBe(200)
    expect(r.body.queue).toHaveLength(1)
    expect(r.body.queue[0].id).toBe('s1')
  })
})
