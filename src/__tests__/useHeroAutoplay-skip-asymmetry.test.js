import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useHeroAutoplay from '../hooks/useHeroAutoplay'
import useHomeStore from '../stores/homeStore'

// ============================================================
// useHeroAutoplay — skip asymmetry (NSFW hero skip spike, 2026-05-16)
//
// Two distinct failure modes deserve different behavior:
//
//   (1) /api/stream-url fails (yt-dlp upstream issue, cookies dead,
//       transient 5xx). The hero card is probably fine — the live
//       resolution path is just temporarily broken. Falling back to
//       the static thumbnail keeps the card on-screen so the user
//       can click it later if they want.
//
//   (2) <video> element fires `error` after a successful URL resolution
//       (or HLS reports fatal). The URL was resolvable but the CDN /
//       container can't be played — the content itself is genuinely
//       broken right now. Dismissing the card is correct.
//
// Before this fix, BOTH paths dismissed the hero, so a flurry of
// yt-dlp 500s (auth_failed for PH cookies dead, unknown_error for
// other NSFW sites) burned through visible hero cards rapidly.
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
let dismissSpy

beforeEach(() => {
  vi.useFakeTimers()
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  })
  useHomeStore.setState({ focusedItem: null })

  // Spy on dismissAndAdvance — that's what skipBrokenHero ultimately calls.
  // It's the visible "card swap" effect from the user's perspective.
  dismissSpy = vi.fn()
  useHomeStore.setState({ dismissAndAdvance: dismissSpy })
})

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('useHeroAutoplay skip asymmetry', () => {
  it('does NOT dismiss the hero when /api/stream-url returns non-ok', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) })

    const { result } = renderHook(() => useHeroAutoplay(heroItem, false))

    // Attach mock video; drain fetch/state.
    const vid = makeMockVideo()
    result.current.autoplayVideoRef.current = vid

    await act(async () => { await vi.runAllTimersAsync() })

    expect(dismissSpy).not.toHaveBeenCalled()
    // autoplayReady should remain false (no canplay), so the hero falls
    // back to the static thumbnail rendered by HeroSection.
    expect(result.current.autoplayReady).toBe(false)
  })

  it('does NOT dismiss when /api/stream-url returns ok but no streamUrl', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })

    renderHook(() => useHeroAutoplay(heroItem, false))
    await act(async () => { await vi.runAllTimersAsync() })

    expect(dismissSpy).not.toHaveBeenCalled()
  })

  it('does NOT dismiss when fetch throws a non-abort error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('network down'))

    renderHook(() => useHeroAutoplay(heroItem, false))
    await act(async () => { await vi.runAllTimersAsync() })

    expect(dismissSpy).not.toHaveBeenCalled()
  })

  it('DOES dismiss when the <video> element fires `error` after a successful URL resolution', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ streamUrl: 'https://cdn.example.com/v.mp4' }),
    })

    const { result } = renderHook(() => useHeroAutoplay(heroItem, false))
    const vid = makeMockVideo()
    result.current.autoplayVideoRef.current = vid

    // Drain fetch + state update so the autoplayUrl effect mounts the error listener.
    await act(async () => { await vi.runAllTimersAsync() })

    // Now fire `error` on the video element — playback genuinely broken.
    await act(async () => {
      vid.dispatchEvent(new Event('error'))
      await Promise.resolve()
    })

    expect(dismissSpy).toHaveBeenCalledTimes(1)
    expect(dismissSpy).toHaveBeenCalledWith(heroItem)
  })
})
