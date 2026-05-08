import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import useFeedStore from '../stores/feedStore'
import useModeStore from '../stores/modeStore'
import useHomeStore from '../stores/homeStore'

// ============================================================
// Regression: /feed must load fast.
//
// 2026-05-06 Bug: feedStore.initFeed() was calling
// `/api/feed/watched-ids` — an endpoint that does not exist on
// the server. The request would hang for 17-30s before any
// videos appeared. Once watched-ids returned (or timed out),
// /api/feed/next then fired, then 5x /api/stream-url calls,
// each taking 8-10s of yt-dlp time. Total: ~30s to first frame.
//
// Contract: initFeed makes ONE call to /api/feed/next. It does
// NOT call any endpoint that doesn't exist. The server-side
// `WHERE watched = 0` filter on /api/feed/next already drops
// already-watched videos, so the client doesn't need a separate
// dedup list.
// ============================================================

describe('feedStore.initFeed() fast path', () => {
  beforeEach(() => {
    useFeedStore.setState({
      buffer: [],
      currentIndex: 0,
      loading: false,
      initialized: false,
      watchedIds: new Set(),
      exhausted: false,
      filters: { sources: [], tags: [], searchQuery: '' },
    })
    useModeStore.setState({ isSFW: true })
    useHomeStore.setState({ exposedItemIds: new Set() })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does NOT call /api/feed/watched-ids (endpoint does not exist)', async () => {
    const fetchSpy = vi.fn((url) => {
      if (url.startsWith('/api/feed/next')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ videos: [] }),
        })
      }
      if (url.startsWith('/api/recommendations/trail')) {
        return Promise.resolve({ ok: true, json: async () => ({ items: [] }) })
      }
      // Anything else is a regression — fail loudly so we don't silently
      // depend on phantom endpoints again.
      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      })
    })
    globalThis.fetch = fetchSpy

    await useFeedStore.getState().initFeed()

    const calledUrls = fetchSpy.mock.calls.map(c => c[0])
    expect(calledUrls).not.toContain(expect.stringMatching(/watched-ids/))
    for (const url of calledUrls) {
      expect(url).not.toMatch(/watched-ids/)
    }
  })

  it('initFeed does NOT block on background stream-URL warming', async () => {
    // The fast endpoints (next + trail) return in 50ms. Stream-URL warming
    // takes a deliberately huge 10000ms — long enough that if initFeed
    // awaited it, this test would clearly stall. The contract: initFeed
    // returns as soon as the buffer is set, not when warming completes.
    let streamUrlCallCount = 0
    globalThis.fetch = vi.fn(async (url) => {
      if (url.startsWith('/api/feed/next')) {
        await new Promise(r => setTimeout(r, 50))
        return {
          ok: true,
          json: async () => ({
            videos: [
              { id: 'v1', url: 'https://yt/1', title: 'T1', thumbnail: 't1', streamUrl: null },
              { id: 'v2', url: 'https://yt/2', title: 'T2', thumbnail: 't2', streamUrl: null },
            ],
          }),
        }
      }
      if (url.startsWith('/api/recommendations/trail')) {
        await new Promise(r => setTimeout(r, 50))
        return { ok: true, json: async () => ({ items: [] }) }
      }
      if (url.startsWith('/api/stream-url')) {
        streamUrlCallCount++
        await new Promise(r => setTimeout(r, 10000))
        return { ok: true, json: async () => ({ streamUrl: 'https://cdn/x.mp4' }) }
      }
      // Byte prefetches — short-circuit without delay
      return { ok: true, body: null, json: async () => ({}) }
    })

    const start = Date.now()
    await useFeedStore.getState().initFeed()
    const elapsed = Date.now() - start

    // initFeed must return as soon as buffer is set. The 10s warm fetch
    // should still be in flight in the background.
    expect(elapsed).toBeLessThan(1000)
    expect(useFeedStore.getState().initialized).toBe(true)
    expect(useFeedStore.getState().buffer.length).toBe(2)
    // _warmStreamUrls fired (background) — at least one call kicked off
    expect(streamUrlCallCount).toBeGreaterThan(0)
  })
})
