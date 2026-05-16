import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useHeroAutoplay from '../hooks/useHeroAutoplay'
import useHomeStore from '../stores/homeStore'

// ============================================================
// useHeroAutoplay — teaser phase state machine
//
// The hero plays for 4500ms then enters 'rest' (pauses).
// When card preview focus returns to hero (cardPreviewActive
// goes false), the teaser resets and re-arms the timer.
// ============================================================

function makeMockVideo() {
  const el = document.createElement('video')
  el.play = vi.fn().mockResolvedValue(undefined)
  el.pause = vi.fn()
  el.load = vi.fn()
  document.body.appendChild(el)
  return el
}

const heroItem = { id: 'hero-1', url: 'https://youtube.com/watch?v=test' }

beforeEach(() => {
  vi.useFakeTimers()

  // Mock fetch to return a non-m3u8 stream URL so the autoplay path runs
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ streamUrl: 'https://cdn.example.com/v.mp4' }),
  })

  // Mock matchMedia (jsdom doesn't implement it)
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  })

  // Reset homeStore focus state
  useHomeStore.setState({ focusedItem: null })
})

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

// Helper: attach our mock video to the hook's videoRef, let the URL resolve,
// then fire canplay so the hook calls play() and starts the teaser timer.
async function setupAndPlay(result) {
  const vid = makeMockVideo()
  // Set the ref before the autoplayUrl effect fires so the effect finds it.
  result.current.autoplayVideoRef.current = vid

  // Drain fetch + React state update (setAutoplayUrl) + the canplay effect.
  await act(async () => {
    await vi.runAllTimersAsync()
  })

  // Manually fire canplay — jsdom video elements don't auto-fire it.
  await act(async () => {
    vid.dispatchEvent(new Event('canplay'))
    // Drain the play() promise resolution
    await Promise.resolve()
    await Promise.resolve()
  })

  return vid
}

describe('useHeroAutoplay teaser phase', () => {
  it('teaser phase advances to rest after 4500ms once video is playing', async () => {
    const { result } = renderHook(() => useHeroAutoplay(heroItem, false))

    await setupAndPlay(result)

    // Immediately after canplay + play(), phase should be 'playing'
    expect(result.current.teaserPhase).toBe('playing')

    // Advance past the 4500ms teaser window
    await act(async () => {
      vi.advanceTimersByTime(4500)
    })

    expect(result.current.teaserPhase).toBe('rest')
  })

  it('teaser phase resets to playing when focus returns from a card preview', async () => {
    const { result } = renderHook(() => useHeroAutoplay(heroItem, false))

    await setupAndPlay(result)

    // Advance to 'rest'
    await act(async () => {
      vi.advanceTimersByTime(4500)
    })
    expect(result.current.teaserPhase).toBe('rest')

    // Simulate a card preview becoming active: set focusedItem to a non-hero surface
    await act(async () => {
      useHomeStore.setState({
        focusedItem: {
          id: 'card-1',
          url: 'https://example.com/card',
          surface: 'gallery-shelf',
          mode: 'social',
          inputKind: 'mouse',
          adjacentItems: [],
        },
      })
    })

    // Phase should still be 'rest' while preview is active
    expect(result.current.teaserPhase).toBe('rest')

    // Focus returns to hero: clear focusedItem
    await act(async () => {
      useHomeStore.setState({ focusedItem: null })
    })

    // Phase should flip back to 'playing' and re-arm the 4500ms timer
    expect(result.current.teaserPhase).toBe('playing')

    // Advance timer again to confirm the re-armed timer fires
    await act(async () => {
      vi.advanceTimersByTime(4500)
    })
    expect(result.current.teaserPhase).toBe('rest')
  })

  it('teaserPhase starts as idle before canplay fires', () => {
    const { result } = renderHook(() => useHeroAutoplay(heroItem, false))
    expect(result.current.teaserPhase).toBe('idle')
  })

  it('teaserPhase resets to idle on heroItem change', async () => {
    const heroItem2 = { id: 'hero-2', url: 'https://youtube.com/watch?v=other' }
    const { result, rerender } = renderHook(
      ({ item }) => useHeroAutoplay(item, false),
      { initialProps: { item: heroItem } }
    )

    await setupAndPlay(result)
    await act(async () => { vi.advanceTimersByTime(4500) })
    expect(result.current.teaserPhase).toBe('rest')

    // Change the hero item — should reset to idle
    await act(async () => {
      rerender({ item: heroItem2 })
    })

    expect(result.current.teaserPhase).toBe('idle')
  })
})
