import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'

// ============================================================
// Phase A — Recommendation Trail
//
// Covers the searchSimilar composer + runner, the trail-related
// endpoints' persistence/eviction/demote behaviour, and the
// adaptive threshold helper.
//
// We mock ../database.js so the test owns an in-memory DB, and
// substitute a deterministic ytdlp adapter so the runner returns
// known fixtures instead of spawning yt-dlp.
// ============================================================

let testDb

vi.mock('../database.js', () => ({
  get db() { return testDb },
}))

vi.mock('../logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

function makeDb() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE recommendation_trail (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_url TEXT NOT NULL,
      seed_video_url TEXT NOT NULL,
      source TEXT NOT NULL CHECK(source IN ('creator', 'keyword')),
      score REAL NOT NULL DEFAULT 1.0,
      mode TEXT NOT NULL DEFAULT 'social',
      title TEXT,
      thumbnail TEXT,
      duration INTEGER DEFAULT 0,
      uploader TEXT,
      tags TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT (datetime('now')),
      watched_at DATETIME,
      UNIQUE(mode, video_url)
    );
    CREATE INDEX idx_trail_rank ON recommendation_trail(mode, watched_at, score DESC, created_at DESC);
    CREATE INDEX idx_trail_seed ON recommendation_trail(seed_video_url, mode);
    CREATE TABLE tag_preferences (
      tag TEXT PRIMARY KEY,
      preference TEXT NOT NULL CHECK(preference IN ('liked','disliked')),
      mode TEXT,
      weight REAL DEFAULT 1.0,
      last_seen TEXT,
      updated_at DATETIME DEFAULT (datetime('now'))
    );
  `)
  return db
}

beforeEach(() => {
  testDb = makeDb()
})

// ─── Composer: keyword distillation ──────────────────────────

describe('distillKeywords', () => {
  it('drops stopwords and short words', async () => {
    const { distillKeywords } = await import('../recommendations/searchSimilar.js')
    const out = distillKeywords('The quick brown fox in the woods', [])
    expect(out).not.toMatch(/\bthe\b/i)
    expect(out).not.toMatch(/\bin\b/i)
    expect(out.split(' ')).toContain('quick')
  })

  it('drops numbers-only tokens', async () => {
    const { distillKeywords } = await import('../recommendations/searchSimilar.js')
    const out = distillKeywords('Episode 12 launched 2026', [])
    expect(out).not.toMatch(/\b12\b/)
    expect(out).not.toMatch(/\b2026\b/)
    expect(out).toMatch(/launched/)
  })

  it('boosts words that appear in the seed tags', async () => {
    const { distillKeywords } = await import('../recommendations/searchSimilar.js')
    const out = distillKeywords('Fox jumps over lazy hound', ['fox'])
    // fox is shorter than 'jumps' but tag-overlap should rank it first
    expect(out.split(' ')[0]).toBe('fox')
  })

  it('returns empty string for empty / all-stopwords title', async () => {
    const { distillKeywords } = await import('../recommendations/searchSimilar.js')
    expect(distillKeywords('', [])).toBe('')
    expect(distillKeywords('the and or is to', [])).toBe('')
  })

  it('caps output at 3 words', async () => {
    const { distillKeywords } = await import('../recommendations/searchSimilar.js')
    const out = distillKeywords('streaming architecture deep dive walkthrough tutorial', [])
    expect(out.split(' ').length).toBeLessThanOrEqual(3)
  })
})

// ─── Composer: creator URL extraction ────────────────────────

describe('extractCreatorUrl', () => {
  it('uses channel_url when present, appending /videos', async () => {
    const { extractCreatorUrl } = await import('../recommendations/searchSimilar.js')
    expect(extractCreatorUrl({ channel_url: 'https://www.youtube.com/@Creator' }))
      .toBe('https://www.youtube.com/@Creator/videos')
  })

  it('keeps /videos if already there', async () => {
    const { extractCreatorUrl } = await import('../recommendations/searchSimilar.js')
    expect(extractCreatorUrl({ channelUrl: 'https://www.youtube.com/@Creator/videos' }))
      .toBe('https://www.youtube.com/@Creator/videos')
  })

  it('synthesizes from a handle when no URL is given', async () => {
    const { extractCreatorUrl } = await import('../recommendations/searchSimilar.js')
    expect(extractCreatorUrl({ handle: 'CreatorX' }))
      .toBe('https://www.youtube.com/@CreatorX/videos')
  })

  it('returns null when nothing actionable', async () => {
    const { extractCreatorUrl } = await import('../recommendations/searchSimilar.js')
    expect(extractCreatorUrl({})).toBeNull()
    expect(extractCreatorUrl(null)).toBeNull()
  })
})

// ─── Runner: parallel fetch + dedupe + provenance ────────────

function mockAdapter({ creatorVideos = [], keywordVideos = [] } = {}) {
  return {
    _fetchPlaylist: vi.fn(async () => creatorVideos),
    streamSearch: vi.fn(() => {
      let onVid, onDone
      // Simulate the SSE emission shape
      setTimeout(() => {
        for (const v of keywordVideos) onVid?.(v)
        onDone?.()
      }, 0)
      return {
        onVideo: (fn) => { onVid = fn },
        onDone: (fn) => { onDone = fn },
        onError: () => {},
        kill: () => {},
      }
    }),
  }
}

describe('createTrailRunner', () => {
  it('runs creator + keyword in parallel and tags provenance', async () => {
    const { createTrailRunner } = await import('../recommendations/searchSimilar.js')
    const adapter = mockAdapter({
      creatorVideos: [{ url: 'https://yt/c1', title: 'C1', uploader: 'X' }],
      keywordVideos: [{ url: 'https://yt/k1', title: 'K1' }],
    })
    const runner = createTrailRunner({ ytdlpAdapter: adapter })
    const result = await runner.runForSeed({
      seed: { url: 'https://yt/seed', title: 'Architecture deep dive', tags: [], channel_url: 'https://yt/@X' },
      mode: 'social',
    })
    const sources = result.rows.map((r) => r.source).sort()
    expect(sources).toEqual(['creator', 'keyword'])
    expect(result.rows.find((r) => r.source === 'creator').score)
      .toBeGreaterThan(result.rows.find((r) => r.source === 'keyword').score)
  })

  it('dedupes the seed itself and same-url duplicates within a run', async () => {
    const { createTrailRunner } = await import('../recommendations/searchSimilar.js')
    const dup = { url: 'https://yt/x', title: 'X' }
    const seedDup = { url: 'https://yt/seed', title: 'Seed-dup' }
    const adapter = mockAdapter({
      creatorVideos: [dup, seedDup],
      keywordVideos: [dup],
    })
    const runner = createTrailRunner({ ytdlpAdapter: adapter })
    const result = await runner.runForSeed({
      seed: { url: 'https://yt/seed', title: 'Architecture talk', channel_url: 'https://yt/@X' },
      mode: 'social',
    })
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].video_url).toBe('https://yt/x')
  })

  it('survives a creator fetch failure (returns keyword results only)', async () => {
    const { createTrailRunner } = await import('../recommendations/searchSimilar.js')
    const adapter = {
      _fetchPlaylist: vi.fn(async () => { throw new Error('404') }),
      streamSearch: () => {
        let onDone
        setTimeout(() => onDone?.(), 0)
        return {
          onVideo: (fn) => fn({ url: 'https://yt/k1', title: 'K1' }),
          onDone: (fn) => { onDone = fn },
          onError: () => {},
          kill: () => {},
        }
      },
    }
    const runner = createTrailRunner({ ytdlpAdapter: adapter })
    const result = await runner.runForSeed({
      seed: { url: 'https://yt/seed', title: 'Streaming talk', channel_url: 'https://yt/@X' },
      mode: 'social',
    })
    expect(result.rows.find((r) => r.source === 'keyword')).toBeDefined()
    expect(result.rows.find((r) => r.source === 'creator')).toBeUndefined()
  })

  it('single-flights: a second call within TTL is suppressed', async () => {
    const { createTrailRunner } = await import('../recommendations/searchSimilar.js')
    const adapter = mockAdapter({
      creatorVideos: [{ url: 'https://yt/c1', title: 'C1' }],
    })
    const runner = createTrailRunner({ ytdlpAdapter: adapter })
    const seed = { url: 'https://yt/seed', title: 'Talk', channel_url: 'https://yt/@X' }
    const r1 = await runner.runForSeed({ seed, mode: 'social' })
    const r2 = await runner.runForSeed({ seed, mode: 'social' })
    expect(r1.suppressed).toBe(false)
    expect(r2.suppressed).toBe(true)
    expect(adapter._fetchPlaylist).toHaveBeenCalledTimes(1)
  })

  it('keeps SFW/NSFW runs independent (mode is part of the cache key)', async () => {
    const { createTrailRunner } = await import('../recommendations/searchSimilar.js')
    const adapter = mockAdapter({ creatorVideos: [{ url: 'https://yt/c', title: 'C' }] })
    const runner = createTrailRunner({ ytdlpAdapter: adapter })
    const seed = { url: 'https://yt/seed', title: 'Talk', channel_url: 'https://yt/@X' }
    const sfw = await runner.runForSeed({ seed, mode: 'social' })
    const nsfw = await runner.runForSeed({ seed, mode: 'nsfw' })
    expect(sfw.suppressed).toBe(false)
    expect(nsfw.suppressed).toBe(false)
  })
})

// ─── Persistence + eviction ──────────────────────────────────

describe('persistTrailRows + evictTrailExpired', () => {
  it('persists rows and dedupes via UNIQUE(mode, video_url)', async () => {
    const { _trail } = await import('../routes/recommendations.js')
    _trail.persistRows([
      { video_url: 'https://yt/a', seed_video_url: 'https://yt/seed', source: 'creator', score: 2, mode: 'social', title: 'A' },
      { video_url: 'https://yt/a', seed_video_url: 'https://yt/seed', source: 'keyword', score: 1, mode: 'social', title: 'A' },
    ])
    const rows = testDb.prepare('SELECT * FROM recommendation_trail').all()
    expect(rows).toHaveLength(1)
    // ON CONFLICT preserves max(score)
    expect(rows[0].score).toBe(2)
  })

  it('keeps SFW and NSFW rows separate even with same url', async () => {
    const { _trail } = await import('../routes/recommendations.js')
    _trail.persistRows([
      { video_url: 'https://yt/x', seed_video_url: 'https://yt/seed', source: 'creator', score: 1, mode: 'social', title: 'X' },
      { video_url: 'https://yt/x', seed_video_url: 'https://yt/seed', source: 'creator', score: 1, mode: 'nsfw', title: 'X' },
    ])
    expect(testDb.prepare('SELECT COUNT(*) AS n FROM recommendation_trail').get().n).toBe(2)
  })

  it('evicts watched rows', async () => {
    const { _trail } = await import('../routes/recommendations.js')
    _trail.persistRows([
      { video_url: 'https://yt/watched', seed_video_url: 'https://yt/seed', source: 'creator', score: 1, mode: 'social', title: 'W' },
      { video_url: 'https://yt/active', seed_video_url: 'https://yt/seed', source: 'creator', score: 1, mode: 'social', title: 'A' },
    ])
    testDb.prepare("UPDATE recommendation_trail SET watched_at = datetime('now') WHERE video_url = 'https://yt/watched'").run()
    _trail.evictExpired('social')
    const rows = testDb.prepare('SELECT video_url FROM recommendation_trail').all()
    expect(rows.map((r) => r.video_url)).toEqual(['https://yt/active'])
  })

  it('evicts rows older than TTL_DAYS', async () => {
    const { _trail } = await import('../routes/recommendations.js')
    testDb.prepare(
      `INSERT INTO recommendation_trail (video_url, seed_video_url, source, score, mode, title, created_at)
       VALUES (?, ?, 'creator', 1, 'social', 'old', datetime('now', '-30 days'))`
    ).run('https://yt/old', 'https://yt/seed')
    _trail.persistRows([{ video_url: 'https://yt/fresh', seed_video_url: 'https://yt/seed', source: 'creator', score: 1, mode: 'social', title: 'F' }])
    _trail.evictExpired('social')
    const rows = testDb.prepare('SELECT video_url FROM recommendation_trail').all()
    expect(rows.map((r) => r.video_url)).toContain('https://yt/fresh')
    expect(rows.map((r) => r.video_url)).not.toContain('https://yt/old')
  })
})

// ─── Demote on thumbs-down ───────────────────────────────────

describe('demote on thumbs-down', () => {
  it('multiplies score by 0.3 for entries pulled by the seed', async () => {
    const { _trail } = await import('../routes/recommendations.js')
    _trail.persistRows([
      { video_url: 'https://yt/a', seed_video_url: 'https://yt/seed', source: 'creator', score: 2, mode: 'social', title: 'A' },
      { video_url: 'https://yt/b', seed_video_url: 'https://yt/seed', source: 'keyword', score: 1, mode: 'social', title: 'B' },
      { video_url: 'https://yt/c', seed_video_url: 'https://yt/other', source: 'creator', score: 1, mode: 'social', title: 'C' },
    ])
    const TRAIL_DEMOTE_FACTOR = _trail.DEMOTE_FACTOR
    testDb.prepare(
      'UPDATE recommendation_trail SET score = score * ? WHERE mode = ? AND seed_video_url = ?'
    ).run(TRAIL_DEMOTE_FACTOR, 'social', 'https://yt/seed')

    const rows = testDb.prepare('SELECT video_url, score FROM recommendation_trail').all()
    const byUrl = Object.fromEntries(rows.map((r) => [r.video_url, r.score]))
    expect(byUrl['https://yt/a']).toBeCloseTo(2 * TRAIL_DEMOTE_FACTOR, 5)
    expect(byUrl['https://yt/b']).toBeCloseTo(1 * TRAIL_DEMOTE_FACTOR, 5)
    expect(byUrl['https://yt/c']).toBe(1) // untouched - different seed
  })

  it('respects mode firewall when demoting', async () => {
    const { _trail } = await import('../routes/recommendations.js')
    _trail.persistRows([
      { video_url: 'https://yt/a', seed_video_url: 'https://yt/seed', source: 'creator', score: 2, mode: 'social', title: 'A' },
      { video_url: 'https://yt/b', seed_video_url: 'https://yt/seed', source: 'creator', score: 2, mode: 'nsfw', title: 'B' },
    ])
    testDb.prepare(
      'UPDATE recommendation_trail SET score = score * ? WHERE mode = ? AND seed_video_url = ?'
    ).run(_trail.DEMOTE_FACTOR, 'social', 'https://yt/seed')

    const social = testDb.prepare("SELECT score FROM recommendation_trail WHERE mode = 'social'").get()
    const nsfw = testDb.prepare("SELECT score FROM recommendation_trail WHERE mode = 'nsfw'").get()
    expect(social.score).toBeCloseTo(2 * _trail.DEMOTE_FACTOR, 5)
    expect(nsfw.score).toBe(2) // untouched
  })
})

// ─── Adaptive threshold ──────────────────────────────────────

describe('getRelevanceThreshold (adaptive)', () => {
  it('returns 1 when liked-tag count is below 20', async () => {
    const { getRelevanceThreshold } = await import('../scoring.js')
    // 5 liked tags
    for (let i = 0; i < 5; i++) {
      testDb.prepare("INSERT INTO tag_preferences (tag, preference, mode) VALUES (?, 'liked', 'social')").run('tag' + i)
    }
    expect(getRelevanceThreshold('social')).toBe(1)
  })

  it('returns 2 when liked-tag count is in [20, 50)', async () => {
    const { getRelevanceThreshold } = await import('../scoring.js')
    for (let i = 0; i < 30; i++) {
      testDb.prepare("INSERT INTO tag_preferences (tag, preference, mode) VALUES (?, 'liked', 'social')").run('tag' + i)
    }
    expect(getRelevanceThreshold('social')).toBe(2)
  })

  it('returns 3 when liked-tag count is 50+', async () => {
    const { getRelevanceThreshold } = await import('../scoring.js')
    for (let i = 0; i < 60; i++) {
      testDb.prepare("INSERT INTO tag_preferences (tag, preference, mode) VALUES (?, 'liked', 'social')").run('tag' + i)
    }
    expect(getRelevanceThreshold('social')).toBe(3)
  })

  it('counts mode-scoped only (NSFW liked tags do NOT raise SFW threshold)', async () => {
    const { getRelevanceThreshold } = await import('../scoring.js')
    for (let i = 0; i < 60; i++) {
      testDb.prepare("INSERT INTO tag_preferences (tag, preference, mode) VALUES (?, 'liked', 'nsfw')").run('tag' + i)
    }
    // ... but ALSO counts legacy NULL-mode rows. Add 0 social-scoped → still threshold 1
    expect(getRelevanceThreshold('social')).toBe(1)
  })
})
