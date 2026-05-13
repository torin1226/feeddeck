import { describe, it, expect, beforeEach } from 'vitest'

import {
  _CACHE_CAP_FOR_TESTS,
  _cacheSetForTests,
  _peekCacheForTests,
  _resetCacheForTests,
} from '../hooks/useAmbientColor'

// ============================================================
// useAmbientColor — FIFO cache cap regression suite.
//
// The module-level Map cache was unbounded before today. Long browse
// sessions through many hero items could grow the map without limit.
// Same shape as useFocusPreview's URL_CACHE_CAP from May 5. These tests
// pin the eviction behavior so a future change can't silently regress.
// ============================================================

describe('useAmbientColor cache cap', () => {
  beforeEach(() => {
    _resetCacheForTests()
  })

  it('keeps size at or below CACHE_CAP after many writes', () => {
    for (let i = 0; i < _CACHE_CAP_FOR_TESTS + 50; i++) {
      _cacheSetForTests(`https://example.com/img-${i}.jpg`, [i % 256, 0, 0])
    }
    expect(_peekCacheForTests().size).toBe(_CACHE_CAP_FOR_TESTS)
  })

  it('evicts oldest entries first (FIFO)', () => {
    for (let i = 0; i < _CACHE_CAP_FOR_TESTS + 5; i++) {
      _cacheSetForTests(`url-${i}`, [i, 0, 0])
    }
    const { keys } = _peekCacheForTests()
    // The first 5 inserted entries should have been evicted.
    for (let i = 0; i < 5; i++) {
      expect(keys).not.toContain(`url-${i}`)
    }
    // The most recent CACHE_CAP entries should still be present.
    expect(keys[0]).toBe(`url-5`)
    expect(keys[keys.length - 1]).toBe(`url-${_CACHE_CAP_FOR_TESTS + 4}`)
  })

  it('re-inserting an existing key moves it to the tail (LRU on write)', () => {
    _cacheSetForTests('a', [1, 0, 0])
    _cacheSetForTests('b', [2, 0, 0])
    _cacheSetForTests('c', [3, 0, 0])
    _cacheSetForTests('a', [9, 0, 0]) // re-insert
    const { keys } = _peekCacheForTests()
    expect(keys).toEqual(['b', 'c', 'a'])
  })

  it('caches null values (CORS-tainted images) without bypassing the cap', () => {
    for (let i = 0; i < _CACHE_CAP_FOR_TESTS + 10; i++) {
      _cacheSetForTests(`bad-${i}`, null)
    }
    expect(_peekCacheForTests().size).toBe(_CACHE_CAP_FOR_TESTS)
  })
})
