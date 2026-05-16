import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'

// ============================================================
// Dynamic trends24 fallback queries (BACKLOG line 1162 follow-up)
//
// `buildTrends24FallbackQueries(sources)` reads each `trends24:*` source's
// cached payload from `trends_cache` and returns one `ytsearch10:<top-keyword>`
// query per source whose cache has a fresh top topic. Static `fallback_queries`
// in routes/content.js only fires when this returns [].
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
    CREATE TABLE trends_cache (
      source_key TEXT PRIMARY KEY,
      fetched_at DATETIME NOT NULL DEFAULT (datetime('now')),
      payload_json TEXT NOT NULL,
      ttl_minutes INTEGER NOT NULL DEFAULT 360
    );
  `)
  return db
}

function seedCache(db, sourceKey, payload, ageMinutes = 0) {
  const fetchedAt = new Date(Date.now() - ageMinutes * 60_000).toISOString()
  db.prepare(
    `INSERT INTO trends_cache (source_key, fetched_at, payload_json, ttl_minutes)
     VALUES (?, ?, ?, 360)`
  ).run(sourceKey, fetchedAt, JSON.stringify(payload))
}

async function importTopics() {
  vi.resetModules()
  return await import('../topics.js')
}

describe('buildTrends24FallbackQueries', () => {
  beforeEach(() => { testDb = makeDb() })

  it('returns one ytsearch10:<top> query per fresh trends24 source', async () => {
    const { buildTrends24FallbackQueries } = await importTopics()
    seedCache(testDb, 'trends24:music', { topics: ['taylor swift tour', 'sabrina carpenter'], creators: [], directVideos: [] })
    seedCache(testDb, 'trends24:gaming', { topics: ['minecraft 1.22', 'gta 6 trailer'], creators: [], directVideos: [] })

    const queries = buildTrends24FallbackQueries(['trends24:music', 'trends24:gaming'])

    expect(queries).toEqual([
      'ytsearch10:taylor swift tour',
      'ytsearch10:minecraft 1.22',
    ])
  })

  it('skips non-trends24 sources', async () => {
    const { buildTrends24FallbackQueries } = await importTopics()
    seedCache(testDb, 'trends24:news', { topics: ['election results'], creators: [], directVideos: [] })

    const queries = buildTrends24FallbackQueries([
      'liked_tags:tech',
      'boosted_creators:5',
      'trends24:news',
      'discovered_creators:social_news',
    ])

    expect(queries).toEqual(['ytsearch10:election results'])
  })

  it('returns [] when the trends24 cache is missing for a source', async () => {
    const { buildTrends24FallbackQueries } = await importTopics()
    // No seed at all.
    const queries = buildTrends24FallbackQueries(['trends24:music'])
    expect(queries).toEqual([])
  })

  it('returns [] when the cached payload has no topics', async () => {
    const { buildTrends24FallbackQueries } = await importTopics()
    seedCache(testDb, 'trends24:sports', { topics: [], creators: [], directVideos: [] })

    const queries = buildTrends24FallbackQueries(['trends24:sports'])
    expect(queries).toEqual([])
  })

  it('skips a source whose cache is past its TTL', async () => {
    const { buildTrends24FallbackQueries } = await importTopics()
    // 7 hours old, 6h default TTL → expired.
    seedCache(
      testDb,
      'trends24:music',
      { topics: ['stale topic'], creators: [], directVideos: [] },
      7 * 60
    )

    const queries = buildTrends24FallbackQueries(['trends24:music'])
    expect(queries).toEqual([])
  })

  it('returns [] for empty / non-array input (defensive)', async () => {
    const { buildTrends24FallbackQueries } = await importTopics()
    expect(buildTrends24FallbackQueries([])).toEqual([])
    expect(buildTrends24FallbackQueries(null)).toEqual([])
    expect(buildTrends24FallbackQueries(undefined)).toEqual([])
    expect(buildTrends24FallbackQueries('trends24:music')).toEqual([])
  })

  it('ignores non-string entries in the sources array', async () => {
    const { buildTrends24FallbackQueries } = await importTopics()
    seedCache(testDb, 'trends24:music', { topics: ['ok'], creators: [], directVideos: [] })

    const queries = buildTrends24FallbackQueries([null, 42, { kind: 'trends24' }, 'trends24:music'])
    expect(queries).toEqual(['ytsearch10:ok'])
  })

  it('builds queries even when topics array contains a single keyword', async () => {
    const { buildTrends24FallbackQueries } = await importTopics()
    seedCache(testDb, 'trends24:news', { topics: ['breaking story'], creators: [], directVideos: [] })

    const queries = buildTrends24FallbackQueries(['trends24:news'])
    expect(queries).toEqual(['ytsearch10:breaking story'])
  })

  it('returns empty when no source begins with trends24:', async () => {
    const { buildTrends24FallbackQueries } = await importTopics()
    seedCache(testDb, 'trends24:music', { topics: ['shouldnt-show'], creators: [], directVideos: [] })

    const queries = buildTrends24FallbackQueries(['liked_tags:ai', 'twitter_trends:us'])
    expect(queries).toEqual([])
  })
})
