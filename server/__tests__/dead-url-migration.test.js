import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

import { migrateDeadUrlColumns } from '../database.js'

// ============================================================
// dead / dead_at column migration (2026-05-16 NSFW skip-spike fix)
//
// Adds `dead INTEGER DEFAULT 0` and `dead_at DATETIME` to the three
// cache tables that hold video URLs: feed_cache, homepage_cache,
// persistent_row_items. The pre-resolve pipeline marks URLs dead when
// yt-dlp returns a permanent-failure error (404, 410, removed); the
// feed and stream-url routes filter dead = 0 so dead URLs stop
// reaching the hero autoplay and consuming yt-dlp budget.
// ============================================================

// Match production-shape columns the index targets (mode, watched)
// without all the unused ones. The migration's index covers (dead, mode)
// so both columns must exist in the test DB.
const FEED_CACHE_PRE_DEAD = `
  CREATE TABLE feed_cache (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL UNIQUE,
    mode TEXT NOT NULL DEFAULT 'social',
    watched INTEGER DEFAULT 0,
    stream_url TEXT
  );
`
const HOMEPAGE_CACHE_PRE_DEAD = `
  CREATE TABLE homepage_cache (
    id TEXT PRIMARY KEY,
    category_key TEXT NOT NULL,
    url TEXT NOT NULL
  );
`
const PERSISTENT_ITEMS_PRE_DEAD = `
  CREATE TABLE persistent_row_items (
    row_key TEXT NOT NULL,
    video_url TEXT NOT NULL,
    PRIMARY KEY (row_key, video_url)
  );
`

let tmpDir, dbPath, db

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'fd-dead-mig-'))
  dbPath = join(tmpDir, 'test.db')
  db = new DatabaseSync(dbPath)
  db.exec(FEED_CACHE_PRE_DEAD + HOMEPAGE_CACHE_PRE_DEAD + PERSISTENT_ITEMS_PRE_DEAD)
})

afterEach(() => {
  try { db.close() } catch {}
  try { rmSync(tmpDir, { recursive: true, force: true }) } catch {}
})

function colNames(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name)
}

describe('migrateDeadUrlColumns', () => {
  it('adds dead + dead_at to feed_cache when missing', () => {
    expect(colNames('feed_cache')).not.toContain('dead')

    migrateDeadUrlColumns(db)

    expect(colNames('feed_cache')).toContain('dead')
    expect(colNames('feed_cache')).toContain('dead_at')
  })

  it('adds dead + dead_at to homepage_cache when missing', () => {
    migrateDeadUrlColumns(db)
    expect(colNames('homepage_cache')).toContain('dead')
    expect(colNames('homepage_cache')).toContain('dead_at')
  })

  it('adds dead + dead_at to persistent_row_items when missing', () => {
    migrateDeadUrlColumns(db)
    expect(colNames('persistent_row_items')).toContain('dead')
    expect(colNames('persistent_row_items')).toContain('dead_at')
  })

  it('defaults dead = 0 on newly inserted rows', () => {
    migrateDeadUrlColumns(db)
    db.prepare(`INSERT INTO feed_cache (id, url) VALUES ('a', 'https://x.com/a')`).run()
    const row = db.prepare(`SELECT dead, dead_at FROM feed_cache WHERE id = 'a'`).get()
    expect(row.dead).toBe(0)
    expect(row.dead_at).toBeNull()
  })

  it('is idempotent — running twice does not throw or duplicate columns', () => {
    migrateDeadUrlColumns(db)
    expect(() => migrateDeadUrlColumns(db)).not.toThrow()
    const cols = colNames('feed_cache').filter(c => c === 'dead')
    expect(cols.length).toBe(1)
  })

  it('preserves existing rows (dead defaults to 0 for pre-migration rows)', () => {
    db.prepare(`INSERT INTO feed_cache (id, url) VALUES ('legacy', 'https://x.com/legacy')`).run()
    migrateDeadUrlColumns(db)
    const row = db.prepare(`SELECT dead FROM feed_cache WHERE id = 'legacy'`).get()
    expect(row.dead).toBe(0)
  })

  it('adds an index on (dead, mode) for feed_cache so the dead filter is free', () => {
    // The feed selection query already filters by mode + watched; adding
    // dead = 0 to the WHERE clause should hit an index, not table-scan
    // 20k+ rows. Adding source_domain or another column to the index
    // is fine, but it MUST cover dead so the planner uses it.
    migrateDeadUrlColumns(db)
    const indexes = db.prepare(`PRAGMA index_list('feed_cache')`).all().map(i => i.name)
    const deadIndex = indexes.find(n => n.includes('dead'))
    expect(deadIndex).toBeTruthy()
  })
})
