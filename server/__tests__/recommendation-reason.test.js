import { describe, it, expect } from 'vitest'
import { buildReason, PRIORITY } from '../recommendation-reason.js'

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
