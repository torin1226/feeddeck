import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import useHomeStore from '../stores/homeStore'

// ============================================================
// Regression: /api/tags/preferences fetch contract.
//
// Two coupled bugs lived here:
// 1. URL omitted ?mode=, so server's getMode() default ('social')
//    leaked social tag preferences into NSFW homepage scoring.
// 2. Response was parsed as { liked: [...], disliked: [...] } but
//    the server returns { preferences: [{ tag, preference }] } —
//    so likedTags was always an empty Set and the category-boost
//    + label-personalization branch was effectively dead code.
//
// Both fixed 2026-05-14. This test guards both.
// ============================================================

beforeEach(() => {
  useHomeStore.setState({
    heroItem: null,
    carouselItems: [],
    categories: [],
    top10: [],
    fetchError: null,
    homepageState: 'ready',
  })
  vi.resetAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

function mockFetchSequence(homepageBody, prefsBody) {
  const calls = []
  globalThis.fetch = vi.fn().mockImplementation(async (url) => {
    calls.push(typeof url === 'string' ? url : url.toString())
    if (typeof url === 'string' && url.includes('/api/tags/preferences')) {
      return { ok: true, json: async () => prefsBody }
    }
    if (typeof url === 'string' && url.includes('/api/recommendations/trail')) {
      return { ok: true, json: async () => ({ items: [], count: 0 }) }
    }
    return { ok: true, json: async () => homepageBody }
  })
  return calls
}

function singleVideoHomepage() {
  return {
    state: 'ready',
    categories: [
      {
        key: 'social_news',
        label: 'News',
        videos: [{
          id: 'v1', url: 'https://example.com/v1', title: 'V1',
          thumbnail: 'https://example.com/t1.jpg', duration: 60, source: 'youtube',
          uploader: 'Chan', view_count: 100, like_count: 5,
          upload_date: '2026-04-30', tags: [],
        }],
      },
    ],
  }
}

describe('fetchHomepage: /api/tags/preferences contract', () => {
  it('passes mode= in the URL so server scoping returns the right set', async () => {
    const calls = mockFetchSequence(singleVideoHomepage(), { preferences: [] })

    await useHomeStore.getState().fetchHomepage('nsfw')

    const prefCall = calls.find(u => u.includes('/api/tags/preferences'))
    expect(prefCall).toBeTruthy()
    expect(prefCall).toContain('mode=nsfw')
  })

  it('passes mode=social when fetching the social homepage', async () => {
    const calls = mockFetchSequence(singleVideoHomepage(), { preferences: [] })

    await useHomeStore.getState().fetchHomepage('social')

    const prefCall = calls.find(u => u.includes('/api/tags/preferences'))
    expect(prefCall).toBeTruthy()
    expect(prefCall).toContain('mode=social')
  })

  it('parses { preferences: [{tag, preference}] } and boosts categories with liked tags', async () => {
    // Each category needs enough items to survive the carousel + Top10 claims
    // and still have something left for scoring + display.
    const makeVideo = (id, tags) => ({
      id, url: `https://example.com/${id}`, title: id,
      thumbnail: `https://example.com/${id}.jpg`, duration: 60, source: 'youtube',
      uploader: 'Chan', view_count: 100, like_count: 5,
      upload_date: '2026-04-30', tags,
    })
    mockFetchSequence(
      {
        state: 'ready',
        categories: [
          {
            key: 'social_a',
            label: 'A',
            videos: Array.from({ length: 30 }, (_, i) => makeVideo(`a${i}`, ['cooking'])),
          },
          {
            key: 'social_b',
            label: 'B',
            videos: Array.from({ length: 30 }, (_, i) => makeVideo(`b${i}`, ['weather'])),
          },
        ],
      },
      { preferences: [{ tag: 'cooking', preference: 'liked' }] }
    )

    await useHomeStore.getState().fetchHomepage('social')

    const cats = useHomeStore.getState().categories
    expect(cats.length).toBeGreaterThan(0)
    // Category A (liked tag) must be ordered before Category B (neutral).
    const aIdx = cats.findIndex(c => c._key === 'social_a')
    const bIdx = cats.findIndex(c => c._key === 'social_b')
    expect(aIdx).toBeGreaterThanOrEqual(0)
    expect(bIdx).toBeGreaterThanOrEqual(0)
    expect(aIdx).toBeLessThan(bIdx)
  })

  it('tolerates a missing/malformed response without crashing', async () => {
    mockFetchSequence(
      {
        state: 'ready',
        categories: [
          {
            key: 'social_a',
            label: 'A',
            videos: [{
              id: 'a1', url: 'https://example.com/a1', title: 'A1',
              thumbnail: 'https://example.com/at.jpg', duration: 60, source: 'youtube',
              uploader: 'AChan', view_count: 100, like_count: 5,
              upload_date: '2026-04-30', tags: [],
            }],
          },
        ],
      },
      { /* no preferences key at all */ }
    )

    await expect(useHomeStore.getState().fetchHomepage('social')).resolves.not.toThrow()
    expect(useHomeStore.getState().homepageState).toBe('ready')
  })
})
