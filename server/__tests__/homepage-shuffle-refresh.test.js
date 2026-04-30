import { describe, it, expect, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'

// ============================================================
// Shuffle / Refresh SQL-behavior tests
//
// These mirror the exact statements used by server/routes/content.js
// for the homepage shuffle + refresh flow:
//   - GET  /api/homepage           (videos / videosFallback)
//   - POST /api/homepage/viewed    (markViewed)
//
// Each test runs against a fresh :memory: database so it's isolated
// from the user's real library.db and from other tests. The schema
// here is the minimal subset of database.js needed to reproduce the
// query behavior — keeping the schema in sync is the cost we pay
// for not depending on the real init path (which would seed 50+
// real categories on every test run).
//
// Why this exists: prior bugs in this area (homepage viewed=0
// filter missing, refill loops corrupting __creators__ sentinel,
// shuffle silently no-op'ing) were all caught by manual play-test
// only. These tests turn each failure mode into a regression guard.
// ============================================================

function makeDb() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE categories (
      key TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      query TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'social',
      sort_order INTEGER DEFAULT 0
    );
    CREATE TABLE homepage_cache (
      id TEXT PRIMARY KEY,
      category_key TEXT NOT NULL,
      url TEXT NOT NULL,
      title TEXT,
      thumbnail TEXT,
      duration INTEGER DEFAULT 0,
      source TEXT,
      uploader TEXT,
      view_count INTEGER DEFAULT 0,
      like_count INTEGER,
      subscriber_count INTEGER,
      upload_date TEXT,
      tags TEXT DEFAULT '[]',
      fetched_at DATETIME DEFAULT (datetime('now')),
      expires_at DATETIME DEFAULT (datetime('now', '+7 days')),
      viewed INTEGER DEFAULT 0
    );
  `)
  return db
}

// Mirrors server/routes/content.js _homepageVideosStmt
const VIDEOS_SQL = `
  SELECT id, url, title, thumbnail, duration, source, uploader, view_count, like_count, subscriber_count, upload_date, fetched_at, tags, viewed
  FROM homepage_cache
  WHERE category_key = ? AND viewed = 0 AND expires_at > datetime('now')
  ORDER BY fetched_at DESC
  LIMIT 20
`
// Mirrors server/routes/content.js _homepageVideosFallbackStmt
const VIDEOS_FALLBACK_SQL = `
  SELECT id, url, title, thumbnail, duration, source, uploader, view_count, like_count, subscriber_count, upload_date, fetched_at, tags, viewed
  FROM homepage_cache
  WHERE category_key = ? AND viewed = 0
  ORDER BY fetched_at DESC
  LIMIT 20
`
// Mirrors server/routes/content.js _markViewedStmt
const MARK_VIEWED_SQL = `UPDATE homepage_cache SET viewed = 1 WHERE id = ?`

function seed(db, { categoryKey, count, expiresOffset = '+7 days' }) {
  const insert = db.prepare(
    `INSERT INTO homepage_cache (id, category_key, url, title, fetched_at, expires_at)
     VALUES (?, ?, ?, ?, datetime('now', ?), datetime('now', ?))`
  )
  const rows = []
  for (let i = 0; i < count; i++) {
    const id = `${categoryKey}_v${i}`
    const url = `https://example.com/${categoryKey}/${i}`
    const title = `${categoryKey} item ${i}`
    // fetched_at staggered so ORDER BY fetched_at DESC is stable & predictable
    const fetchedOffset = `-${i} minutes`
    insert.run(id, categoryKey, url, title, fetchedOffset, expiresOffset)
    rows.push({ id, url, title })
  }
  return rows
}

describe('homepage shuffle/refresh SQL contracts', () => {
  let db

  beforeEach(() => {
    db = makeDb()
    db.prepare(
      `INSERT INTO categories (key, label, query, mode, sort_order) VALUES (?, ?, ?, ?, ?)`
    ).run('cat_a', 'Category A', 'q1', 'social', 0)
    db.prepare(
      `INSERT INTO categories (key, label, query, mode, sort_order) VALUES (?, ?, ?, ?, ?)`
    ).run('cat_b', 'Category B', 'q2', 'social', 1)
  })

  // --------------------------------------------------------
  // Failure mode #1: id round-trip
  // The IDs surfaced by /api/homepage MUST be the same values
  // /api/homepage/viewed expects in its UPDATE WHERE clause.
  // Otherwise shuffle silently no-ops.
  // --------------------------------------------------------
  describe('id round-trip (shuffle silent-no-op guard)', () => {
    it('the id returned by the videos query is the primary key markViewed expects', () => {
      seed(db, { categoryKey: 'cat_a', count: 10 })
      const rows = db.prepare(VIDEOS_SQL).all('cat_a')
      expect(rows.length).toBeGreaterThan(0)

      // Take whatever the route would send to the client...
      const clientReceivedId = rows[0].id
      // ...then run markViewed with exactly that value (mirrors what
      // homeStore.shuffleHome POSTs to /api/homepage/viewed?id=...)
      const result = db.prepare(MARK_VIEWED_SQL).run(clientReceivedId)
      expect(result.changes).toBe(1)
    })

    it('marking by URL instead of cache id matches zero rows (proves urls are NOT valid ids)', () => {
      const seeded = seed(db, { categoryKey: 'cat_a', count: 5 })
      // If client ever derives id from `url` instead of `id` field,
      // the UPDATE silently no-ops. This test pins that contract:
      // a URL is NOT a valid markViewed key. If this ever passes
      // with changes=1, somebody changed the homepage_cache primary
      // key to be the url and broke the type contract.
      const result = db.prepare(MARK_VIEWED_SQL).run(seeded[0].url)
      expect(result.changes).toBe(0)
    })

    it('marking by a non-existent id returns success but changes nothing (silent failure mode)', () => {
      seed(db, { categoryKey: 'cat_a', count: 5 })
      const result = db.prepare(MARK_VIEWED_SQL).run('totally-bogus-id')
      // SQLite UPDATE with no matching rows succeeds with changes=0.
      // The route handler returns 200 OK in this case — the client
      // has no way to tell whether the mark actually happened.
      // This is the "shuffle button feels broken" bug class.
      expect(result.changes).toBe(0)
    })
  })

  // --------------------------------------------------------
  // viewed = 0 filter (the filter the homepage_viewed_filter
  // memory says got dropped at least once)
  // --------------------------------------------------------
  describe('viewed=0 filter', () => {
    it('items marked viewed do not appear in the videos query', () => {
      const seeded = seed(db, { categoryKey: 'cat_a', count: 10 })
      const idsToHide = seeded.slice(0, 5).map(r => r.id)
      for (const id of idsToHide) {
        db.prepare(MARK_VIEWED_SQL).run(id)
      }

      const remaining = db.prepare(VIDEOS_SQL).all('cat_a')
      const remainingIds = new Set(remaining.map(r => r.id))
      // None of the hidden ids should still appear
      for (const id of idsToHide) {
        expect(remainingIds.has(id)).toBe(false)
      }
      // And we should still have the other 5 items
      expect(remaining.length).toBe(5)
    })

    it('after marking 5 viewed in a 10-item category, the next fetch returns 5 distinct items', () => {
      // This is the user-facing contract for shuffle: clicking it
      // when there are >=10 unviewed items per category MUST yield
      // 5 different items.
      const _seeded = seed(db, { categoryKey: 'cat_a', count: 10 })
      const beforeIds = db.prepare(VIDEOS_SQL).all('cat_a').slice(0, 5).map(r => r.id)
      for (const id of beforeIds) db.prepare(MARK_VIEWED_SQL).run(id)

      const afterTop5 = db.prepare(VIDEOS_SQL).all('cat_a').slice(0, 5).map(r => r.id)
      const overlap = afterTop5.filter(id => beforeIds.includes(id))
      expect(overlap).toEqual([])
      expect(afterTop5.length).toBe(5)
    })
  })

  // --------------------------------------------------------
  // Fallback path: when fresh+unviewed is empty, serve stale.
  // This is what keeps shuffle from returning empty rows when
  // the cache hasn't been warmed recently.
  // --------------------------------------------------------
  describe('fallback to stale-but-unviewed when fresh inventory is exhausted', () => {
    it('items past expires_at are filtered out of the primary query but caught by fallback', () => {
      // Insert 5 expired (yesterday) + 0 fresh
      seed(db, { categoryKey: 'cat_a', count: 5, expiresOffset: '-1 day' })

      const fresh = db.prepare(VIDEOS_SQL).all('cat_a')
      expect(fresh.length).toBe(0)

      const fallback = db.prepare(VIDEOS_FALLBACK_SQL).all('cat_a')
      expect(fallback.length).toBe(5)
    })

    it('after marking everything fresh as viewed, fallback still excludes them', () => {
      const seeded = seed(db, { categoryKey: 'cat_a', count: 5 })
      for (const r of seeded) db.prepare(MARK_VIEWED_SQL).run(r.id)
      const fallback = db.prepare(VIDEOS_FALLBACK_SQL).all('cat_a')
      expect(fallback.length).toBe(0)
    })

    it('fallback returns stale entries in fetched_at DESC order (newest stale first)', () => {
      // Insert older-stale + newer-stale; fallback must surface newer first.
      const insert = db.prepare(
        `INSERT INTO homepage_cache (id, category_key, url, title, fetched_at, expires_at)
         VALUES (?, 'cat_a', ?, ?, datetime('now', ?), datetime('now', '-1 hour'))`
      )
      insert.run('old1', 'u1', 'old', '-2 days')
      insert.run('new1', 'u2', 'new', '-1 hour')

      const rows = db.prepare(VIDEOS_FALLBACK_SQL).all('cat_a')
      expect(rows.map(r => r.id)).toEqual(['new1', 'old1'])
    })
  })

  // --------------------------------------------------------
  // Cross-category mark-viewed isolation
  // --------------------------------------------------------
  describe('mark-viewed scope', () => {
    it('marking a video viewed in cat_a does not affect cat_b copies (different cache rows)', () => {
      // Same URL surfaced under two different categories produces
      // two distinct homepage_cache rows (composite key collision
      // is avoided by the categoryKey_videoId id pattern). Marking
      // one viewed must not flip the other — that's the per-row
      // contract. The dedup happens at /api/homepage response
      // assembly time, not at the storage layer.
      const insert = db.prepare(
        `INSERT INTO homepage_cache (id, category_key, url, title) VALUES (?, ?, ?, ?)`
      )
      insert.run('cat_a_x', 'cat_a', 'https://shared/x', 'Shared X')
      insert.run('cat_b_x', 'cat_b', 'https://shared/x', 'Shared X')

      db.prepare(MARK_VIEWED_SQL).run('cat_a_x')

      const aRow = db.prepare('SELECT viewed FROM homepage_cache WHERE id = ?').get('cat_a_x')
      const bRow = db.prepare('SELECT viewed FROM homepage_cache WHERE id = ?').get('cat_b_x')
      expect(aRow.viewed).toBe(1)
      expect(bRow.viewed).toBe(0)
    })
  })

  // --------------------------------------------------------
  // Inventory-depth contract: this guards the user-visible
  // promise that shuffle "actually rotates content".
  // --------------------------------------------------------
  describe('inventory depth required for visible shuffle', () => {
    it('with only 5 fresh items, marking 5 viewed leaves zero fresh — homepage must rely on fallback', () => {
      // This pins the exact failure mode behind the user's "shuffle
      // does nothing" complaint when warm-cache is lagging: the
      // visible row gets repopulated from fallback (stale-but-
      // unviewed) which may be EMPTY if everything was marked.
      const seeded = seed(db, { categoryKey: 'cat_a', count: 5 })
      for (const r of seeded) db.prepare(MARK_VIEWED_SQL).run(r.id)

      const fresh = db.prepare(VIDEOS_SQL).all('cat_a')
      const fallback = db.prepare(VIDEOS_FALLBACK_SQL).all('cat_a')
      expect(fresh.length).toBe(0)
      expect(fallback.length).toBe(0)
      // ⇒ Client gets an empty array for cat_a. UI shows the same
      //   row unchanged (because phase1/phase2 in homeStore both
      //   short-circuit when freshByLabel has no entry for the
      //   label). User perceives "shuffle did nothing".
    })
  })
})
