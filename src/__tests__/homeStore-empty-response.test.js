import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import useHomeStore from '../stores/homeStore'

// ============================================================
// Regression: /api/homepage returning empty / state:'warming' must
// NOT trigger the silent dog-placeholder fallback. It used to —
// users saw fake "Tiny Golden Retriever at the Beach" content
// after every server restart and assumed the app was broken.
//
// Contract: heroItem stays null, homepageState transitions to
// 'warming', and a retry is scheduled. HomePage renders skeletons
// off this state — no fake content reaches the user.
// ============================================================

beforeEach(() => {
  vi.useFakeTimers()
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
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('fetchHomepage: empty/warming response handling', () => {
  it('does NOT generate placeholder dogs when API returns no categories', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ categories: [], state: 'warming', needsRefill: true }),
    })

    await useHomeStore.getState().fetchHomepage('social')

    const s = useHomeStore.getState()
    expect(s.heroItem).toBeNull()
    expect(s.carouselItems).toHaveLength(0)
    expect(s.categories).toHaveLength(0)
    expect(s.homepageState).toBe('warming')
    // Hero must NOT be a fluffy dog. The placeholder generator
    // builds titles from breeds + adjectives + verbs; presence of
    // any of those words in heroItem.title is the canonical "we
    // regressed" signal.
    expect(s.heroItem).not.toMatchObject({ title: expect.stringMatching(/Retriever|Corgi|Poodle/i) })
  })

  it('does NOT generate placeholders when API returns state:warming with no videos', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ categories: [], state: 'warming' }),
    })

    await useHomeStore.getState().fetchHomepage('social')

    expect(useHomeStore.getState().heroItem).toBeNull()
    expect(useHomeStore.getState().homepageState).toBe('warming')
  })

  it('does NOT generate placeholders when fetch throws (network error)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'))

    await useHomeStore.getState().fetchHomepage('social')

    const s = useHomeStore.getState()
    expect(s.heroItem).toBeNull()
    expect(s.categories).toHaveLength(0)
    expect(s.fetchError).toBeTruthy()
    expect(s.homepageState).toBe('warming') // first attempt schedules retry
  })

  it('does NOT generate placeholders on HTTP 500', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 })

    await useHomeStore.getState().fetchHomepage('social')

    expect(useHomeStore.getState().heroItem).toBeNull()
    expect(useHomeStore.getState().fetchError).toBeTruthy()
  })

  it('schedules a retry after empty response and recovers when content arrives', async () => {
    let homepageCalls = 0
    globalThis.fetch = vi.fn().mockImplementation(async (url) => {
      // /api/tags/preferences is called by the success path after content arrives;
      // mock it as empty so it doesn't change scoring behavior.
      if (typeof url === 'string' && url.includes('/api/tags/preferences')) {
        return { ok: true, json: async () => ({ liked: [], disliked: [] }) }
      }
      // Recommendation trail fetch (added in Phase E) — return empty.
      if (typeof url === 'string' && url.includes('/api/recommendations/trail')) {
        return { ok: true, json: async () => ({ items: [], count: 0 }) }
      }
      homepageCalls++
      if (homepageCalls === 1) {
        return { ok: true, json: async () => ({ categories: [], state: 'warming' }) }
      }
      return {
        ok: true,
        json: async () => ({
          state: 'ready',
          categories: [
            {
              key: 'social_news',
              label: 'News',
              videos: [{
                id: 'v1', url: 'https://example.com/v1', title: 'Real Video',
                thumbnail: 'https://example.com/t1.jpg', duration: 120, source: 'youtube',
                uploader: 'TestChannel', view_count: 1000, like_count: 10,
                upload_date: '2026-04-30', tags: [],
              }],
            },
          ],
        }),
      }
    })

    await useHomeStore.getState().fetchHomepage('social')
    expect(useHomeStore.getState().homepageState).toBe('warming')
    expect(useHomeStore.getState().heroItem).toBeNull()

    // Advance the retry timer (first retry fires after RETRY_BASE_MS = 1000)
    await vi.advanceTimersByTimeAsync(1100)

    // Retry should have fired and now we have real content
    expect(homepageCalls).toBe(2)
    expect(useHomeStore.getState().homepageState).toBe('ready')
    expect(useHomeStore.getState().heroItem).not.toBeNull()
    expect(useHomeStore.getState().heroItem.title).toBe('Real Video')
  })

  it('renders real content when API returns state:ready immediately', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        state: 'ready',
        categories: [
          {
            key: 'social_news',
            label: 'News',
            videos: [{
              id: 'v1', url: 'https://example.com/v1', title: 'Real',
              thumbnail: 'https://example.com/t.jpg', duration: 60, source: 'youtube',
              uploader: 'Chan', view_count: 100, like_count: 5,
              upload_date: '2026-04-30', tags: [],
            }],
          },
        ],
      }),
    })

    await useHomeStore.getState().fetchHomepage('social')

    const s = useHomeStore.getState()
    expect(s.homepageState).toBe('ready')
    expect(s.heroItem).not.toBeNull()
    expect(s.heroItem.title).toBe('Real')
  })

  it('resetHome cancels in-flight warming retry', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ categories: [], state: 'warming' }),
    })

    await useHomeStore.getState().fetchHomepage('social')
    expect(useHomeStore.getState().homepageState).toBe('warming')

    useHomeStore.getState().resetHome()
    expect(useHomeStore.getState().homepageState).toBe('ready') // cleared by reset

    // Advance past where the retry would have fired — fetch should NOT be called again
    await vi.advanceTimersByTimeAsync(20000)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
