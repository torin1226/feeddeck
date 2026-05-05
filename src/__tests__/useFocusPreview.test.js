import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock hls.js for the HLS-lifecycle tests (M0.5). The mock instance records
// loadSource / attachMedia / destroy calls so each test can assert which
// stage the preview reached. Tests that don't drive HLS aren't affected
// because the mock only resolves when the dynamic import runs.
const hlsInstances = []
class MockHls {
  constructor(opts) {
    this.opts = opts
    this.loadSourceCalls = []
    this.attachMediaCalls = []
    this.destroyed = false
    this.errorHandler = null
    hlsInstances.push(this)
  }
  on(_event, cb) { this.errorHandler = cb }
  loadSource(url) { this.loadSourceCalls.push(url) }
  attachMedia(el) { this.attachMediaCalls.push(el) }
  destroy() { this.destroyed = true }
  // Test helper: simulate a fatal HLS error.
  __fireFatalError() {
    if (this.errorHandler) this.errorHandler(null, { fatal: true, type: 'networkError' })
  }
}
MockHls.isSupported = vi.fn(() => true)
MockHls.Events = { ERROR: 'hlsError' }
MockHls.ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' }

vi.mock('hls.js', () => ({ default: MockHls }))

import {
  registerPreviewTarget,
  prefetchStreamUrl,
  _resetForTests,
  _applyFocusForTests,
  _peekForTests,
} from '../hooks/useFocusPreview'

// ============================================================
// useFocusPreview contract (Milestone 0.2)
//
// Drives the focus pipeline via the test-only `_applyFocusForTests`
// helper so we don't need a React renderer. The helper runs the
// same code path the React effect uses, just without subscribing.
// ============================================================

function makeFakeVideo({ canPlayNativeHls = false } = {}) {
  // jsdom HTMLMediaElement is mostly a no-op. Only emulate the bits
  // useFocusPreview interacts with (attach src, fire canplay) so we can
  // assert opacity flip and play() invocation without driving real media.
  const listeners = {}
  const el = document.createElement('video')
  el.style.opacity = '0'

  el.play = vi.fn().mockResolvedValue(undefined)
  el.load = vi.fn()
  el.pause = vi.fn()
  // Default: non-Safari (no native HLS). Tests opt in to native via flag.
  el.canPlayType = vi.fn((mime) => {
    if (mime === 'application/vnd.apple.mpegurl') return canPlayNativeHls ? 'probably' : ''
    return 'maybe'
  })

  const origAdd = el.addEventListener.bind(el)
  el.addEventListener = vi.fn((evt, cb, opts) => {
    listeners[evt] = listeners[evt] || []
    listeners[evt].push(cb)
    origAdd(evt, cb, opts)
  })
  el.__fire = (evt) => {
    for (const cb of listeners[evt] || []) cb()
  }
  document.body.appendChild(el)
  return el
}

function focused(item, surface, opts = {}) {
  return {
    id: item.id,
    url: item.url ?? null,
    surface,
    mode: 'social',
    inputKind: opts.inputKind ?? 'mouse',
    adjacentItems: opts.adjacentItems ?? [],
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  _resetForTests()
  hlsInstances.length = 0
  MockHls.isSupported = vi.fn(() => true)
  globalThis.fetch = vi.fn().mockImplementation(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ streamUrl: 'https://cdn.example.com/v.mp4' }),
    })
  )
})

afterEach(() => {
  vi.useRealTimers()
  _resetForTests()
  document.body.innerHTML = ''
})

const ytItem = { id: 'yt-1', url: 'https://youtube.com/watch?v=abc' }

describe('useFocusPreview', () => {
  it('does nothing when focused surface is "hero"', async () => {
    const video = makeFakeVideo()
    registerPreviewTarget('yt-1', video)
    _applyFocusForTests(focused(ytItem, 'hero', { inputKind: 'auto' }))

    await vi.advanceTimersByTimeAsync(300)
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(video.play).not.toHaveBeenCalled()
  })

  it('does nothing when focused surface is "hero-carousel"', async () => {
    const video = makeFakeVideo()
    registerPreviewTarget('yt-1', video)
    _applyFocusForTests(focused(ytItem, 'hero-carousel'))

    await vi.advanceTimersByTimeAsync(300)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('does nothing when focusedItem is null', async () => {
    const video = makeFakeVideo()
    registerPreviewTarget('yt-1', video)
    _applyFocusForTests(null)

    await vi.advanceTimersByTimeAsync(300)
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(video.play).not.toHaveBeenCalled()
  })

  it('does nothing when focusedItem.url is missing', async () => {
    const video = makeFakeVideo()
    registerPreviewTarget('yt-1', video)
    _applyFocusForTests({
      id: 'yt-1',
      url: null,
      surface: 'gallery-shelf',
      mode: 'social',
      inputKind: 'mouse',
      adjacentItems: [],
    })

    await vi.advanceTimersByTimeAsync(300)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('starts a preview after the mouse debounce on a card-row surface', async () => {
    const video = makeFakeVideo()
    registerPreviewTarget('yt-1', video)
    _applyFocusForTests(focused(ytItem, 'gallery-shelf'))

    // Fetch fires eagerly to warm the cache, but display waits for debounce.
    // Prior contract was "fetch waits for debounce"; eager-fetch is the fix
    // for the cancel-cascade that left the cache empty under rapid focus.
    await vi.advanceTimersByTimeAsync(60)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    const call = globalThis.fetch.mock.calls[0][0]
    expect(call).toContain('/api/stream-url')
    // Display has not committed yet — opacity still 0.
    expect(video.style.opacity).toBe('0')

    // Pass the debounce window — display path commits.
    await vi.advanceTimersByTimeAsync(150)
    video.__fire('canplay')
    expect(video.style.opacity).toBe('1')
    expect(video.play).toHaveBeenCalled()
  })

  it('uses the 100ms keyboard window when inputKind is keyboard', async () => {
    const video = makeFakeVideo()
    registerPreviewTarget('yt-1', video)
    _applyFocusForTests(focused(ytItem, 'gallery-shelf', { inputKind: 'keyboard' }))

    // Eager fetch fires immediately on focus.
    await vi.advanceTimersByTimeAsync(10)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    // Display still waits for the 100ms keyboard debounce.
    expect(video.style.opacity).toBe('0')

    await vi.advanceTimersByTimeAsync(120)
    video.__fire('canplay')
    expect(video.style.opacity).toBe('1')
  })

  it('switching focus mid-flight cancels the prior fetch + clears the prior video', async () => {
    const v1 = makeFakeVideo()
    const v2 = makeFakeVideo()
    registerPreviewTarget('yt-1', v1)
    registerPreviewTarget('yt-2', v2)

    _applyFocusForTests(focused(ytItem, 'gallery-shelf'))
    await vi.advanceTimersByTimeAsync(220)
    v1.__fire('canplay')
    expect(v1.style.opacity).toBe('1')
    expect(v1.play).toHaveBeenCalledTimes(1)

    _applyFocusForTests(focused(
      { id: 'yt-2', url: 'https://youtube.com/watch?v=def' },
      'gallery-shelf'
    ))
    expect(v1.pause).toHaveBeenCalled()
    expect(v1.style.opacity).toBe('0')
    expect(v1.getAttribute('src')).toBeNull()

    await vi.advanceTimersByTimeAsync(220)
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
    v2.__fire('canplay')
    expect(v2.style.opacity).toBe('1')
    expect(v2.play).toHaveBeenCalled()
  })

  it('clearing focus cancels the active preview', async () => {
    const video = makeFakeVideo()
    registerPreviewTarget('yt-1', video)
    _applyFocusForTests(focused(ytItem, 'gallery-shelf'))

    await vi.advanceTimersByTimeAsync(220)
    video.__fire('canplay')
    expect(video.style.opacity).toBe('1')

    _applyFocusForTests(null)
    expect(video.pause).toHaveBeenCalled()
    expect(video.style.opacity).toBe('0')
  })

  // ============================================================
  // M0.5 — NSFW HLS hover preview
  // ============================================================
  describe('HLS preview lifecycle', () => {
    const hlsItem = { id: 'nsfw-1', url: 'https://example.com/v' }

    it('attaches an HLS instance via /api/hls-proxy when stream is .m3u8', async () => {
      const video = makeFakeVideo()
      registerPreviewTarget('nsfw-1', video)
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ streamUrl: 'https://cdn.example.com/playlist.m3u8' }),
      })

      _applyFocusForTests(focused(hlsItem, 'gallery-shelf'))
      await vi.advanceTimersByTimeAsync(220)
      // Drain the dynamic import + then() chain.
      await vi.runAllTimersAsync()

      expect(hlsInstances).toHaveLength(1)
      const hls = hlsInstances[0]
      expect(hls.loadSourceCalls[0]).toContain('/api/hls-proxy')
      expect(hls.loadSourceCalls[0]).toContain(encodeURIComponent('https://cdn.example.com/playlist.m3u8'))
      expect(hls.attachMediaCalls[0]).toBe(video)
      expect(_peekForTests().activeHls).toBe(hls)
    })

    it('switching focus destroys the prior HLS instance (no leak)', async () => {
      const v1 = makeFakeVideo()
      const v2 = makeFakeVideo()
      registerPreviewTarget('nsfw-1', v1)
      registerPreviewTarget('yt-1', v2)
      let urlForId = 'https://cdn.example.com/playlist.m3u8'
      globalThis.fetch = vi.fn().mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ streamUrl: urlForId }),
        })
      )

      _applyFocusForTests(focused(hlsItem, 'gallery-shelf'))
      await vi.advanceTimersByTimeAsync(220)
      await vi.runAllTimersAsync()
      expect(hlsInstances).toHaveLength(1)
      const hls = hlsInstances[0]
      expect(hls.destroyed).toBe(false)

      // Switch focus to a non-HLS card.
      urlForId = 'https://cdn.example.com/v.mp4'
      _applyFocusForTests(focused(ytItem, 'gallery-shelf'))
      expect(hls.destroyed).toBe(true)
      expect(_peekForTests().activeHls).toBeNull()
    })

    it('clearing focus destroys the active HLS instance', async () => {
      const video = makeFakeVideo()
      registerPreviewTarget('nsfw-1', video)
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ streamUrl: 'https://cdn.example.com/playlist.m3u8' }),
      })

      _applyFocusForTests(focused(hlsItem, 'gallery-shelf'))
      await vi.advanceTimersByTimeAsync(220)
      await vi.runAllTimersAsync()
      const hls = hlsInstances[0]

      _applyFocusForTests(null)
      expect(hls.destroyed).toBe(true)
      expect(_peekForTests().activeHls).toBeNull()
    })

    it('repeated HLS hovers do not leak instances (50 hover-outs)', async () => {
      const video = makeFakeVideo()
      registerPreviewTarget('nsfw-1', video)
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ streamUrl: 'https://cdn.example.com/playlist.m3u8' }),
      })

      for (let i = 0; i < 50; i++) {
        _applyFocusForTests(focused(hlsItem, 'gallery-shelf'))
        await vi.advanceTimersByTimeAsync(220)
        await vi.runAllTimersAsync()
        _applyFocusForTests(null)
      }

      // All 50 instances created, all 50 destroyed, none active.
      expect(hlsInstances).toHaveLength(50)
      expect(hlsInstances.every((h) => h.destroyed)).toBe(true)
      expect(_peekForTests().activeHls).toBeNull()
    })

    it('uses native HLS path on Safari instead of attaching hls.js', async () => {
      const video = makeFakeVideo({ canPlayNativeHls: true })
      registerPreviewTarget('nsfw-1', video)
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ streamUrl: 'https://cdn.example.com/playlist.m3u8' }),
      })

      _applyFocusForTests(focused(hlsItem, 'gallery-shelf'))
      await vi.advanceTimersByTimeAsync(220)
      await vi.runAllTimersAsync()

      expect(hlsInstances).toHaveLength(0)
      expect(video.getAttribute('src')).toContain('/api/proxy-stream')
      expect(_peekForTests().activeHls).toBeNull()
    })

    it('falls back to /api/proxy-stream when MSE not supported', async () => {
      MockHls.isSupported = vi.fn(() => false)
      const video = makeFakeVideo()
      registerPreviewTarget('nsfw-1', video)
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ streamUrl: 'https://cdn.example.com/playlist.m3u8' }),
      })

      _applyFocusForTests(focused(hlsItem, 'gallery-shelf'))
      await vi.advanceTimersByTimeAsync(220)
      await vi.runAllTimersAsync()

      // hls.js is consulted (MSE check) but no instance is attached.
      // The mock constructor fires only on `new MockHls(...)`, so
      // hlsInstances stays empty when we exit before that line.
      expect(hlsInstances).toHaveLength(0)
      expect(video.getAttribute('src')).toContain('/api/proxy-stream')
      expect(_peekForTests().activeHls).toBeNull()
    })

    it('fatal HLS error invalidates the URL cache', async () => {
      const video = makeFakeVideo()
      registerPreviewTarget('nsfw-1', video)
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ streamUrl: 'https://cdn.example.com/playlist.m3u8' }),
      })

      _applyFocusForTests(focused(hlsItem, 'gallery-shelf'))
      await vi.advanceTimersByTimeAsync(220)
      await vi.runAllTimersAsync()
      expect(_peekForTests().urlCacheCount).toBe(1)

      hlsInstances[0].__fireFatalError()
      expect(_peekForTests().urlCacheCount).toBe(0)
      expect(hlsInstances[0].destroyed).toBe(true)
    })
  })

  it('eager-prefetches adjacentItems into the URL cache', async () => {
    const video = makeFakeVideo()
    registerPreviewTarget('yt-1', video)

    const adjacentItems = [
      { id: 'yt-prev', url: 'https://youtube.com/watch?v=prev' },
      { id: 'yt-next', url: 'https://youtube.com/watch?v=next' },
    ]
    _applyFocusForTests(focused(ytItem, 'gallery-shelf', { adjacentItems }))

    await vi.advanceTimersByTimeAsync(220)
    // 2 adjacent prefetches + 1 main fetch = 3 total
    expect(globalThis.fetch).toHaveBeenCalledTimes(3)
    expect(_peekForTests().urlCacheCount).toBe(3)
  })

  it('hits the URL cache on a re-focus instead of refetching', async () => {
    const video = makeFakeVideo()
    registerPreviewTarget('yt-1', video)

    _applyFocusForTests(focused(ytItem, 'gallery-shelf'))
    await vi.advanceTimersByTimeAsync(220)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)

    // Move focus away and back — the second focus should reuse the cache.
    _applyFocusForTests(focused(
      { id: 'yt-2', url: 'https://youtube.com/watch?v=def' },
      'gallery-shelf'
    ))
    await vi.advanceTimersByTimeAsync(220)
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)

    _applyFocusForTests(focused(ytItem, 'gallery-shelf'))
    await vi.advanceTimersByTimeAsync(220)
    // No new fetch for yt-1 — cache hit.
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
  })

  it('does nothing when no video target is registered for the focused id', async () => {
    _applyFocusForTests(focused(ytItem, 'gallery-shelf'))
    await vi.advanceTimersByTimeAsync(220)
    // Fetch fires (URL cached for next time) but no DOM mutation crashes.
    expect(globalThis.fetch).toHaveBeenCalled()
    expect(_peekForTests().activeVideo).toBeNull()
  })

  it('registerPreviewTarget cleanup removes the entry', () => {
    const video = makeFakeVideo()
    const cleanup = registerPreviewTarget('yt-1', video)
    expect(_peekForTests().videoTargetCount).toBe(1)
    cleanup()
    expect(_peekForTests().videoTargetCount).toBe(0)
  })

  it('registering a different element under the same id replaces it', () => {
    const v1 = makeFakeVideo()
    const v2 = makeFakeVideo()
    registerPreviewTarget('yt-1', v1)
    registerPreviewTarget('yt-1', v2)
    expect(_peekForTests().videoTargetCount).toBe(1)
  })

  it('invalidates the URL cache when the video element fires error', async () => {
    const video = makeFakeVideo()
    registerPreviewTarget('yt-1', video)
    _applyFocusForTests(focused(ytItem, 'gallery-shelf'))

    await vi.advanceTimersByTimeAsync(220)
    expect(_peekForTests().urlCacheCount).toBe(1)

    // Simulate a CDN-expired URL: video element fires error
    video.__fire('error')
    expect(_peekForTests().urlCacheCount).toBe(0)
  })

  it('cleanup is a no-op when called for an element that was already replaced', () => {
    const v1 = makeFakeVideo()
    const v2 = makeFakeVideo()
    const cleanup1 = registerPreviewTarget('yt-1', v1)
    registerPreviewTarget('yt-1', v2)
    cleanup1()
    expect(_peekForTests().videoTargetCount).toBe(1) // v2 still registered
  })
})

// ============================================================
// urlCache size cap (2026-05-05 Resource lens)
//
// Long browse sessions write a urlCache entry per focused card.
// Without a cap the map grows unbounded. CAP = 100; FIFO eviction.
// ============================================================

describe('useFocusPreview urlCache cap', () => {
  const URL_CACHE_CAP = 100

  async function fillCache(count) {
    for (let i = 0; i < count; i++) {
      prefetchStreamUrl(`item-${i}`, `https://example.com/v${i}.mp4`)
    }
    // Drain microtasks + any pending fetch resolutions.
    await vi.runAllTimersAsync()
  }

  it('caches all entries while under the cap', async () => {
    await fillCache(50)
    expect(_peekForTests().urlCacheCount).toBe(50)
  })

  it('caps at 100 once writes exceed the limit', async () => {
    await fillCache(URL_CACHE_CAP + 50)
    expect(_peekForTests().urlCacheCount).toBe(URL_CACHE_CAP)
  })

  it('stays bounded under a 1000-focus stress test', async () => {
    await fillCache(1000)
    expect(_peekForTests().urlCacheCount).toBe(URL_CACHE_CAP)
  })
})
