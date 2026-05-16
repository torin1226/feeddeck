import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { buildReason, loadReasonSignals, PRIORITY } from '../recommendation-reason.js'

// ============================================================
// buildReason() — pure recommendation attribution helper
// (T2a, 2026-05-16)
// ============================================================

const baseSignals = {
  boostedCreators: new Set(['mkbhd', 'linus tech tips']),
  subscriptions: new Set(['veritasium', 'mkbhd']),
  likedTags: new Set(['tech', 'science']),
}

describe('buildReason', () => {
  it('returns creator match when uploader is in boostedCreators', () => {
    const result = buildReason({ uploader: 'MKBHD' }, baseSignals)
    expect(result).toEqual({ kind: 'creator', label: 'Because you watch MKBHD' })
  })

  it('returns subscription match when uploader is in subscriptions but not boostedCreators', () => {
    const signals = { ...baseSignals, boostedCreators: new Set() }
    const result = buildReason({ uploader: 'Veritasium' }, signals)
    expect(result).toEqual({ kind: 'subscription', label: 'From your subscriptions' })
  })

  it('returns tag match when a tag overlaps with likedTags', () => {
    const signals = { ...baseSignals, boostedCreators: new Set(), subscriptions: new Set() }
    const result = buildReason({ uploader: 'unknown', tags: ['gaming', 'Tech', 'food'] }, signals)
    expect(result).toEqual({ kind: 'tag', label: 'Because you liked tech' })
  })

  it('strips trends24: prefix from topicSource for topic fallback', () => {
    const signals = { boostedCreators: new Set(), subscriptions: new Set(), likedTags: new Set() }
    const result = buildReason({ topicSource: 'trends24:crypto news' }, signals)
    expect(result).toEqual({ kind: 'topic', label: 'Trending in crypto news' })
  })

  it('strips liked_tags: prefix from topicSource for topic fallback', () => {
    const signals = { boostedCreators: new Set(), subscriptions: new Set(), likedTags: new Set() }
    const result = buildReason({ topicSource: 'liked_tags:science' }, signals)
    expect(result).toEqual({ kind: 'topic', label: 'Trending in science' })
  })

  it('returns null when no signals match', () => {
    const signals = { boostedCreators: new Set(), subscriptions: new Set(), likedTags: new Set() }
    const result = buildReason({ uploader: 'nobody', tags: ['niche'] }, signals)
    expect(result).toBeNull()
  })

  it('creator beats subscription, tag, and topic when all match', () => {
    const signals = {
      boostedCreators: new Set(['mkbhd']),
      subscriptions: new Set(['mkbhd']),
      likedTags: new Set(['tech']),
    }
    const result = buildReason({ uploader: 'mkbhd', tags: ['tech'], topicSource: 'trends24:ai' }, signals)
    expect(result?.kind).toBe('creator')
  })

  it('returns null for null item', () => {
    expect(buildReason(null, baseSignals)).toBeNull()
  })

  it('returns null for undefined item', () => {
    expect(buildReason(undefined, baseSignals)).toBeNull()
  })

  it('tolerates missing signals keys (undefined boostedCreators, subscriptions, likedTags)', () => {
    expect(() => buildReason({ uploader: 'test', tags: ['tech'] }, {})).not.toThrow()
    expect(buildReason({ uploader: 'test', tags: ['tech'] }, {})).toBeNull()
  })

  it('uploader matching is case-insensitive and trims whitespace', () => {
    const result = buildReason({ uploader: '  MKBHD  ' }, baseSignals)
    expect(result).toEqual({ kind: 'creator', label: 'Because you watch   MKBHD  ' })
  })

  it('PRIORITY constant lists kinds in correct order', () => {
    expect(PRIORITY).toEqual(['creator', 'subscription', 'tag', 'topic'])
  })
})

// ============================================================
// loadReasonSignals() — lifted from feed.js + content.js
// 2026-05-16 auto-3 daily-critical-error-fix
// ============================================================

function makeSignalsDb() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE creator_boosts (creator TEXT, boost_score REAL);
    CREATE TABLE subscription_backups (handle TEXT);
    CREATE TABLE taste_profile (signal_type TEXT, signal_value TEXT, weight REAL);
  `)
  return db
}

describe('loadReasonSignals', () => {
  it('returns three Sets keyed creator/subscription/tag, lowercased and trimmed', () => {
    const db = makeSignalsDb()
    db.prepare('INSERT INTO creator_boosts (creator, boost_score) VALUES (?, ?)').run('  MKBHD  ', 2.5)
    db.prepare('INSERT INTO subscription_backups (handle) VALUES (?)').run('Veritasium')
    db.prepare("INSERT INTO taste_profile (signal_type, signal_value, weight) VALUES ('tag', ?, ?)").run('Tech', 1.0)

    const { boostedCreators, subscriptions, likedTags } = loadReasonSignals(db)
    expect(boostedCreators.has('mkbhd')).toBe(true)
    expect(subscriptions.has('veritasium')).toBe(true)
    expect(likedTags.has('tech')).toBe(true)
  })

  it('skips creator_boosts rows where boost_score <= 0', () => {
    const db = makeSignalsDb()
    db.prepare('INSERT INTO creator_boosts (creator, boost_score) VALUES (?, ?)').run('positive', 1.0)
    db.prepare('INSERT INTO creator_boosts (creator, boost_score) VALUES (?, ?)').run('zero', 0)
    db.prepare('INSERT INTO creator_boosts (creator, boost_score) VALUES (?, ?)').run('negative', -0.5)

    const { boostedCreators } = loadReasonSignals(db)
    expect(boostedCreators.has('positive')).toBe(true)
    expect(boostedCreators.has('zero')).toBe(false)
    expect(boostedCreators.has('negative')).toBe(false)
  })

  it('skips taste_profile rows with non-tag signal_type or weight <= 0', () => {
    const db = makeSignalsDb()
    db.prepare("INSERT INTO taste_profile VALUES ('tag', 'kept', 1)").run()
    db.prepare("INSERT INTO taste_profile VALUES ('creator', 'mkbhd', 1)").run()
    db.prepare("INSERT INTO taste_profile VALUES ('tag', 'zero-weight', 0)").run()

    const { likedTags } = loadReasonSignals(db)
    expect(likedTags.has('kept')).toBe(true)
    expect(likedTags.has('mkbhd')).toBe(false)
    expect(likedTags.has('zero-weight')).toBe(false)
  })

  it('tolerates missing tables without throwing (returns empty Sets)', () => {
    const db = new DatabaseSync(':memory:')
    expect(() => loadReasonSignals(db)).not.toThrow()
    const { boostedCreators, subscriptions, likedTags } = loadReasonSignals(db)
    expect(boostedCreators.size).toBe(0)
    expect(subscriptions.size).toBe(0)
    expect(likedTags.size).toBe(0)
  })

  it('returned signals plug into buildReason for end-to-end attribution', () => {
    const db = makeSignalsDb()
    db.prepare('INSERT INTO creator_boosts (creator, boost_score) VALUES (?, ?)').run('mkbhd', 2)
    const signals = loadReasonSignals(db)
    expect(buildReason({ uploader: 'MKBHD' }, signals)).toEqual({
      kind: 'creator',
      label: 'Because you watch MKBHD',
    })
  })
})
