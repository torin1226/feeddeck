import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  registerPreviewTarget,
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

function makeFakeVideo() {
  // jsdom HTMLMediaElement is mostly a no-op. Only emulate the bits
  // useFocusPreview interacts with (attach src, fire canplay) so we can
  // assert opacity flip and play() invocation without driving real media.
  const listeners = {}
  const el = document.createElement('video')
  el.style.opacity = '0'

  el.play = vi.fn().mockResolvedValue(undefined)
  el.load = vi.fn()
  el.pause = vi.fn()

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

  it('skips HLS .m3u8 streams (handed off to M0.5)', async () => {
    const video = makeFakeVideo()
    registerPreviewTarget('yt-1', video)
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ streamUrl: 'https://cdn.example.com/playlist.m3u8' }),
    })
    _applyFocusForTests(focused(ytItem, 'gallery-shelf'))

    await vi.advanceTimersByTimeAsync(220)
    expect(globalThis.fetch).toHaveBeenCalled()
    expect(video.play).not.toHaveBeenCalled()
    expect(video.style.opacity).toBe('0')
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
