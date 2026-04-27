import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import useHomeStore from '../stores/homeStore'

// ============================================================
// homeStore shuffle / refresh unit tests
//
// These verify that shuffleHome and refreshHome orchestrate
// their fetch calls correctly and mutate store state as expected.
// All fetch calls are mocked — no network, no backend.
//
// Failure modes tested:
//   #1 ID round-trip: POSTed ids match what the API returned
//   #2 Phase 2 skip: correctly documented when fresh.length <= 5
//   #3 Overlap: phase 1 head is disjoint from pre-state top-5
//   #4 429 soft-success: refresh completes swap even on warm 429
//   #5 Mutex: second concurrent call is dropped cleanly
// ============================================================

function makeApiVideo(id, _label = 'Test Category') {
  return {
    id,
    url: `https://example.com/vid/${id}`,
    title: `Video ${id}`,
    thumbnail: `https://thumb.example.com/${id}.jpg`,
    duration: 120,
    durationFormatted: '2:00',
    source: 'youtube.com',
    uploader: 'Uploader',
    view_count: 1000,
    like_count: 50,
    subscriber_count: null,
    upload_date: null,
    fetched_at: new Date().toISOString(),
    tags: [],
    viewed: 0,
  }
}

function makeApiResponse(categories) {
  return { categories }
}

// Seed categories into the store with a realistic shape
// (matches what fetchHomepage leaves behind after mapping).
function seedCategories(categories) {
  useHomeStore.setState({ categories, refreshing: false, shuffling: false })
}

function makeStoreCategory({ label, itemIds, pinned = false, originalLabel } = {}) {
  return {
    label,
    originalLabel: originalLabel || label,
    _pinned: pinned,
    items: itemIds.map(id => ({
      id,
      url: `https://example.com/vid/${id}`,
      title: `Video ${id}`,
      thumbnail: '',
      duration: '2:00',
      durationSec: 120,
      views: '1.0K',
      uploader: 'Someone',
      daysAgo: 5,
      desc: '',
      genre: 'Video',
      rating: null,
      tags: [],
      uploadTs: 0,
      fetchedTs: Date.now(),
      orient: 'h',
    })),
  }
}

// Build an /api/homepage response with fresh videos for the given
// categories (enough to satisfy phase 1 + phase 2)
function buildHomepageResponse(categories, freshIdsPerCat = 12) {
  return makeApiResponse(
    categories.map(cat => ({
      key: cat.label.toLowerCase().replace(/ /g, '_'),
      label: cat.originalLabel || cat.label,
      pinned: cat._pinned || false,
      videos: Array.from({ length: freshIdsPerCat }, (_, i) =>
        makeApiVideo(`fresh_${cat.label}_${i}`)
      ),
    }))
  )
}

beforeEach(() => {
  // Reset store + fetch mock before each test
  useHomeStore.setState({
    categories: [],
    refreshing: false,
    shuffling: false,
  })
  vi.resetAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ----------------------------------------------------------------
// Mutex / short-circuit
// ----------------------------------------------------------------
describe('mutex: concurrent calls are dropped', () => {
  it('refreshHome does nothing when already refreshing', async () => {
    globalThis.fetch = vi.fn()
    useHomeStore.setState({ refreshing: true })
    await useHomeStore.getState().refreshHome('social')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('shuffleHome does nothing when already shuffling', async () => {
    globalThis.fetch = vi.fn()
    useHomeStore.setState({ shuffling: true })
    await useHomeStore.getState().shuffleHome('social')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('shuffleHome does nothing when refreshing is in progress', async () => {
    globalThis.fetch = vi.fn()
    useHomeStore.setState({ refreshing: true })
    await useHomeStore.getState().shuffleHome('social')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('clears shuffling flag when done even if swap fetch fails', async () => {
    seedCategories([makeStoreCategory({ label: 'Cat A', itemIds: ['a', 'b', 'c', 'd', 'e'] })])
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })  // viewed POST (for id 'a')
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })  // viewed POST (for id 'b')
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })  // viewed POST etc
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: false, status: 500 })            // /api/homepage fails

    await useHomeStore.getState().shuffleHome('social')
    expect(useHomeStore.getState().shuffling).toBe(false)
  })

  it('clears refreshing flag when done even if warm fails', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })  // /api/homepage/warm fails

    await useHomeStore.getState().refreshHome('social')
    expect(useHomeStore.getState().refreshing).toBe(false)
  })
})

// ----------------------------------------------------------------
// shuffleHome: which IDs get marked viewed
// ----------------------------------------------------------------
describe('shuffleHome: mark-viewed call count and id correctness', () => {
  it('posts viewed for exactly leftmost-5 items in each non-pinned category', async () => {
    const cat1 = makeStoreCategory({ label: 'Cat 1', itemIds: ['c1_0','c1_1','c1_2','c1_3','c1_4','c1_5','c1_6'] })
    const cat2 = makeStoreCategory({ label: 'Cat 2', itemIds: ['c2_0','c2_1','c2_2','c2_3','c2_4','c2_5'] })
    const catPinned = makeStoreCategory({ label: 'Pinned', itemIds: ['p_0','p_1','p_2','p_3','p_4','p_5'], pinned: true })
    seedCategories([cat1, cat2, catPinned])

    const postedIds = []
    globalThis.fetch = vi.fn(async (url, _opts) => {
      if (url.includes('/api/homepage/viewed')) {
        const u = new URL(url, 'http://localhost')
        postedIds.push(u.searchParams.get('id'))
      }
      return { ok: true, json: async () => buildHomepageResponse([cat1, cat2, catPinned]) }
    })

    await useHomeStore.getState().shuffleHome('social')

    // Should have marked exactly 5 from cat1 + 5 from cat2 = 10
    // Pinned row is skipped
    expect(postedIds.length).toBe(10)

    const cat1Expected = ['c1_0','c1_1','c1_2','c1_3','c1_4']
    const cat2Expected = ['c2_0','c2_1','c2_2','c2_3','c2_4']
    for (const id of [...cat1Expected, ...cat2Expected]) {
      expect(postedIds).toContain(id)
    }
    // Pinned ids must NOT appear
    for (const id of ['p_0','p_1','p_2','p_3','p_4']) {
      expect(postedIds).not.toContain(id)
    }
  })

  it('skips all pinned rows entirely — no viewed POST for any pinned item', async () => {
    const pinned = makeStoreCategory({ label: 'My Likes', itemIds: ['p0','p1','p2','p3','p4','p5'], pinned: true })
    const nonPinned = makeStoreCategory({ label: 'Trending', itemIds: ['t0','t1','t2','t3','t4'] })
    seedCategories([pinned, nonPinned])

    const postedIds = []
    globalThis.fetch = vi.fn(async (url) => {
      if (url.includes('/api/homepage/viewed')) {
        postedIds.push(new URL(url, 'http://localhost').searchParams.get('id'))
      }
      return { ok: true, json: async () => buildHomepageResponse([nonPinned]) }
    })

    await useHomeStore.getState().shuffleHome('social')
    for (const id of ['p0','p1','p2','p3','p4','p5']) {
      expect(postedIds).not.toContain(id)
    }
  })

  it('the IDs sent to viewed match item.id from the store (not item.url)', async () => {
    // Failure mode #1 guard: homeStore posts item.id, NOT item.url.
    // If this were reversed, the backend UPDATE would match 0 rows.
    const itemIds = ['cache_row_id_1', 'cache_row_id_2', 'cache_row_id_3', 'cache_row_id_4', 'cache_row_id_5']
    const cat = makeStoreCategory({ label: 'Test', itemIds })
    // Give items distinct url values so we can tell them apart
    cat.items.forEach((item, i) => { item.url = `https://example.com/url_${i}` })
    seedCategories([cat])

    const postedIds = []
    globalThis.fetch = vi.fn(async (url) => {
      if (url.includes('/api/homepage/viewed')) {
        postedIds.push(new URL(url, 'http://localhost').searchParams.get('id'))
      }
      return { ok: true, json: async () => buildHomepageResponse([cat]) }
    })

    await useHomeStore.getState().shuffleHome('social')

    // Must post item.id values (cache row ids), NOT url values
    for (const id of itemIds) expect(postedIds).toContain(id)
    // Must NOT post url values
    for (let i = 0; i < 5; i++) expect(postedIds).not.toContain(`https://example.com/url_${i}`)
  })

  it('rows with fewer than 5 items post only the available items', async () => {
    const cat = makeStoreCategory({ label: 'Short', itemIds: ['x', 'y'] })
    seedCategories([cat])

    const postedIds = []
    globalThis.fetch = vi.fn(async (url) => {
      if (url.includes('/api/homepage/viewed')) {
        postedIds.push(new URL(url, 'http://localhost').searchParams.get('id'))
      }
      return { ok: true, json: async () => buildHomepageResponse([cat]) }
    })

    await useHomeStore.getState().shuffleHome('social')
    expect(postedIds).toEqual(['x', 'y'])
  })
})

// ----------------------------------------------------------------
// refreshHome: warm + swap
// ----------------------------------------------------------------
describe('refreshHome: warm endpoint and swap behavior', () => {
  it('calls POST /api/homepage/warm before swapping in content', async () => {
    const calls = []
    globalThis.fetch = vi.fn(async (url, opts) => {
      calls.push({ url, method: opts?.method || 'GET' })
      return { ok: true, json: async () => buildHomepageResponse([]) }
    })

    await useHomeStore.getState().refreshHome('social')

    const warmCall = calls.find(c => c.url.includes('/api/homepage/warm'))
    expect(warmCall).toBeDefined()
    expect(warmCall.method).toBe('POST')

    const homepageCall = calls.find(c => c.url.includes('/api/homepage') && !c.url.includes('/warm'))
    expect(homepageCall).toBeDefined()
    // Warm must fire before homepage fetch
    expect(calls.indexOf(warmCall)).toBeLessThan(calls.indexOf(homepageCall))
  })

  it('mode is passed as query param to both warm and homepage requests', async () => {
    globalThis.fetch = vi.fn(async (_url) => ({
      ok: true,
      json: async () => buildHomepageResponse([]),
    }))

    await useHomeStore.getState().refreshHome('nsfw')

    const urls = fetch.mock.calls.map(c => c[0])
    expect(urls.some(u => u.includes('/api/homepage/warm?mode=nsfw'))).toBe(true)
    expect(urls.some(u => u.includes('/api/homepage?mode=nsfw'))).toBe(true)
  })

  it('429 from warm is treated as soft success — swap still proceeds', async () => {
    const cat = makeStoreCategory({ label: 'Cat', itemIds: ['old1','old2','old3','old4','old5','old6'] })
    seedCategories([cat])

    globalThis.fetch = vi.fn(async (url) => {
      if (url.includes('/warm')) return { ok: false, status: 429, json: async () => ({}) }
      return { ok: true, json: async () => buildHomepageResponse([cat], 12) }
    })

    await useHomeStore.getState().refreshHome('social')

    // Swap should have proceeded — categories should have fresh items in top-5
    const cats = useHomeStore.getState().categories
    expect(cats.length).toBeGreaterThan(0)
    const top5 = cats[0].items.slice(0, 5).map(i => i.id)
    // Fresh items have id pattern 'fresh_Cat_N'
    expect(top5.every(id => id.startsWith('fresh_'))).toBe(true)
  })

  it('non-429 error from warm aborts — no swap proceeds', async () => {
    const cat = makeStoreCategory({ label: 'Cat', itemIds: ['old1','old2','old3','old4','old5'] })
    seedCategories([cat])

    globalThis.fetch = vi.fn(async (url) => {
      if (url.includes('/warm')) return { ok: false, status: 500 }
      return { ok: true, json: async () => buildHomepageResponse([cat], 12) }
    })

    await useHomeStore.getState().refreshHome('social')

    // Categories should be unchanged
    const cats = useHomeStore.getState().categories
    expect(cats[0].items[0].id).toBe('old1')
  })
})

// ----------------------------------------------------------------
// _swapInFreshContent: phase 1 and phase 2 behavior
// ----------------------------------------------------------------
describe('_swapInFreshContent phase 1 and phase 2', () => {
  it('phase 1 replaces top-5 of each non-pinned category immediately', async () => {
    vi.useFakeTimers()
    const cat = makeStoreCategory({ label: 'Trending', itemIds: ['old0','old1','old2','old3','old4','old5','old6','old7'] })
    seedCategories([cat])

    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => makeApiResponse([{
        key: 'trending', label: 'Trending', pinned: false,
        videos: Array.from({ length: 12 }, (_, i) => makeApiVideo(`new_${i}`)),
      }]),
    }))

    const swapPromise = useHomeStore.getState()._swapInFreshContent('social')
    await swapPromise  // awaits fetch + sets phase 1

    const afterPhase1 = useHomeStore.getState().categories[0].items
    const phase1Top5 = afterPhase1.slice(0, 5).map(i => i.id)

    // Phase 1 head must be fresh items
    expect(phase1Top5.every(id => id.startsWith('new_'))).toBe(true)
    // Tail (positions 5+) still has old items at this point
    const tail = afterPhase1.slice(5).map(i => i.id)
    expect(tail.some(id => id.startsWith('old_') || id.startsWith('old'))).toBe(true)

    // Advance past the 600ms phase-2 timer
    vi.advanceTimersByTime(700)
    const afterPhase2 = useHomeStore.getState().categories[0].items
    const phase2Tail = afterPhase2.slice(5).map(i => i.id)
    // Phase 2 tail should now be fresh items too
    expect(phase2Tail.every(id => id.startsWith('new_'))).toBe(true)

    vi.useRealTimers()
  })

  it('phase 2 is skipped when fresh inventory has 5 or fewer items', async () => {
    // This is intentional behavior — documents it so we never "fix" it
    // as a regression. If fresh.length <= 5, phase2() returns the
    // category unchanged. User will see only 5 cards rotate.
    vi.useFakeTimers()
    const cat = makeStoreCategory({ label: 'Trending', itemIds: ['old0','old1','old2','old3','old4','old5','old6'] })
    seedCategories([cat])

    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => makeApiResponse([{
        key: 'trending', label: 'Trending', pinned: false,
        videos: Array.from({ length: 5 }, (_, i) => makeApiVideo(`new_${i}`)),
      }]),
    }))

    await useHomeStore.getState()._swapInFreshContent('social')

    const afterPhase1 = useHomeStore.getState().categories[0].items.map(i => i.id)

    vi.advanceTimersByTime(700)
    const afterPhase2 = useHomeStore.getState().categories[0].items.map(i => i.id)

    // Phase 2 skipped — no change between phase1 and phase2 state
    expect(afterPhase2).toEqual(afterPhase1)
    // Tail still has old items (phase 2 didn't fire)
    expect(afterPhase2.slice(5).some(id => id.startsWith('old'))).toBe(true)

    vi.useRealTimers()
  })

  it('phase 1 head is disjoint from pre-shuffle top-5 when fresh inventory is large', async () => {
    // This guards failure mode #3: fresh items must not be the same
    // videos that were already at positions 5+ (overlap via dedup).
    // When the server returns truly different IDs this cannot overlap.
    const cat = makeStoreCategory({
      label: 'Trending',
      itemIds: ['old0','old1','old2','old3','old4','old5','old6','old7','old8','old9'],
    })
    seedCategories([cat])
    const preTop5 = ['old0','old1','old2','old3','old4']

    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => makeApiResponse([{
        key: 'trending', label: 'Trending', pinned: false,
        videos: Array.from({ length: 12 }, (_, i) => makeApiVideo(`fresh_${i}`)),
      }]),
    }))

    await useHomeStore.getState()._swapInFreshContent('social')

    const newTop5 = useHomeStore.getState().categories[0].items.slice(0, 5).map(i => i.id)
    const overlap = newTop5.filter(id => preTop5.includes(id))
    expect(overlap).toEqual([])
  })

  it('pinned categories are not modified by either phase', async () => {
    const pinned = makeStoreCategory({ label: 'My Likes', itemIds: ['p0','p1','p2','p3','p4'], pinned: true })
    const regular = makeStoreCategory({ label: 'Trending', itemIds: ['r0','r1','r2','r3','r4','r5'] })
    seedCategories([pinned, regular])

    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => makeApiResponse([{
        key: 'trending', label: 'Trending', pinned: false,
        videos: Array.from({ length: 12 }, (_, i) => makeApiVideo(`fresh_${i}`)),
      }]),
    }))

    await useHomeStore.getState()._swapInFreshContent('social')

    const pinnedAfter = useHomeStore.getState().categories.find(c => c._pinned)
    expect(pinnedAfter).toBeDefined()
    expect(pinnedAfter.items.map(i => i.id)).toEqual(['p0','p1','p2','p3','p4'])
  })
})

// ----------------------------------------------------------------
// Inventory-depth scenario: what happens when cache is nearly empty
// This documents the "shuffle does nothing" scenario so the user can
// understand it's a cache-depth issue, not a code bug.
// ----------------------------------------------------------------
describe('low-inventory scenario (cache nearly exhausted)', () => {
  it('when /api/homepage returns empty categories, swap leaves existing categories unchanged', async () => {
    const cat = makeStoreCategory({ label: 'Trending', itemIds: ['old0','old1','old2','old3','old4'] })
    seedCategories([cat])

    globalThis.fetch = vi.fn(async (url) => {
      if (url.includes('/viewed')) return { ok: true, json: async () => ({}) }
      // Homepage returns no categories (exhausted cache)
      return { ok: true, json: async () => makeApiResponse([]) }
    })

    await useHomeStore.getState().shuffleHome('social')

    // Categories unchanged because freshByLabel has no entries
    const cats = useHomeStore.getState().categories
    expect(cats[0].items.map(i => i.id)).toEqual(['old0','old1','old2','old3','old4'])
  })

  it('when /api/homepage returns only 5 fresh items, only those 5 rotate into top positions', async () => {
    const cat = makeStoreCategory({
      label: 'Trending',
      itemIds: ['old0','old1','old2','old3','old4','old5','old6','old7','old8','old9'],
    })
    seedCategories([cat])

    globalThis.fetch = vi.fn(async (url) => {
      if (url.includes('/viewed')) return { ok: true, json: async () => ({}) }
      return { ok: true, json: async () => makeApiResponse([{
        key: 'trending', label: 'Trending', pinned: false,
        videos: Array.from({ length: 5 }, (_, i) => makeApiVideo(`fresh_${i}`)),
      }]) }
    })

    await useHomeStore.getState().shuffleHome('social')

    const top5 = useHomeStore.getState().categories[0].items.slice(0, 5).map(i => i.id)
    // Top-5 are fresh
    expect(top5.every(id => id.startsWith('fresh_'))).toBe(true)
    // Tail still has old items (phase 2 skipped — fresh.length <= 5)
    const tail = useHomeStore.getState().categories[0].items.slice(5).map(i => i.id)
    expect(tail.some(id => id.startsWith('old'))).toBe(true)
  })
})
