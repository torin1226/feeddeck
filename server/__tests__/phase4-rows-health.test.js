import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'

// ============================================================
// Phase 4 — auto-deprecation + cluster suggestion tests
//
// The /api/rows/health endpoint is the hydration routine's
// signal feed: which rows are getting bounced off, and which
// tag pairs are emerging that no existing row owns.
//
// We test the underlying SQL logic by replicating the route
// query against an in-memory DB. Pulling express + the full
// route surface in a unit test would be heavy.
// ============================================================

let testDb

vi.mock('../database.js', () => ({ get db() { return testDb } }))
vi.mock('../logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

function makeDb() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE row_engagement (
      row_key TEXT NOT NULL,
      day TEXT NOT NULL,
      impressions INTEGER NOT NULL DEFAULT 0,
      thumbs_down INTEGER NOT NULL DEFAULT 0,
      thumbs_up INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (row_key, day)
    );
    CREATE TABLE tag_associations (
      tag_a TEXT NOT NULL,
      tag_b TEXT NOT NULL,
      co_occurrences INTEGER DEFAULT 1,
      last_seen DATETIME DEFAULT (datetime('now')),
      PRIMARY KEY (tag_a, tag_b)
    );
    CREATE TABLE categories (
      key TEXT PRIMARY KEY,
      label TEXT,
      topic_sources TEXT
    );
  `)
  return db
}

// Replicates server/routes/ratings.js GET /api/rows/health logic
function computeRowsHealth(db) {
  const thirtyDaysAgo = "date('now', '-30 days')"
  const rows = db.prepare(
    `SELECT row_key,
            SUM(impressions) AS impressions,
            SUM(thumbs_down) AS thumbs_down,
            SUM(thumbs_up)   AS thumbs_up
     FROM row_engagement
     WHERE day >= ${thirtyDaysAgo}
     GROUP BY row_key
     ORDER BY impressions DESC`
  ).all()
  const underperformingRows = rows
    .filter(r => r.impressions >= 5 && (r.thumbs_down / r.impressions) >= 0.4)
    .map(r => ({
      row_key: r.row_key,
      impressions: r.impressions,
      thumbs_down: r.thumbs_down,
      thumbs_up: r.thumbs_up,
      downRatio: +(r.thumbs_down / r.impressions).toFixed(3),
    }))

  const pairs = db.prepare(
    `SELECT tag_a, tag_b, co_occurrences FROM tag_associations
     WHERE co_occurrences >= 3 ORDER BY co_occurrences DESC LIMIT 30`
  ).all()
  const allTopicSourcesText = db.prepare(
    `SELECT topic_sources FROM categories WHERE topic_sources IS NOT NULL`
  ).all().map(r => (r.topic_sources || '').toLowerCase()).join(' ')
  const emergentClusters = pairs
    .filter(p => {
      const a = p.tag_a.toLowerCase(); const b = p.tag_b.toLowerCase()
      return !allTopicSourcesText.includes(a) || !allTopicSourcesText.includes(b)
    })
    .map(p => ({ tag_a: p.tag_a, tag_b: p.tag_b, co_occurrences: p.co_occurrences }))

  return { underperformingRows, emergentClusters }
}

describe('Phase 4 row health endpoint', () => {
  beforeEach(() => { testDb = makeDb() })

  it('flags rows with >=40% thumbs-down ratio and >=5 impressions', () => {
    testDb.prepare(
      `INSERT INTO row_engagement (row_key, day, impressions, thumbs_down, thumbs_up)
       VALUES ('Viral This Week', date('now'), 10, 5, 2),
              ('My Subscriptions', date('now'), 20, 1, 18),
              ('City Walks', date('now'), 8, 4, 0)`
    ).run()
    const r = computeRowsHealth(testDb)
    const keys = r.underperformingRows.map(x => x.row_key)
    expect(keys).toContain('Viral This Week')
    expect(keys).toContain('City Walks')
    expect(keys).not.toContain('My Subscriptions')
  })

  it('skips rows with <5 impressions even if all are thumbs-down (insufficient signal)', () => {
    testDb.prepare(
      `INSERT INTO row_engagement (row_key, day, impressions, thumbs_down, thumbs_up)
       VALUES ('NewRow', date('now'), 4, 4, 0)`
    ).run()
    const r = computeRowsHealth(testDb)
    expect(r.underperformingRows).toHaveLength(0)
  })

  it('aggregates engagement across multiple days within the 30-day window', () => {
    testDb.prepare(
      `INSERT INTO row_engagement (row_key, day, impressions, thumbs_down, thumbs_up)
       VALUES ('Trending', date('now', '-5 days'), 3, 2, 0),
              ('Trending', date('now', '-2 days'), 4, 2, 0),
              ('Trending', date('now'),            2, 1, 0)`
    ).run()
    const r = computeRowsHealth(testDb)
    const trending = r.underperformingRows.find(x => x.row_key === 'Trending')
    expect(trending).toBeDefined()
    expect(trending.impressions).toBe(9)
    expect(trending.thumbs_down).toBe(5)
  })

  it('surfaces tag pairs with co_occurrences >= 3 that no row owns', () => {
    testDb.prepare(
      `INSERT INTO tag_associations (tag_a, tag_b, co_occurrences) VALUES
        ('ai', 'claude', 8),
        ('ai', 'tutorial', 5),
        ('cooking', 'fall', 3),
        ('rare', 'pair', 2)`
    ).run()
    testDb.prepare(
      `INSERT INTO categories (key, label, topic_sources) VALUES
        ('social_ai', 'AI & Coding', '["liked_tags:ai,claude,tutorial"]')`
    ).run()
    const r = computeRowsHealth(testDb)
    const pairs = r.emergentClusters.map(c => `${c.tag_a}+${c.tag_b}`)
    expect(pairs).toContain('cooking+fall')
    expect(pairs).not.toContain('ai+claude')
    expect(pairs).not.toContain('rare+pair') // below threshold
  })

  it('returns empty arrays cleanly with no engagement data', () => {
    const r = computeRowsHealth(testDb)
    expect(r.underperformingRows).toEqual([])
    expect(r.emergentClusters).toEqual([])
  })
})
