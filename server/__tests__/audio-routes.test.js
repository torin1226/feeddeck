import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import express from 'express'
import { Readable } from 'node:stream'

// ============================================================
// /api/audio/* route tests (2026-05-16 cycle-2 audit)
//
// Audio surface shipped 2026-05-15 with zero tests. This file
// covers the four mutation routes + feed read + stats:
//
//   GET  /api/audio/feed         filter by rated/creator/source/q
//   POST /api/audio/:id/rate     400 on bad rating; updates
//                                audio_cache.rated, video_ratings,
//                                taste_profile, creator_boosts
//   POST /api/audio/:id/play     404 on unknown; updates played_at
//   POST /api/audio/:id/complete 404 on unknown; sets watched=1
//   GET  /api/audio/stats        creator + source aggregates
//
// Schema mirrors production audio_cache. The recompute call is
// mocked so we don't pull in scoring.js's heavy audio profile path.
// ============================================================

let testDb
const recomputeSpy = vi.fn()
const invalidateSpy = vi.fn()

vi.mock('../database.js', () => ({ get db() { return testDb } }))
vi.mock('../logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))
vi.mock('../scoring.js', () => ({
  recomputeAudioScores: (creator) => { recomputeSpy(creator); return 1 },
  invalidateAudioProfileCache: () => invalidateSpy(),
}))

function makeDb() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE audio_cache (
      id TEXT PRIMARY KEY,
      source_domain TEXT,
      url TEXT NOT NULL UNIQUE,
      audio_url TEXT,
      title TEXT NOT NULL,
      creator TEXT,
      creator_handle TEXT,
      tags TEXT DEFAULT '[]',
      duration_sec INTEGER,
      length_label TEXT,
      fetched_at DATETIME DEFAULT (datetime('now')),
      played_at DATETIME,
      watched INTEGER DEFAULT 0,
      rated INTEGER DEFAULT 0,
      taste_score REAL DEFAULT 0.0
    );
    CREATE TABLE video_ratings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_url TEXT,
      surface_type TEXT,
      surface_key TEXT,
      rating TEXT,
      tags TEXT,
      creator TEXT,
      title TEXT,
      mode TEXT,
      rated_at DATETIME
    );
    CREATE TABLE taste_profile (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      signal_type TEXT,
      signal_value TEXT,
      weight REAL,
      surface_key TEXT,
      mode TEXT,
      updated_at DATETIME
    );
    CREATE TABLE creator_boosts (
      creator TEXT PRIMARY KEY,
      boost_score REAL DEFAULT 0,
      surface_boosts TEXT DEFAULT '{}',
      last_updated DATETIME
    );
  `)
  return db
}

function seedAudio(db, rows) {
  const stmt = db.prepare(
    `INSERT INTO audio_cache
     (id, source_domain, url, audio_url, title, creator, creator_handle, tags,
      duration_sec, length_label, watched, rated, taste_score)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (const r of rows) {
    stmt.run(
      r.id,
      r.source_domain ?? 'soundgasm.net',
      r.url ?? `https://soundgasm.net/u/x/${r.id}`,
      r.audio_url ?? `https://media/${r.id}.m4a`,
      r.title ?? r.id,
      r.creator ?? 'alice',
      r.creator_handle ?? null,
      r.tags ?? '[]',
      r.duration_sec ?? null,
      r.length_label ?? null,
      r.watched ?? 0,
      r.rated ?? 0,
      r.taste_score ?? 0,
    )
  }
}

async function buildApp() {
  vi.resetModules()
  const { default: audioRouter } = await import('../routes/audio.js')
  const app = express()
  app.use(audioRouter)
  return app
}

function callApp(app, method, url, body) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL('http://x' + url)
    const bodyStr = body !== undefined ? JSON.stringify(body) : null

    // express.json() drives raw-body which expects a proper Readable.
    // Build one with our payload + drop request metadata on top so the
    // route handler also sees method/url/headers as if it were a real
    // IncomingMessage.
    const req = bodyStr ? Readable.from([bodyStr]) : Readable.from([])
    req.method = method
    req.url = url
    req.headers = bodyStr
      ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(bodyStr)) }
      : {}
    req.query = Object.fromEntries(parsedUrl.searchParams)
    req.params = {}
    req.path = parsedUrl.pathname
    req.socket = { destroy() {} }

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
  recomputeSpy.mockClear()
  invalidateSpy.mockClear()
})

describe('GET /api/audio/feed', () => {
  it('returns audio items ordered by taste_score DESC', async () => {
    seedAudio(testDb, [
      { id: 'a1', taste_score: 0.5 },
      { id: 'a2', taste_score: 0.9 },
      { id: 'a3', taste_score: 0.1 },
    ])
    const app = await buildApp()
    const r = await callApp(app, 'GET', '/api/audio/feed')
    expect(r.status).toBe(200)
    expect(r.body.items.map(i => i.id)).toEqual(['a2', 'a1', 'a3'])
  })

  it('excludes rated-down items (rated = -1)', async () => {
    seedAudio(testDb, [
      { id: 'a1', rated: 0 },
      { id: 'a2', rated: -1 },
      { id: 'a3', rated: 1 },
    ])
    const app = await buildApp()
    const r = await callApp(app, 'GET', '/api/audio/feed')
    const ids = r.body.items.map(i => i.id)
    expect(ids).toContain('a1')
    expect(ids).toContain('a3')
    expect(ids).not.toContain('a2')
  })

  it('filters by creator', async () => {
    seedAudio(testDb, [
      { id: 'a1', creator: 'alice' },
      { id: 'a2', creator: 'bob' },
    ])
    const app = await buildApp()
    const r = await callApp(app, 'GET', '/api/audio/feed?creator=alice')
    expect(r.body.items.map(i => i.id)).toEqual(['a1'])
  })

  it('filters by source_domain', async () => {
    seedAudio(testDb, [
      { id: 'a1', source_domain: 'soundgasm.net' },
      { id: 'a2', source_domain: 'reddit.com' },
    ])
    const app = await buildApp()
    const r = await callApp(app, 'GET', '/api/audio/feed?source=reddit.com')
    expect(r.body.items.map(i => i.id)).toEqual(['a2'])
  })

  it('free-text q matches title, creator, OR tags (case-insensitive)', async () => {
    seedAudio(testDb, [
      { id: 'a1', title: 'Morning Coffee', tags: '["soft","aspr"]' },
      { id: 'a2', title: 'Late Night', creator: 'CoffeeShop', tags: '[]' },
      { id: 'a3', title: 'Unrelated', tags: '["x"]' },
    ])
    const app = await buildApp()
    const r = await callApp(app, 'GET', '/api/audio/feed?q=COFFEE')
    const ids = r.body.items.map(i => i.id).sort()
    expect(ids).toEqual(['a1', 'a2'])
  })

  it('parses tags JSON into an array on the response', async () => {
    seedAudio(testDb, [{ id: 'a1', tags: '["foo","bar"]' }])
    const app = await buildApp()
    const r = await callApp(app, 'GET', '/api/audio/feed')
    expect(r.body.items[0].tags).toEqual(['foo', 'bar'])
  })

  it('survives malformed tags JSON by returning []', async () => {
    seedAudio(testDb, [{ id: 'a1', tags: 'not json {' }])
    const app = await buildApp()
    const r = await callApp(app, 'GET', '/api/audio/feed')
    expect(r.body.items[0].tags).toEqual([])
  })

  it('respects limit + offset', async () => {
    seedAudio(testDb, [
      { id: 'a1', taste_score: 0.9 },
      { id: 'a2', taste_score: 0.8 },
      { id: 'a3', taste_score: 0.7 },
      { id: 'a4', taste_score: 0.6 },
    ])
    const app = await buildApp()
    const r = await callApp(app, 'GET', '/api/audio/feed?limit=2&offset=1')
    expect(r.body.items.map(i => i.id)).toEqual(['a2', 'a3'])
  })
})

describe('POST /api/audio/:id/rate', () => {
  it('returns 400 when rating is not up or down', async () => {
    seedAudio(testDb, [{ id: 'a1' }])
    const app = await buildApp()
    const r = await callApp(app, 'POST', '/api/audio/a1/rate', { rating: 'sideways' })
    expect(r.status).toBe(400)
  })

  it('returns 404 when audio id does not exist', async () => {
    const app = await buildApp()
    const r = await callApp(app, 'POST', '/api/audio/nope/rate', { rating: 'up' })
    expect(r.status).toBe(404)
  })

  it('marks audio_cache.rated = 1 on up-vote and writes video_ratings row', async () => {
    seedAudio(testDb, [{ id: 'a1', tags: '["asmr"]', creator: 'alice' }])
    const app = await buildApp()
    const r = await callApp(app, 'POST', '/api/audio/a1/rate', { rating: 'up' })
    expect(r.status).toBe(200)
    const row = testDb.prepare('SELECT rated FROM audio_cache WHERE id = ?').get('a1')
    expect(row.rated).toBe(1)
    const rating = testDb.prepare('SELECT rating, surface_type, mode FROM video_ratings WHERE creator = ?').get('alice')
    expect(rating.rating).toBe('up')
    expect(rating.surface_type).toBe('audio')
    expect(rating.mode).toBe('nsfw')
  })

  it('marks audio_cache.rated = -1 on down-vote', async () => {
    seedAudio(testDb, [{ id: 'a1', creator: 'alice' }])
    const app = await buildApp()
    await callApp(app, 'POST', '/api/audio/a1/rate', { rating: 'down' })
    const row = testDb.prepare('SELECT rated FROM audio_cache WHERE id = ?').get('a1')
    expect(row.rated).toBe(-1)
  })

  it('inserts per-tag taste_profile rows scoped to audio + nsfw', async () => {
    seedAudio(testDb, [{ id: 'a1', tags: '["soft","aspr"]', creator: 'alice' }])
    const app = await buildApp()
    await callApp(app, 'POST', '/api/audio/a1/rate', { rating: 'up' })
    const tagRows = testDb.prepare(
      `SELECT signal_value, weight FROM taste_profile
       WHERE signal_type = 'tag' AND surface_key = 'audio' AND mode = 'nsfw'`
    ).all()
    expect(tagRows.map(r => r.signal_value).sort()).toEqual(['aspr', 'soft'])
    expect(tagRows.every(r => r.weight === 0.3)).toBe(true)
  })

  it('accumulates tag weight on repeat up-votes (clamped at 1.0)', async () => {
    seedAudio(testDb, [
      { id: 'a1', tags: '["soft"]', creator: 'alice' },
      { id: 'a2', tags: '["soft"]', creator: 'bob', url: 'https://x/a2' },
      { id: 'a3', tags: '["soft"]', creator: 'carol', url: 'https://x/a3' },
      { id: 'a4', tags: '["soft"]', creator: 'dave', url: 'https://x/a4' },
    ])
    const app = await buildApp()
    await callApp(app, 'POST', '/api/audio/a1/rate', { rating: 'up' })
    await callApp(app, 'POST', '/api/audio/a2/rate', { rating: 'up' })
    await callApp(app, 'POST', '/api/audio/a3/rate', { rating: 'up' })
    await callApp(app, 'POST', '/api/audio/a4/rate', { rating: 'up' }) // 1.2 → clamped 1.0
    const row = testDb.prepare(
      `SELECT weight FROM taste_profile
       WHERE signal_type = 'tag' AND signal_value = 'soft'
         AND surface_key = 'audio' AND mode = 'nsfw'`
    ).get()
    expect(row.weight).toBe(1.0)
  })

  it('writes creator_boosts.surface_boosts.audio cumulatively', async () => {
    seedAudio(testDb, [
      { id: 'a1', creator: 'alice' },
      { id: 'a2', creator: 'alice', url: 'https://x/a2' },
    ])
    const app = await buildApp()
    await callApp(app, 'POST', '/api/audio/a1/rate', { rating: 'up' })
    await callApp(app, 'POST', '/api/audio/a2/rate', { rating: 'up' })
    const boost = testDb.prepare('SELECT surface_boosts FROM creator_boosts WHERE creator = ?').get('alice')
    const sb = JSON.parse(boost.surface_boosts)
    expect(sb.audio).toBeCloseTo(0.5)
  })

  it('triggers profile-cache invalidate + recompute after commit', async () => {
    seedAudio(testDb, [{ id: 'a1', creator: 'alice' }])
    const app = await buildApp()
    await callApp(app, 'POST', '/api/audio/a1/rate', { rating: 'up' })
    expect(invalidateSpy).toHaveBeenCalled()
    expect(recomputeSpy).toHaveBeenCalledWith('alice')
  })
})

describe('POST /api/audio/:id/play', () => {
  it('sets played_at to now', async () => {
    seedAudio(testDb, [{ id: 'a1' }])
    const app = await buildApp()
    const r = await callApp(app, 'POST', '/api/audio/a1/play', {})
    expect(r.status).toBe(200)
    const row = testDb.prepare('SELECT played_at FROM audio_cache WHERE id = ?').get('a1')
    expect(row.played_at).not.toBeNull()
  })

  it('returns 404 for unknown id', async () => {
    const app = await buildApp()
    const r = await callApp(app, 'POST', '/api/audio/nope/play', {})
    expect(r.status).toBe(404)
  })
})

describe('POST /api/audio/:id/complete', () => {
  it('sets watched = 1', async () => {
    seedAudio(testDb, [{ id: 'a1', watched: 0 }])
    const app = await buildApp()
    const r = await callApp(app, 'POST', '/api/audio/a1/complete', {})
    expect(r.status).toBe(200)
    const row = testDb.prepare('SELECT watched FROM audio_cache WHERE id = ?').get('a1')
    expect(row.watched).toBe(1)
  })

  it('returns 404 for unknown id', async () => {
    const app = await buildApp()
    const r = await callApp(app, 'POST', '/api/audio/nope/complete', {})
    expect(r.status).toBe(404)
  })
})

describe('GET /api/audio/stats', () => {
  it('returns total + unrated counts + byCreator + bySource', async () => {
    seedAudio(testDb, [
      { id: 'a1', creator: 'alice', source_domain: 'soundgasm.net', rated: 0 },
      { id: 'a2', creator: 'alice', source_domain: 'soundgasm.net', rated: 1, url: 'https://x/a2' },
      { id: 'a3', creator: 'bob', source_domain: 'reddit.com', rated: 0, url: 'https://x/a3' },
      { id: 'a4', creator: 'bob', source_domain: 'reddit.com', rated: -1, url: 'https://x/a4' },
    ])
    const app = await buildApp()
    const r = await callApp(app, 'GET', '/api/audio/stats')
    expect(r.status).toBe(200)
    expect(r.body.total).toBe(4)
    expect(r.body.unrated).toBe(2)
    const creators = Object.fromEntries(r.body.byCreator.map(c => [c.creator, c.n]))
    expect(creators.alice).toBe(2)
    expect(creators.bob).toBe(1)
    const sources = Object.fromEntries(r.body.bySource.map(s => [s.source_domain, s.n]))
    expect(sources['soundgasm.net']).toBe(2)
    expect(sources['reddit.com']).toBe(1)
  })
})
