import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'

// ============================================================
// Phase 1 — dynamic taste model + mode-aware scoring tests
//
// Covers the multi-search topic pipeline plan items that land
// in this phase:
//
//   * Downvoted URLs are hard-excluded from scoreVideos output
//   * Liked tags from tag_preferences win over baseline
//   * Recency decay: an old liked tag scores less than a fresh one
//   * tag_associations co-occurrence lifts adjacent content
//   * NSFW likes-pool / subscribed-models bonuses fire
//
// We mock ../database.js so scoring.js binds to an in-memory DB
// per test, then import scoring.js after the mock takes effect.
// ============================================================

let testDb

vi.mock('../database.js', () => ({
  get db() { return testDb },
}))

vi.mock('../logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}))

function makeDb() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE taste_profile (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      signal_type TEXT NOT NULL,
      signal_value TEXT NOT NULL,
      weight REAL DEFAULT 0,
      surface_key TEXT,
      mode TEXT,
      updated_at DATETIME DEFAULT (datetime('now'))
    );
    CREATE TABLE tag_preferences (
      tag TEXT PRIMARY KEY,
      preference TEXT NOT NULL CHECK(preference IN ('liked','disliked')),
      mode TEXT,
      weight REAL DEFAULT 1.0,
      last_seen TEXT,
      updated_at DATETIME DEFAULT (datetime('now'))
    );
    CREATE TABLE tag_associations (
      tag_a TEXT NOT NULL,
      tag_b TEXT NOT NULL,
      co_occurrences INTEGER DEFAULT 1,
      last_seen DATETIME DEFAULT (datetime('now')),
      PRIMARY KEY (tag_a, tag_b)
    );
    CREATE TABLE creator_boosts (
      creator TEXT PRIMARY KEY,
      boost_score REAL DEFAULT 0,
      surface_boosts TEXT DEFAULT '{}',
      mode TEXT,
      last_updated DATETIME DEFAULT (datetime('now'))
    );
    CREATE TABLE video_ratings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_url TEXT NOT NULL,
      surface_type TEXT,
      surface_key TEXT,
      rating TEXT NOT NULL CHECK(rating IN ('up','down')),
      tags TEXT DEFAULT '[]',
      creator TEXT,
      mode TEXT,
      title TEXT,
      thumbnail TEXT,
      rated_at DATETIME DEFAULT (datetime('now'))
    );
    CREATE TABLE persistent_row_items (
      row_key TEXT NOT NULL,
      video_url TEXT NOT NULL,
      title TEXT,
      thumbnail TEXT,
      duration INTEGER DEFAULT 0,
      uploader TEXT,
      view_count INTEGER,
      like_count INTEGER,
      upload_date TEXT,
      liked_at DATETIME,
      added_at DATETIME DEFAULT (datetime('now')),
      tags TEXT DEFAULT '[]',
      PRIMARY KEY (row_key, video_url)
    );
    CREATE TABLE blocked_creators (
      creator TEXT NOT NULL,
      mode TEXT NOT NULL,
      action TEXT NOT NULL DEFAULT 'blocked',
      reviewed_at DATETIME DEFAULT (datetime('now')),
      PRIMARY KEY (creator, mode)
    );
  `)
  return db
}

async function importScoring() {
  // Re-import after mock + fresh DB so module-level cache state is fresh.
  vi.resetModules()
  return await import('../scoring.js')
}

const v = (overrides = {}) => ({
  url: 'https://example.com/v/' + Math.random().toString(36).slice(2),
  title: 'Sample',
  uploader: 'Generic Channel',
  view_count: 1000,
  like_count: 100,
  upload_date: new Date().toISOString().slice(0, 10),
  tags: '[]',
  ...overrides,
})

describe('Phase 1 dynamic taste model', () => {
  beforeEach(() => { testDb = makeDb() })

  it('scoreVideos hard-excludes downvoted URLs', async () => {
    const { scoreVideos } = await importScoring()
    const downUrl = 'https://example.com/v/down'
    testDb.prepare(
      `INSERT INTO video_ratings (video_url, rating, mode) VALUES (?, 'down', 'social')`
    ).run(downUrl)

    const videos = [
      v({ url: downUrl, title: 'I am downvoted' }),
      v({ url: 'https://example.com/v/keep', title: 'I am fine' }),
    ]
    const out = scoreVideos(videos, 'test', { mode: 'social' })
    expect(out.find(x => x.url === downUrl)).toBeUndefined()
    expect(out.find(x => x.url === 'https://example.com/v/keep')).toBeDefined()
  })

  it('scoreVideos hard-excludes blocked creators (mode-scoped)', async () => {
    const { scoreVideos } = await importScoring()
    testDb.prepare(
      `INSERT INTO blocked_creators (creator, mode, action) VALUES ('Spammer', 'social', 'blocked')`
    ).run()
    // Same creator name in nsfw — should NOT be blocked there
    const videos = [
      v({ url: 'https://example.com/v/blk', uploader: 'Spammer', title: 'block me' }),
      v({ url: 'https://example.com/v/ok', uploader: 'Friendly', title: 'keep me' }),
    ]
    const social = scoreVideos(videos, 'test', { mode: 'social' })
    expect(social.find(x => x.url === 'https://example.com/v/blk')).toBeUndefined()
    expect(social.find(x => x.url === 'https://example.com/v/ok')).toBeDefined()

    const nsfw = scoreVideos(videos, 'test', { mode: 'nsfw' })
    expect(nsfw.find(x => x.url === 'https://example.com/v/blk')).toBeDefined()
  })

  it('dismissed creators are NOT excluded from scoring', async () => {
    const { scoreVideos } = await importScoring()
    testDb.prepare(
      `INSERT INTO blocked_creators (creator, mode, action) VALUES ('Reviewed', 'social', 'dismissed')`
    ).run()
    const out = scoreVideos(
      [v({ url: 'https://example.com/v/dis', uploader: 'Reviewed' })],
      'test', { mode: 'social' }
    )
    expect(out.find(x => x.url === 'https://example.com/v/dis')).toBeDefined()
  })

  it('liked tag (fresh) outscores baseline video', async () => {
    const { scoreVideos } = await importScoring()
    testDb.prepare(
      `INSERT INTO tag_preferences (tag, preference, mode, weight, last_seen, updated_at)
       VALUES ('ai', 'liked', 'social', 1.0, datetime('now'), datetime('now'))`
    ).run()

    const liked   = v({ tags: JSON.stringify(['ai', 'tutorial']) })
    const neutral = v({ tags: JSON.stringify(['cars']) })
    const out = scoreVideos([neutral, liked], 'test', { mode: 'social' })
    expect(out[0].url).toBe(liked.url)
    expect(out[0]._score).toBeGreaterThan(out[1]._score)
  })

  it('disliked tag from tag_preferences penalises (was orphaned before)', async () => {
    const { scoreVideos } = await importScoring()
    testDb.prepare(
      `INSERT INTO tag_preferences (tag, preference, mode, weight, last_seen, updated_at)
       VALUES ('viral', 'disliked', 'social', 1.0, datetime('now'), datetime('now'))`
    ).run()

    const viral   = v({ tags: JSON.stringify(['viral']) })
    const neutral = v({ tags: JSON.stringify(['cars']) })
    const out = scoreVideos([viral, neutral], 'test', { mode: 'social' })
    expect(out[0].url).toBe(neutral.url)
    expect(out[0]._score).toBeGreaterThan(out[1]._score)
  })

  it('old liked tag decays — fresh same-tag video outscores ancient counterpart', async () => {
    // Two separate tags, one liked recently, one liked a year ago.
    // Verify the recent tag has higher effective weight via getScoreBreakdown.
    const { getScoreBreakdown } = await importScoring()
    const oldDate = new Date(Date.now() - 365 * 86400000).toISOString()
    testDb.prepare(
      `INSERT INTO tag_preferences (tag, preference, mode, weight, last_seen, updated_at)
       VALUES ('fresh-tag', 'liked', 'social', 1.0, datetime('now'), datetime('now')),
              ('old-tag',   'liked', 'social', 1.0, ?, ?)`
    ).run(oldDate, oldDate)

    const freshVideo = v({ url: 'fresh', tags: JSON.stringify(['fresh-tag']) })
    const oldVideo   = v({ url: 'old',   tags: JSON.stringify(['old-tag']) })

    const freshBreak = getScoreBreakdown(freshVideo, 'test', { mode: 'social' })
    const oldBreak   = getScoreBreakdown(oldVideo,   'test', { mode: 'social' })
    expect(freshBreak.likedTagPts).toBeGreaterThan(oldBreak.likedTagPts)
  })

  it('tag_associations lifts adjacent content via associatedTagPts', async () => {
    const { getScoreBreakdown, scoreVideos } = await importScoring()
    // User likes "ai"; "ai" co-occurs with "claude" 5 times.
    testDb.prepare(
      `INSERT INTO tag_preferences (tag, preference, mode, weight, last_seen, updated_at)
       VALUES ('ai','liked','social', 5.0, datetime('now'), datetime('now'))`
    ).run()
    testDb.prepare(
      `INSERT INTO tag_associations (tag_a, tag_b, co_occurrences, last_seen)
       VALUES ('ai','claude', 5, datetime('now'))`
    ).run()

    const claudeOnly = v({ tags: JSON.stringify(['claude']) })
    const totallyUnrelated = v({ tags: JSON.stringify(['knitting']) })

    const claudeBreak = getScoreBreakdown(claudeOnly, 'test', { mode: 'social' })
    expect(claudeBreak.associatedTagPts).toBeGreaterThan(0)

    const out = scoreVideos([totallyUnrelated, claudeOnly], 'test', { mode: 'social' })
    expect(out[0].url).toBe(claudeOnly.url)
  })

  it('NSFW likes-pool overlap adds inLikesPool bonus', async () => {
    const { getScoreBreakdown } = await importScoring()
    const likedUrl = 'https://example.com/nsfw/loved'
    testDb.prepare(
      `INSERT INTO persistent_row_items (row_key, video_url, uploader)
       VALUES ('ph_likes', ?, 'TopModel')`
    ).run(likedUrl)

    const exactMatch  = v({ url: likedUrl,  tags: '[]', uploader: 'TopModel' })
    const noMatch     = v({ url: 'https://example.com/nsfw/other', uploader: 'OtherCreator' })

    const matchBreak  = getScoreBreakdown(exactMatch,  'test', { mode: 'nsfw' })
    const noMatchBreak = getScoreBreakdown(noMatch,    'test', { mode: 'nsfw' })

    expect(matchBreak.nsfwPoolPts).toBeGreaterThan(0)
    expect(noMatchBreak.nsfwPoolPts).toBe(0)
    expect(matchBreak.final).toBeGreaterThan(noMatchBreak.final)
  })

  it('NSFW subscribed-models bonus fires on creator overlap', async () => {
    const { getScoreBreakdown } = await importScoring()
    testDb.prepare(
      `INSERT INTO persistent_row_items (row_key, video_url, uploader)
       VALUES ('ph_subs', 'https://example.com/sub/1', 'SubscribedModel')`
    ).run()

    const subVid     = v({ url: 'https://example.com/x', uploader: 'SubscribedModel', tags: '[]' })
    const nonSubVid  = v({ url: 'https://example.com/y', uploader: 'RandomCreator',   tags: '[]' })

    const subBreak    = getScoreBreakdown(subVid,    'test', { mode: 'nsfw' })
    const nonSubBreak = getScoreBreakdown(nonSubVid, 'test', { mode: 'nsfw' })
    expect(subBreak.nsfwPoolPts).toBeGreaterThanOrEqual(50)  // inSubscribedModelsPool
    expect(nonSubBreak.nsfwPoolPts).toBe(0)
  })

  it('recordEngagement upserts tag_preferences with bumped weight + association pairs', async () => {
    const { recordEngagement } = await importScoring()

    recordEngagement({
      rating: 'up',
      tags: ['ai', 'claude', 'tutorial'],
      mode: 'social',
    })

    const prefs = testDb.prepare(
      `SELECT tag, preference, weight FROM tag_preferences ORDER BY tag`
    ).all()
    expect(prefs).toHaveLength(3)
    expect(prefs.every(p => p.preference === 'liked')).toBe(true)
    expect(prefs.every(p => p.weight === 1.0)).toBe(true)  // First insert = 1.0; bumps happen on later events.

    const assocs = testDb.prepare(
      `SELECT tag_a, tag_b, co_occurrences FROM tag_associations ORDER BY tag_a, tag_b`
    ).all()
    expect(assocs).toHaveLength(3) // C(3,2) = 3 pairs
    expect(assocs.every(a => a.tag_a < a.tag_b)).toBe(true) // canonical order
    expect(assocs.every(a => a.co_occurrences === 1)).toBe(true)
  })

  it('recordEngagement bumps weight + associations on repeat thumbs-up', async () => {
    const { recordEngagement } = await importScoring()
    recordEngagement({ rating: 'up', tags: ['ai', 'claude'], mode: 'social' })
    recordEngagement({ rating: 'up', tags: ['ai', 'claude'], mode: 'social' })

    const ai = testDb.prepare(`SELECT weight FROM tag_preferences WHERE tag='ai'`).get()
    expect(ai.weight).toBe(2.0) // 1.0 insert, +1.0 bump

    const assoc = testDb.prepare(
      `SELECT co_occurrences FROM tag_associations WHERE tag_a='ai' AND tag_b='claude'`
    ).get()
    expect(assoc.co_occurrences).toBe(2)
  })

  it('expected weight on single recordEngagement is 1.0 (insert path)', async () => {
    const { recordEngagement } = await importScoring()
    recordEngagement({ rating: 'up', tags: ['solo-tag'], mode: 'social' })
    const row = testDb.prepare(`SELECT weight FROM tag_preferences WHERE tag='solo-tag'`).get()
    expect(row.weight).toBe(1.0)
  })
})
