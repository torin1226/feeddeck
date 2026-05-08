import { describe, it, expect } from 'vitest'
import { classify, EMPTY_THRESHOLD, LOW_THRESHOLD } from '../scripts/row-health-report.mjs'

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
