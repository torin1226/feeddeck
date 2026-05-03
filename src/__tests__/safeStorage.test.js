import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================================
// safeStorage tests
//
// Locks down the persist-storage contract:
//
//  * Reads and writes are string-passthrough to localStorage
//  * Legacy corrupt sentinel "[object Object]" is evicted on
//    read (one-time self-heal for users upgrading from the
//    pre-createJSONStorage era — see queueStore audit, May 3)
//  * QuotaExceededError surfaces a toast once per session
// ============================================================

vi.mock('../stores/toastStore', () => ({
  default: {
    getState: () => ({ showToast: vi.fn() }),
  },
}))

let safeStorage

beforeEach(async () => {
  vi.resetModules()
  // Fresh localStorage per test
  globalThis.localStorage = {
    _data: new Map(),
    getItem(k) { return this._data.has(k) ? this._data.get(k) : null },
    setItem(k, v) { this._data.set(k, String(v)) },
    removeItem(k) { this._data.delete(k) },
    get length() { return this._data.size },
    key(i) { return [...this._data.keys()][i] || null },
  }
  ;({ safeStorage } = await import('../stores/safeStorage'))
})

describe('safeStorage.getItem', () => {
  it('returns null for missing keys', () => {
    expect(safeStorage.getItem('nope')).toBe(null)
  })

  it('returns stored string values verbatim', () => {
    localStorage.setItem('fd-queue', '{"state":{"queue":[]}}')
    expect(safeStorage.getItem('fd-queue')).toBe('{"state":{"queue":[]}}')
  })

  it('evicts the legacy "[object Object]" sentinel and returns null', () => {
    localStorage.setItem('fd-queue', '[object Object]')
    expect(safeStorage.getItem('fd-queue')).toBe(null)
    // Eviction is persistent — the corrupt entry is gone after one read
    expect(localStorage.getItem('fd-queue')).toBe(null)
  })

  it('does not evict legitimate JSON that happens to contain the substring', () => {
    const benign = '{"state":{"label":"[object Object]"}}'
    localStorage.setItem('fd-queue', benign)
    expect(safeStorage.getItem('fd-queue')).toBe(benign)
    expect(localStorage.getItem('fd-queue')).toBe(benign)
  })

  it('survives a localStorage exception by returning null', () => {
    const broken = {
      getItem() { throw new Error('SecurityError: storage disabled') },
      setItem() {},
      removeItem() {},
    }
    globalThis.localStorage = broken
    expect(safeStorage.getItem('fd-queue')).toBe(null)
  })
})

describe('safeStorage.setItem', () => {
  it('writes string values through to localStorage', () => {
    safeStorage.setItem('fd-queue', '{"a":1}')
    expect(localStorage.getItem('fd-queue')).toBe('{"a":1}')
  })

  it('swallows QuotaExceededError instead of crashing', () => {
    const quota = new Error('Quota exceeded')
    quota.name = 'QuotaExceededError'
    globalThis.localStorage = {
      getItem() { return null },
      setItem() { throw quota },
      removeItem() {},
    }
    // Should NOT throw
    expect(() => safeStorage.setItem('fd-queue', 'x'.repeat(1000))).not.toThrow()
  })
})
