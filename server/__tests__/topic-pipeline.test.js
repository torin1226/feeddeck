import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'

// ============================================================
// Phase 2 — topic pipeline tests
//
// Covers:
//   * resolveTopics fan-out merges topics + creators + directVideos
//   * liked_tags resolver respects recency decay (newer likes lead)
//   * boosted_creators resolver returns top-N from creator_boosts
//   * discovered_creators resolver pulls from per-row history
//   * recordDiscoveredCreators upserts and bumps times_seen on repeat
//   * trends_cache hit avoids re-fetch
//
// trends24 + Phase 3 resolvers (subscribed_models, likes_pool,
// eporner_api, cross_site) are mocked or skipped — they hit external
// services and are exercised in smoke tests.
// ============================================================

let testDb

vi.mock('../database.js', () => ({
  get db() { return testDb },
}))

vi.mock('../logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

vi.mock('../sources/trends24.js', () => ({
  fetchSection: async (anchor) => ({
    videos: [{ url: `https://yt/${anchor}/v1`, title: `Top ${anchor} video`, uploader: 'TrendChan' }],
    creators: [{ handle: 'TrendChan', channel_url: 'https://youtube.com/@TrendChan' }],
    keywords: [`hot-keyword-${anchor}`, `another-${anchor}`],
  }),
}))

function makeDb() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE tag_preferences (
      tag TEXT PRIMARY KEY,
      preference TEXT NOT NULL,
      mode TEXT,
      weight REAL DEFAULT 1.0,
      last_seen TEXT,
      updated_at DATETIME DEFAULT (datetime('now'))
    );
    CREATE TABLE creator_boosts (
      creator TEXT PRIMARY KEY,
      boost_score REAL DEFAULT 0,
      mode TEXT,
      surface_boosts TEXT DEFAULT '{}',
      last_updated DATETIME DEFAULT (datetime('now'))
    );
    CREATE TABLE discovered_creators (
      creator TEXT NOT NULL,
      platform TEXT NOT NULL DEFAULT 'youtube',
      row_key TEXT NOT NULL,
      source TEXT NOT NULL,
      channel_url TEXT,
      first_seen_at DATETIME DEFAULT (datetime('now')),
      last_seen_at  DATETIME DEFAULT (datetime('now')),
      times_seen INTEGER DEFAULT 1,
      PRIMARY KEY (platform, creator, row_key)
    );
    CREATE TABLE trends_cache (
      source_key TEXT PRIMARY KEY,
      fetched_at DATETIME NOT NULL DEFAULT (datetime('now')),
      payload_json TEXT NOT NULL,
      ttl_minutes INTEGER NOT NULL DEFAULT 360
    );
  `)
  return db
}

async function importTopics() {
  vi.resetModules()
  return await import('../topics.js')
}

describe('Phase 2 topic pipeline', () => {
  beforeEach(() => { testDb = makeDb() })

  it('liked_tags resolver returns matching tags weight-ordered with recency decay', async () => {
    const { resolveTopics } = await importTopics()
    const today = new Date().toISOString()
    const oldDate = new Date(Date.now() - 365 * 86400000).toISOString()
    testDb.prepare(
      `INSERT INTO tag_preferences (tag, preference, mode, weight, last_seen, updated_at)
       VALUES ('ai', 'liked', 'social', 1.0, ?, ?),
              ('rare', 'liked', 'social', 1.0, ?, ?)`
    ).run(today, today, oldDate, oldDate)

    const r = await resolveTopics(['liked_tags:'], { mode: 'social' })
    expect(r.topics).toContain('ai')
    expect(r.topics).toContain('rare')
    // Fresh tag should rank ahead of stale even at equal raw weight.
    expect(r.topics.indexOf('ai')).toBeLessThan(r.topics.indexOf('rare'))
  })

  it('liked_tags csv filters to specified tags only', async () => {
    const { resolveTopics } = await importTopics()
    testDb.prepare(
      `INSERT INTO tag_preferences (tag, preference, mode, weight, last_seen, updated_at)
       VALUES ('ai', 'liked', 'social', 1.0, datetime('now'), datetime('now')),
              ('comedy', 'liked', 'social', 1.0, datetime('now'), datetime('now'))`
    ).run()

    const r = await resolveTopics(['liked_tags:ai'], { mode: 'social' })
    expect(r.topics).toEqual(['ai'])
  })

  it('boosted_creators resolver returns top-N positive boosts', async () => {
    const { resolveTopics } = await importTopics()
    testDb.prepare(
      `INSERT INTO creator_boosts (creator, boost_score, mode)
       VALUES ('Top', 0.75, 'social'), ('Mid', 0.5, 'social'),
              ('Low', 0.25, 'social'), ('Negative', -0.5, 'social')`
    ).run()

    const r = await resolveTopics(['boosted_creators:2'], { mode: 'social' })
    expect(r.creators.map(c => c.handle)).toEqual(['Top', 'Mid'])
  })

  it('discovered_creators resolver returns top by times_seen', async () => {
    const { resolveTopics } = await importTopics()
    testDb.prepare(
      `INSERT INTO discovered_creators (creator, row_key, source, channel_url, times_seen)
       VALUES ('Frequent', 'social_news', 'trends24:news', 'https://yt/freq', 5),
              ('Rare', 'social_news', 'search', NULL, 1),
              ('Other', 'social_other', 'search', NULL, 9)`
    ).run()

    const r = await resolveTopics(['discovered_creators:social_news'], { rowKey: 'social_news', mode: 'social' })
    expect(r.creators.map(c => c.handle)).toEqual(['Frequent', 'Rare'])
  })

  it('trends24 resolver merges directVideos + creators + topics', async () => {
    const { resolveTopics } = await importTopics()
    const r = await resolveTopics(['trends24:music'], { mode: 'social' })
    expect(r.directVideos).toHaveLength(1)
    expect(r.directVideos[0].url).toBe('https://yt/group-music/v1')
    expect(r.creators).toHaveLength(1)
    expect(r.creators[0].handle).toBe('TrendChan')
    expect(r.topics).toContain('hot-keyword-group-music')
  })

  it('trends_cache hit avoids re-call to fetchSection', async () => {
    const { resolveTopics } = await importTopics()
    // First call populates cache.
    await resolveTopics(['trends24:music'], { mode: 'social' })
    const cached = testDb.prepare(
      `SELECT payload_json FROM trends_cache WHERE source_key = 'trends24:music'`
    ).get()
    expect(cached).toBeTruthy()
    // Mutate the cached payload to confirm second call reads from cache.
    testDb.prepare(
      `UPDATE trends_cache SET payload_json = ? WHERE source_key = 'trends24:music'`
    ).run(JSON.stringify({ topics: ['cached-topic'], creators: [], directVideos: [] }))

    const r = await resolveTopics(['trends24:music'], { mode: 'social' })
    expect(r.topics).toEqual(['cached-topic'])
  })

  it('multiple sources are merged and deduped', async () => {
    const { resolveTopics } = await importTopics()
    testDb.prepare(
      `INSERT INTO tag_preferences (tag, preference, mode, weight, last_seen)
       VALUES ('ai', 'liked', 'social', 1.0, datetime('now'))`
    ).run()
    testDb.prepare(
      `INSERT INTO creator_boosts (creator, boost_score, mode)
       VALUES ('Top', 0.5, 'social')`
    ).run()

    const r = await resolveTopics(
      ['liked_tags:', 'boosted_creators:5', 'trends24:music'],
      { mode: 'social' }
    )
    expect(r.topics).toContain('ai')
    expect(r.topics).toContain('hot-keyword-group-music')
    expect(r.creators.map(c => c.handle)).toContain('Top')
    expect(r.creators.map(c => c.handle)).toContain('TrendChan')
    expect(r.directVideos).toHaveLength(1)
  })

  it('recordDiscoveredCreators upserts and bumps times_seen on repeat', async () => {
    const { recordDiscoveredCreators } = await importTopics()
    recordDiscoveredCreators('social_news', [
      { url: 'https://yt/v1', uploader: 'CreatorA' },
      { url: 'https://yt/v2', uploader: 'CreatorB' },
      { url: 'https://yt/v3', uploader: 'CreatorA' }, // duplicate within same call
    ], ['trends24:news-and-politics'])

    let rows = testDb.prepare(
      `SELECT creator, times_seen, source FROM discovered_creators WHERE row_key = 'social_news' ORDER BY creator`
    ).all()
    expect(rows).toHaveLength(2)
    expect(rows.every(r => r.times_seen === 1)).toBe(true)
    expect(rows[0].source).toBe('trends24:news-and-politics')

    // Second call with overlapping creator bumps times_seen.
    recordDiscoveredCreators('social_news', [
      { url: 'https://yt/v4', uploader: 'CreatorA' },
    ], ['trends24:news-and-politics'])

    rows = testDb.prepare(
      `SELECT creator, times_seen FROM discovered_creators WHERE row_key = 'social_news' ORDER BY creator`
    ).all()
    expect(rows.find(r => r.creator === 'CreatorA').times_seen).toBe(2)
    expect(rows.find(r => r.creator === 'CreatorB').times_seen).toBe(1)
  })

  it('unknown resolver kind is silently swallowed (fail-open)', async () => {
    const { resolveTopics } = await importTopics()
    const r = await resolveTopics(['totally:unknown', 'liked_tags:ai'], { mode: 'social' })
    // No throw; unknown kind contributes nothing; liked_tags still works.
    expect(r.topics).toBeInstanceOf(Array)
    expect(r.creators).toBeInstanceOf(Array)
  })

  it('empty sources array returns empty result', async () => {
    const { resolveTopics } = await importTopics()
    const r = await resolveTopics([], {})
    expect(r).toEqual({ topics: [], creators: [], directVideos: [] })
  })
})
