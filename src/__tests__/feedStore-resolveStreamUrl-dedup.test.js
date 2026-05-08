import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { resolveStreamUrl, _resetForTests } from '../stores/feedStore'

// ============================================================
// Regression: parallel callers of /api/stream-url for the same
// source URL must share one in-flight request.
//
// Before: _warmStreamUrls and FeedVideo's on-demand fetch each
// hit /api/stream-url independently for the active slot. Both
// waited on the same yt-dlp resolution server-side, doubling
// the perceived first-frame latency on pages where the warmer
// hadn't completed before the user reached the feed.
// ============================================================

describe('resolveStreamUrl dedup', () => {
  beforeEach(() => {
    _resetForTests()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('shares a single in-flight fetch across parallel callers', async () => {
    let inflight = 0
    let peak = 0
    globalThis.fetch = vi.fn(async () => {
      inflight++
      peak = Math.max(peak, inflight)
      await new Promise(r => setTimeout(r, 100))
      inflight--
      return { ok: true, json: async () => ({ streamUrl: 'https://cdn/x.mp4' }) }
    })

    const [a, b, c] = await Promise.all([
      resolveStreamUrl('https://yt/1'),
      resolveStreamUrl('https://yt/1'),
      resolveStreamUrl('https://yt/1'),
    ])

    expect(a).toBe('https://cdn/x.mp4')
    expect(b).toBe('https://cdn/x.mp4')
    expect(c).toBe('https://cdn/x.mp4')
    // Three callers must have shared one network request.
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(peak).toBe(1)
  })

  it('returns null on failure without throwing', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down')
    })
    const result = await resolveStreamUrl('https://yt/2')
    expect(result).toBeNull()
  })

  it('returns null when source URL is missing', async () => {
    const result = await resolveStreamUrl(null)
    expect(result).toBeNull()
  })
})
