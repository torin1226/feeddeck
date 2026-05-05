import { describe, it, expect, beforeEach } from 'vitest'
import useHomeStore from '../stores/homeStore'

// ============================================================
// homeStore exposedItemIds LRU cap (2026-05-05 Resource lens)
//
// /api/feed/next serializes the full exposed-id Set into the
// excludeIds= query parameter. Without a cap, long browse
// sessions push the URL past Express's ~8 KB query budget and
// /feed/next starts returning 414 / 500. markExposed must
// FIFO-evict past N=200 so the URL stays bounded.
// ============================================================

const EXPECTED_CAP = 200

beforeEach(() => {
  useHomeStore.setState({ exposedItemIds: new Set() })
  try { sessionStorage.removeItem('fd-exposed-ids') } catch {}
})

const makeItems = (count, prefix = 'id') =>
  Array.from({ length: count }, (_, i) => ({ id: `${prefix}-${i}` }))

describe('homeStore.markExposed cap', () => {
  it('stores all items when total stays under the cap', () => {
    useHomeStore.getState().markExposed(makeItems(50))
    expect(useHomeStore.getState().exposedItemIds.size).toBe(50)
  })

  it('caps the set at 200 once exposures exceed the limit', () => {
    useHomeStore.getState().markExposed(makeItems(EXPECTED_CAP + 50))
    expect(useHomeStore.getState().exposedItemIds.size).toBe(EXPECTED_CAP)
  })

  it('FIFO-evicts the oldest entry first', () => {
    useHomeStore.getState().markExposed(makeItems(EXPECTED_CAP))
    useHomeStore.getState().markExposed([{ id: 'newest' }])
    const ids = useHomeStore.getState().exposedItemIds
    expect(ids.size).toBe(EXPECTED_CAP)
    expect(ids.has('id-0')).toBe(false)
    expect(ids.has('id-1')).toBe(true)
    expect(ids.has('newest')).toBe(true)
  })

  it('survives the URL-length stress test (cap+50 fake exposures)', () => {
    useHomeStore.getState().markExposed(makeItems(EXPECTED_CAP + 50))
    const exposed = useHomeStore.getState().exposedItemIds
    const param = [...exposed].join(',')
    // Even with 200 long composite IDs, the param has to fit comfortably
    // inside Express's default ~8 KB query budget.
    expect(param.length).toBeLessThan(8000)
    expect(exposed.size).toBe(EXPECTED_CAP)
  })

  it('persists the capped set to sessionStorage', () => {
    useHomeStore.getState().markExposed(makeItems(EXPECTED_CAP + 10))
    const stored = JSON.parse(sessionStorage.getItem('fd-exposed-ids'))
    expect(stored).toHaveLength(EXPECTED_CAP)
    // Oldest 10 evicted; tail keeps newest IDs.
    expect(stored.includes('id-0')).toBe(false)
    expect(stored.includes(`id-${EXPECTED_CAP + 9}`)).toBe(true)
  })
})
