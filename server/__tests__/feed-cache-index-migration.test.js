import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

import { migrateFeedCacheModeIndex } from '../database.js'

// ============================================================
// idx_feed_cache_mode migration tests
// (EXPLAIN audit follow-up, 2026-05-13)
//
// Old shape: (mode, watched, expires_at)
// New shape: (mode, watched, fetched_at DESC)
//
// /api/feed/next sorts by fetched_at DESC after filtering mode+watched.
// The old index forced a TEMP B-TREE sort over the full filtered set
// before LIMIT 500. The new shape lets SQLite walk the index in order.
// ============================================================

const FEED_CACHE_SCHEMA = `
  CREATE TABLE feed_cache (
    id TEXT PRIMARY KEY,
    source_domain TEXT,
    mode TEXT NOT NULL DEFAULT 'social',
    url TEXT NOT NULL UNIQUE,
    stream_url TEXT,
    title TEXT,
    creator TEXT,
    thumbnail TEXT,
    duration INTEGER DEFAULT 0,
    orientation TEXT DEFAULT 'horizontal',
    view_count INTEGER,
    like_count INTEGER,
    subscriber_count INTEGER,
    upload_date TEXT,
    fetched_at DATETIME DEFAULT (datetime('now')),
    expires_at DATETIME DEFAULT (datetime('now', '+6 hours')),
    watched INTEGER DEFAULT 0
  );
`

let tmpDir
let dbPath
let db

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'fd-idx-test-'))
  dbPath = join(tmpDir, 'test.db')
  db = new DatabaseSync(dbPath)
  db.exec(FEED_CACHE_SCHEMA)
})

afterEach(() => {
  try { db.close() } catch {}
  try { rmSync(tmpDir, { recursive: true, force: true }) } catch {}
})

function indexCols(database, name) {
  return database.prepare(`PRAGMA index_info('${name}')`).all().map(c => c.name)
}

describe('migrateFeedCacheModeIndex', () => {
  it('returns false silently when the index does not exist (fresh table without seed indexes)', () => {
    const changed = migrateFeedCacheModeIndex(db)
    expect(changed).toBe(false)
  })

  it('returns false on null database handle', () => {
    expect(migrateFeedCacheModeIndex(null)).toBe(false)
  })

  it('replaces the old (mode, watched, expires_at) index with (mode, watched, fetched_at)', () => {
    db.exec('CREATE INDEX idx_feed_cache_mode ON feed_cache(mode, watched, expires_at)')
    expect(indexCols(db, 'idx_feed_cache_mode')).toEqual(['mode', 'watched', 'expires_at'])

    const changed = migrateFeedCacheModeIndex(db)
    expect(changed).toBe(true)
    expect(indexCols(db, 'idx_feed_cache_mode')).toEqual(['mode', 'watched', 'fetched_at'])
  })

  it('is a no-op when the index already has the new shape', () => {
    db.exec('CREATE INDEX idx_feed_cache_mode ON feed_cache(mode, watched, fetched_at DESC)')
    const changed = migrateFeedCacheModeIndex(db)
    expect(changed).toBe(false)
    expect(indexCols(db, 'idx_feed_cache_mode')).toEqual(['mode', 'watched', 'fetched_at'])
  })

  it('skips and warns when the index has an unexpected third column', () => {
    db.exec('CREATE INDEX idx_feed_cache_mode ON feed_cache(mode, watched, url)')
    const changed = migrateFeedCacheModeIndex(db)
    expect(changed).toBe(false)
    expect(indexCols(db, 'idx_feed_cache_mode')).toEqual(['mode', 'watched', 'url'])
  })

  it('is idempotent across repeated calls', () => {
    db.exec('CREATE INDEX idx_feed_cache_mode ON feed_cache(mode, watched, expires_at)')
    expect(migrateFeedCacheModeIndex(db)).toBe(true)
    expect(migrateFeedCacheModeIndex(db)).toBe(false)
    expect(migrateFeedCacheModeIndex(db)).toBe(false)
    expect(indexCols(db, 'idx_feed_cache_mode')).toEqual(['mode', 'watched', 'fetched_at'])
  })
})

describe('EXPLAIN QUERY PLAN — candidate-pool query', () => {
  // Mirrors /api/feed/next at server/routes/feed.js:93 — the hot path
  // the migration targets. Just the ORDER BY behavior matters here, so
  // skip the correlated subqueries.
  const HOT_QUERY = `
    SELECT id FROM feed_cache
    WHERE mode = ? AND watched = 0
    ORDER BY fetched_at DESC
    LIMIT 500
  `

  function explain(database) {
    return database.prepare(`EXPLAIN QUERY PLAN ${HOT_QUERY}`).all('nsfw').map(r => r.detail).join('\n')
  }

  it('shows TEMP B-TREE FOR ORDER BY on the old index shape', () => {
    db.exec('CREATE INDEX idx_feed_cache_mode ON feed_cache(mode, watched, expires_at)')
    expect(explain(db)).toMatch(/TEMP B-TREE FOR ORDER BY/)
  })

  it('eliminates TEMP B-TREE FOR ORDER BY after migration', () => {
    db.exec('CREATE INDEX idx_feed_cache_mode ON feed_cache(mode, watched, expires_at)')
    migrateFeedCacheModeIndex(db)
    expect(explain(db)).not.toMatch(/TEMP B-TREE FOR ORDER BY/)
    expect(explain(db)).toMatch(/idx_feed_cache_mode/)
  })

  it('still uses the same index name for the unwatched-count query (leading columns unchanged)', () => {
    db.exec('CREATE INDEX idx_feed_cache_mode ON feed_cache(mode, watched, expires_at)')
    migrateFeedCacheModeIndex(db)
    const countPlan = db.prepare(
      'EXPLAIN QUERY PLAN SELECT COUNT(*) FROM feed_cache WHERE mode = ? AND watched = ?'
    ).all('nsfw', 0).map(r => r.detail).join('\n')
    expect(countPlan).toMatch(/idx_feed_cache_mode/)
  })
})

describe('Candidate-pool query — row ordering preserved', () => {
  it('returns rows newest-first after migration', () => {
    db.exec('CREATE INDEX idx_feed_cache_mode ON feed_cache(mode, watched, expires_at)')
    const insert = db.prepare(
      "INSERT INTO feed_cache (id, url, mode, fetched_at) VALUES (?, ?, 'nsfw', ?)"
    )
    insert.run('a', 'https://example.com/a', '2026-05-01 00:00:00')
    insert.run('b', 'https://example.com/b', '2026-05-03 00:00:00')
    insert.run('c', 'https://example.com/c', '2026-05-02 00:00:00')

    migrateFeedCacheModeIndex(db)

    const rows = db.prepare(
      "SELECT id FROM feed_cache WHERE mode = 'nsfw' AND watched = 0 ORDER BY fetched_at DESC"
    ).all()
    expect(rows.map(r => r.id)).toEqual(['b', 'c', 'a'])
  })
})
