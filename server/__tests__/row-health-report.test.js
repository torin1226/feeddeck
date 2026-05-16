import { describe, it, expect } from 'vitest'
import { classify, classifyAudio, EMPTY_THRESHOLD, LOW_THRESHOLD } from '../scripts/row-health-report.mjs'

// =============================================================
// Threshold contract for the daily hydration script.
//
// classify() drives the silent-killer alarm. fresh_unviewed === 0
// means a category has gone dark even though the source is still
// present in the registry — the same shape that hid trends24,
// social_shorts, and RedGifs for days at a time. The script's
// non-zero exit is wired to that single signal.
// =============================================================

describe('row-health-report.classify', () => {
  it('flags fresh_unviewed = 0 categories as empty', () => {
    const r = classify([
      { key: 'a', label: 'A', fresh_unviewed: 0, unviewed_total: 12, total: 50 },
      { key: 'b', label: 'B', fresh_unviewed: 8, unviewed_total: 12, total: 50 },
    ])
    expect(r.empty.map(c => c.key)).toEqual(['a'])
    expect(r.low).toEqual([])
    expect(r.total).toBe(2)
  })

  it('flags fresh_unviewed = 1..LOW_THRESHOLD-1 as low', () => {
    const r = classify([
      { key: 'a', label: 'A', fresh_unviewed: 1, unviewed_total: 1, total: 5 },
      { key: 'b', label: 'B', fresh_unviewed: LOW_THRESHOLD - 1, unviewed_total: 4, total: 10 },
      { key: 'c', label: 'C', fresh_unviewed: LOW_THRESHOLD, unviewed_total: 5, total: 10 },
    ])
    expect(r.empty).toEqual([])
    expect(r.low.map(c => c.key)).toEqual(['a', 'b'])
  })

  it('treats LOW_THRESHOLD as healthy (boundary)', () => {
    const r = classify([
      { key: 'edge', label: 'Edge', fresh_unviewed: LOW_THRESHOLD, unviewed_total: 5, total: 10 },
    ])
    expect(r.empty).toEqual([])
    expect(r.low).toEqual([])
  })

  it('keeps empty + low arrays disjoint and ordered as input', () => {
    const r = classify([
      { key: 'a', label: 'A', fresh_unviewed: 0, unviewed_total: 0, total: 0 },
      { key: 'b', label: 'B', fresh_unviewed: 2, unviewed_total: 2, total: 5 },
      { key: 'c', label: 'C', fresh_unviewed: 0, unviewed_total: 1, total: 7 },
      { key: 'd', label: 'D', fresh_unviewed: 99, unviewed_total: 99, total: 200 },
    ])
    expect(r.empty.map(c => c.key)).toEqual(['a', 'c'])
    expect(r.low.map(c => c.key)).toEqual(['b'])
    expect(r.total).toBe(4)
  })

  it('handles an empty category list', () => {
    const r = classify([])
    expect(r.empty).toEqual([])
    expect(r.low).toEqual([])
    expect(r.total).toBe(0)
  })

  it('exposes the silent-killer threshold as 0', () => {
    expect(EMPTY_THRESHOLD).toBe(0)
  })
})

// =============================================================
// Audio surface classifier. Mirrors the same silent-killer +
// soft-warn split: total === 0 is a hard fail (empty source),
// and a single distinct source_domain OR creator with content
// present is a "collapsed" warning (the 2026-05-16 symptom
// where the audio cache held one creator from a one-shot
// backfill while the live fetcher was a no-op).
// =============================================================

describe('row-health-report.classifyAudio', () => {
  it('flags total = 0 as empty (silent-killer)', () => {
    const r = classifyAudio({ total: 0, unrated: 0, bySource: [], byCreator: [] })
    expect(r.empty).toBe(true)
    expect(r.collapsed).toBe(false)
    expect(r.total).toBe(0)
  })

  it('flags single-source content as collapsed', () => {
    const r = classifyAudio({
      total: 13,
      unrated: 13,
      bySource: [{ source_domain: 'reddit.com', n: 13 }],
      byCreator: [{ creator: 'mycatwithclaws', n: 13 }],
    })
    expect(r.empty).toBe(false)
    expect(r.collapsed).toBe(true)
    expect(r.sources).toHaveLength(1)
    expect(r.creators).toHaveLength(1)
  })

  it('flags single-creator-but-multi-source content as collapsed', () => {
    const r = classifyAudio({
      total: 20,
      unrated: 20,
      bySource: [
        { source_domain: 'reddit.com', n: 10 },
        { source_domain: 'soundgasm.net', n: 10 },
      ],
      byCreator: [{ creator: 'mycatwithclaws', n: 20 }],
    })
    expect(r.collapsed).toBe(true)
  })

  it('treats multi-source + multi-creator as healthy', () => {
    const r = classifyAudio({
      total: 200,
      unrated: 50,
      bySource: [
        { source_domain: 'reddit.com', n: 120 },
        { source_domain: 'soundgasm.net', n: 80 },
      ],
      byCreator: [
        { creator: 'a', n: 50 },
        { creator: 'b', n: 50 },
        { creator: 'c', n: 100 },
      ],
    })
    expect(r.empty).toBe(false)
    expect(r.collapsed).toBe(false)
  })

  it('filters out null/empty source_domain and creator entries from diversity counts', () => {
    const r = classifyAudio({
      total: 10,
      unrated: 10,
      bySource: [
        { source_domain: 'reddit.com', n: 5 },
        { source_domain: null, n: 3 },
        { source_domain: '', n: 2 },
      ],
      byCreator: [
        { creator: 'a', n: 5 },
        { creator: null, n: 3 },
        { creator: 'b', n: 2 },
      ],
    })
    expect(r.sources).toHaveLength(1)
    expect(r.creators).toHaveLength(2)
    // 1 source after filtering → collapsed
    expect(r.collapsed).toBe(true)
  })

  it('handles missing / malformed stats defensively', () => {
    expect(classifyAudio(null)).toMatchObject({ total: 0, empty: true, collapsed: false })
    expect(classifyAudio(undefined)).toMatchObject({ total: 0, empty: true, collapsed: false })
    expect(classifyAudio({})).toMatchObject({ total: 0, empty: true, collapsed: false })
    expect(classifyAudio({ total: 'banana', bySource: null, byCreator: 'oops' }))
      .toMatchObject({ total: 0, empty: true, sources: [], creators: [] })
  })
})
