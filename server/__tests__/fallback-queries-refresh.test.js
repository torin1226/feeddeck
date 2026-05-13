import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// ============================================================
// Stale fallback_queries refresh migration tests
// (line 1156 follow-up, 2026-05-13)
//
// The 2026-05-13 hydration commit (9d7e149) updated the SOCIAL_LAYOUT
// migration block to fix off-topic YouTube results (76% off-topic on
// social_cooking, 63% on social_design). The SOCIAL_LAYOUT migration is
// gated on `if (!haveNews)` so existing DBs do not re-run it; the
// fallback_queries column kept the pre-9d7e149 strings. The fallback
// path in routes/content.js's _refillTopicPipeline fires those strings
// whenever the topic pipeline returns < 8 results.
//
// The new UPDATE migration in initDatabase() refreshes the two stale
// rows in place. Tests below replicate the migration's SQL against an
// in-memory DB so the contract (idempotent, gated on exact old payload)
// stays locked.
// ============================================================

const CATEGORIES_SCHEMA = `
  CREATE TABLE categories (
    key TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    query TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'social',
    sort_order INTEGER DEFAULT 0,
    topic_sources TEXT,
    fallback_queries TEXT
  );
`

let tmpDir
let dbPath
let db

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'fd-fallback-test-'))
  dbPath = join(tmpDir, 'test.db')
  db = new DatabaseSync(dbPath)
  db.exec(CATEGORIES_SCHEMA)
})

afterEach(() => {
  try { db.close() } catch {}
  try { rmSync(tmpDir, { recursive: true, force: true }) } catch {}
})

function applyRefresh(database) {
  database.prepare(
    `UPDATE categories SET fallback_queries = ?
     WHERE key = 'social_cooking' AND fallback_queries = ?`
  ).run(
    '["ytsearch10:home cooking recipe tutorial"]',
    '["ytsearch10:cooking recipe short"]'
  )
  database.prepare(
    `UPDATE categories SET fallback_queries = ?
     WHERE key = 'social_design' AND fallback_queries = ?`
  ).run(
    '["ytsearch10:UI design figma tutorial"]',
    '["ytsearch10:UI UX design tips"]'
  )
}

function getFallback(database, key) {
  const row = database.prepare(
    'SELECT fallback_queries FROM categories WHERE key = ?'
  ).get(key)
  return row?.fallback_queries
}

describe('stale fallback_queries refresh migration', () => {
  it('refreshes social_cooking fallback when the exact old payload is present', () => {
    db.prepare(
      `INSERT INTO categories (key, label, query, fallback_queries)
       VALUES ('social_cooking', 'Cooking', 'ytsearch10:home cooking recipe tutorial', ?)`
    ).run('["ytsearch10:cooking recipe short"]')

    applyRefresh(db)

    expect(getFallback(db, 'social_cooking')).toBe(
      '["ytsearch10:home cooking recipe tutorial"]'
    )
  })

  it('refreshes social_design fallback when the exact old payload is present', () => {
    db.prepare(
      `INSERT INTO categories (key, label, query, fallback_queries)
       VALUES ('social_design', 'Design', 'ytsearch10:UI design figma tutorial', ?)`
    ).run('["ytsearch10:UI UX design tips"]')

    applyRefresh(db)

    expect(getFallback(db, 'social_design')).toBe(
      '["ytsearch10:UI design figma tutorial"]'
    )
  })

  it('is idempotent: a second run on already-refreshed rows is a no-op', () => {
    db.prepare(
      `INSERT INTO categories (key, label, query, fallback_queries)
       VALUES ('social_cooking', 'Cooking', 'ytsearch10:home cooking recipe tutorial', ?),
              ('social_design',  'Design',  'ytsearch10:UI design figma tutorial',     ?)`
    ).run(
      '["ytsearch10:home cooking recipe tutorial"]',
      '["ytsearch10:UI design figma tutorial"]'
    )

    applyRefresh(db)
    applyRefresh(db)

    expect(getFallback(db, 'social_cooking')).toBe('["ytsearch10:home cooking recipe tutorial"]')
    expect(getFallback(db, 'social_design')).toBe('["ytsearch10:UI design figma tutorial"]')
  })

  it('skips rows whose fallback_queries has already been customized', () => {
    const customCooking = '["ytsearch10:home cooking recipe tutorial","ytsearch10:knife skills"]'
    db.prepare(
      `INSERT INTO categories (key, label, query, fallback_queries)
       VALUES ('social_cooking', 'Cooking', 'ytsearch10:home cooking recipe tutorial', ?)`
    ).run(customCooking)

    applyRefresh(db)

    expect(getFallback(db, 'social_cooking')).toBe(customCooking)
  })

  it('is a no-op when the target rows do not exist (fresh install where seed already shipped the new strings)', () => {
    applyRefresh(db)

    expect(getFallback(db, 'social_cooking')).toBeUndefined()
    expect(getFallback(db, 'social_design')).toBeUndefined()
  })

  it('leaves unrelated categories untouched', () => {
    db.prepare(
      `INSERT INTO categories (key, label, query, fallback_queries)
       VALUES ('social_cooking', 'Cooking', 'ytsearch10:home cooking recipe tutorial', ?),
              ('social_tech',    'Tech',    'ytsearch10:best new tech gadgets',        ?),
              ('social_music',   'Music',   'ytsearch10:tiny desk concert',            ?)`
    ).run(
      '["ytsearch10:cooking recipe short"]',
      '["ytsearch10:best new tech gadgets"]',
      '["ytsearch10:tiny desk concert"]'
    )

    applyRefresh(db)

    expect(getFallback(db, 'social_cooking')).toBe('["ytsearch10:home cooking recipe tutorial"]')
    expect(getFallback(db, 'social_tech')).toBe('["ytsearch10:best new tech gadgets"]')
    expect(getFallback(db, 'social_music')).toBe('["ytsearch10:tiny desk concert"]')
  })
})
