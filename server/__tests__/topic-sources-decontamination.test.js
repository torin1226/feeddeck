import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

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

const TOPIC_FIXES = [
  ['social_cooking',    '["trends24:howto-and-style","liked_tags:cooking"]',
                        '["liked_tags:cooking","discovered_creators:social_cooking"]'],
  ['social_design',     '["liked_tags:design,ux","trends24:howto-and-style","boosted_creators:5"]',
                        '["liked_tags:design,ux","boosted_creators:5","discovered_creators:social_design"]'],
  ['social_explainers', '["trends24:howto-and-style","liked_tags:tutorial,documentary"]',
                        '["liked_tags:tutorial,documentary","discovered_creators:social_explainers"]'],
  ['social_tech',       '["trends24:science-and-technology","liked_tags:tech"]',
                        '["liked_tags:tech","boosted_creators:3","discovered_creators:social_tech"]'],
  ['social_ai',         '["liked_tags:ai,vibe coding,claude tutorial,claude routines","trends24:science-and-technology"]',
                        '["liked_tags:ai,vibe coding,claude tutorial,claude routines","boosted_creators:3","discovered_creators:social_ai"]'],
]

let tmpDir
let db

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'fd-topic-decontam-'))
  db = new DatabaseSync(join(tmpDir, 'test.db'))
  db.exec(CATEGORIES_SCHEMA)
})

afterEach(() => {
  try { db.close() } catch {}
  try { rmSync(tmpDir, { recursive: true, force: true }) } catch {}
})

function applyMigration(database) {
  for (const [key, oldVal, newVal] of TOPIC_FIXES) {
    database.prepare(
      `UPDATE categories SET topic_sources = ? WHERE key = ? AND topic_sources = ?`
    ).run(newVal, key, oldVal)
  }
}

function getTopicSources(database, key) {
  const row = database.prepare('SELECT topic_sources FROM categories WHERE key = ?').get(key)
  return row?.topic_sources
}

describe('topic_sources decontamination migration', () => {
  it('removes trends24:howto-and-style from cooking', () => {
    db.prepare(
      `INSERT INTO categories (key, label, query, topic_sources) VALUES (?, ?, ?, ?)`
    ).run('social_cooking', 'Cooking', 'ytsearch10:home cooking recipe tutorial',
      '["trends24:howto-and-style","liked_tags:cooking"]')

    applyMigration(db)

    const result = JSON.parse(getTopicSources(db, 'social_cooking'))
    expect(result).not.toContain('trends24:howto-and-style')
    expect(result).toContain('liked_tags:cooking')
    expect(result).toContain('discovered_creators:social_cooking')
  })

  it('removes trends24:howto-and-style from design, keeps boosted_creators:5', () => {
    db.prepare(
      `INSERT INTO categories (key, label, query, topic_sources) VALUES (?, ?, ?, ?)`
    ).run('social_design', 'Design', 'ytsearch10:UI design figma tutorial',
      '["liked_tags:design,ux","trends24:howto-and-style","boosted_creators:5"]')

    applyMigration(db)

    const result = JSON.parse(getTopicSources(db, 'social_design'))
    expect(result).not.toContain('trends24:howto-and-style')
    expect(result).toContain('liked_tags:design,ux')
    expect(result).toContain('boosted_creators:5')
    expect(result).toContain('discovered_creators:social_design')
  })

  it('removes trends24:science-and-technology from tech', () => {
    db.prepare(
      `INSERT INTO categories (key, label, query, topic_sources) VALUES (?, ?, ?, ?)`
    ).run('social_tech', 'Tech & Gadgets', 'ytsearch10:best new tech gadgets',
      '["trends24:science-and-technology","liked_tags:tech"]')

    applyMigration(db)

    const result = JSON.parse(getTopicSources(db, 'social_tech'))
    expect(result).not.toContain('trends24:science-and-technology')
    expect(result).toContain('liked_tags:tech')
    expect(result).toContain('boosted_creators:3')
  })

  it('removes trends24:science-and-technology from AI, keeps liked_tags', () => {
    db.prepare(
      `INSERT INTO categories (key, label, query, topic_sources) VALUES (?, ?, ?, ?)`
    ).run('social_ai', 'AI & Coding', 'topic:liked_tags:ai',
      '["liked_tags:ai,vibe coding,claude tutorial,claude routines","trends24:science-and-technology"]')

    applyMigration(db)

    const result = JSON.parse(getTopicSources(db, 'social_ai'))
    expect(result).not.toContain('trends24:science-and-technology')
    expect(result).toContain('liked_tags:ai,vibe coding,claude tutorial,claude routines')
    expect(result).toContain('discovered_creators:social_ai')
  })

  it('is idempotent: second run is a no-op', () => {
    for (const [key, oldVal] of TOPIC_FIXES) {
      db.prepare(
        `INSERT INTO categories (key, label, query, topic_sources) VALUES (?, ?, ?, ?)`
      ).run(key, key, 'q', oldVal)
    }

    applyMigration(db)
    const first = TOPIC_FIXES.map(([k]) => getTopicSources(db, k))

    applyMigration(db)
    const second = TOPIC_FIXES.map(([k]) => getTopicSources(db, k))

    expect(second).toEqual(first)
  })

  it('skips rows whose topic_sources have already been customized', () => {
    const custom = '["liked_tags:cooking","custom_resolver:my_thing"]'
    db.prepare(
      `INSERT INTO categories (key, label, query, topic_sources) VALUES (?, ?, ?, ?)`
    ).run('social_cooking', 'Cooking', 'q', custom)

    applyMigration(db)

    expect(getTopicSources(db, 'social_cooking')).toBe(custom)
  })

  it('is a no-op on empty table', () => {
    applyMigration(db)
    expect(getTopicSources(db, 'social_cooking')).toBeUndefined()
  })

  it('leaves unrelated categories untouched', () => {
    const sportsSources = '["trends24:sports","liked_tags:carolina panthers,unc tar heels"]'
    db.prepare(
      `INSERT INTO categories (key, label, query, topic_sources) VALUES (?, ?, ?, ?), (?, ?, ?, ?)`
    ).run(
      'social_cooking', 'Cooking', 'q', '["trends24:howto-and-style","liked_tags:cooking"]',
      'social_sports', 'Sports', 'q', sportsSources
    )

    applyMigration(db)

    expect(getTopicSources(db, 'social_sports')).toBe(sportsSources)
  })
})
