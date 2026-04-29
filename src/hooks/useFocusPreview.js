import { useEffect } from 'react'
import useHomeStore from '../stores/homeStore'

// ============================================================
// useFocusPreview Hook (Milestone 0.2)
// Subscribes to homeStore.focusedItem and drives a singleton
// muted preview against whichever card currently owns focus.
// Cards register their target <video> via registerPreviewTarget.
// Hero owns its own autoplay path (useHeroAutoplay) — this hook
// silently no-ops while the hero or hero-carousel surface holds
// focus so the two never fight for the singleton.
//
// Fetch / display split (post fix for slow first-hover):
//   - Stream URL fetches are NEVER aborted. They always complete
//     and populate `urlCache`, even when focus moves away. This
//     prevents the cancel-cascade where rapid focus changes (mouse,
//     scroll, parallax, keyboard) would kill every in-flight fetch
//     and leave the cache empty forever.
//   - The display pipeline (debounce → set src → wait for canplay
//     → opacity 1) is gated by an `activeToken` identity check
//     instead of AbortController. cancelPreview just resets the
//     token; in-flight fetches keep going and populate cache for
//     the next hover.
//   - PosterCard / Top10Row prefetch on viewport entry via
//     `prefetchStreamUrl()`, so by the time the user hovers, the
//     URL is already cached and the preview attaches in <300ms.
// ============================================================

const HOVER_DEBOUNCE_MOUSE_MS = 120
const HOVER_DEBOUNCE_KEYBOARD_MS = 100
const URL_CACHE_TTL_MS = 60_000

// Module-level: card id -> HTMLVideoElement registered as the preview target.
const videoTargets = new Map()

// Module-level: card id -> { streamUrl, fetchedAt }. Resolved-cache that
// survives between focus swaps so re-focusing or stepping onto a previously
// prefetched adjacent card hits the cache instead of refetching.
const urlCache = new Map()

// Module-level: card id -> Promise<streamUrl | null>. Tracks in-flight
// fetches so multiple callers (eager prefetch + display timer + viewport
// prefetch) share a single network request without aborting one another.
const urlPromises = new Map()

// Active preview singletons. activeToken is a plain object identity used
// as a race-condition guard for the display path (timer / canplay handlers
// check `activeToken !== token` and bail). Replaces AbortController so
// cancellation no longer kills in-flight fetches.
let activeToken = null
let activeVideo = null
let activeTimer = null

// Hero surfaces never show a card preview — the hero element handles its
// own autoplay. Treat both the main hero and the hero carousel strip as
// hero-owned focus.
function isHeroSurface(surface) {
  return surface === 'hero' || surface === 'hero-carousel'
}

export function registerPreviewTarget(itemId, videoEl) {
  if (!itemId || !videoEl) return () => {}
  videoTargets.set(itemId, videoEl)
  return () => {
    if (videoTargets.get(itemId) === videoEl) {
      videoTargets.delete(itemId)
    }
  }
}

function hideActiveVideo() {
  if (!activeVideo) return
  try { activeVideo.pause() } catch { /* ignore */ }
  activeVideo.removeAttribute('src')
  try { activeVideo.load() } catch { /* ignore */ }
  activeVideo.style.opacity = '0'
  activeVideo = null
}

function cancelPreview() {
  if (activeTimer) {
    clearTimeout(activeTimer)
    activeTimer = null
  }
  // Reset the race-guard token. Any in-flight timer continuation or
  // canplay listener will see `activeToken !== token` and short-circuit.
  // We deliberately do NOT abort fetches here — letting them complete
  // populates the URL cache so the next focus on the same card is instant.
  activeToken = null
  hideActiveVideo()
}

// Internal: fetch the stream URL for an item, caching the result for
// URL_CACHE_TTL_MS. Concurrent callers share a single in-flight promise.
// Never throws; resolves to `null` on any failure.
function fetchStreamUrl(itemId, sourceUrl) {
  if (!itemId || !sourceUrl) return Promise.resolve(null)

  const cached = urlCache.get(itemId)
  if (cached && Date.now() - cached.fetchedAt < URL_CACHE_TTL_MS) {
    return Promise.resolve(cached.streamUrl)
  }

  const inFlight = urlPromises.get(itemId)
  if (inFlight) return inFlight

  // No abort signal — always completes.
  const promise = (async () => {
    try {
      const res = await fetch(`/api/stream-url?url=${encodeURIComponent(sourceUrl)}`)
      if (!res.ok) return null
      const data = await res.json()
      if (!data || !data.streamUrl) return null
      // HLS skipped intentionally — see _memory/errors/feeddeck-known-issues.md
      // "NSFW hover preview -- HLS skipped intentionally" (tracked as M0.5).
      if (data.streamUrl.includes('.m3u8')) return null
      urlCache.set(itemId, { streamUrl: data.streamUrl, fetchedAt: Date.now() })
      return data.streamUrl
    } catch (e) {
      console.warn('[FocusPreview] stream-url fetch failed:', e?.message || e)
      return null
    } finally {
      urlPromises.delete(itemId)
    }
  })()

  urlPromises.set(itemId, promise)
  return promise
}

// Public: kick off a stream-URL fetch without driving the display pipeline.
// Used by PosterCard's IntersectionObserver to warm the cache before the
// user hovers — by the time they do, the preview attaches in <300ms instead
// of waiting on yt-dlp.
export function prefetchStreamUrl(itemId, sourceUrl) {
  if (!itemId || !sourceUrl) return
  fetchStreamUrl(itemId, sourceUrl).catch(() => {})
}

// Drives the preview lifecycle for a single focusedItem snapshot.
// Note: the hook intentionally does NOT cancel on "mouse leave card." A
// previous-focus card stays the focus owner until something else takes
// focus (the next hover, an arrow key, the hero claiming on heroItem
// change). Pointer-leave cancellation would create a flicker zone every
// time the mouse traveled between cards.
function startPreviewForFocus(focusedItem) {
  cancelPreview()

  if (!focusedItem || !focusedItem.id || !focusedItem.url) return
  if (isHeroSurface(focusedItem.surface)) return

  const token = {}
  activeToken = token

  // Eager prefetch adjacent items — populates cache so the next arrow-key
  // / scroll feels instant. Fire and forget; never aborted.
  if (Array.isArray(focusedItem.adjacentItems)) {
    for (const adj of focusedItem.adjacentItems) {
      if (adj?.id && adj?.url) {
        fetchStreamUrl(adj.id, adj.url).catch(() => {})
      }
    }
  }

  // Eager fetch the focused item too — runs in parallel with the debounce
  // timer, so by the time the timer fires the URL is usually already
  // resolved (and cached). Display still waits for the debounce so quick
  // mouse passes don't trigger video loads.
  const mainPromise = fetchStreamUrl(focusedItem.id, focusedItem.url)
  mainPromise.catch(() => {})

  const debounceMs = focusedItem.inputKind === 'keyboard'
    ? HOVER_DEBOUNCE_KEYBOARD_MS
    : HOVER_DEBOUNCE_MOUSE_MS

  activeTimer = setTimeout(async () => {
    activeTimer = null
    if (activeToken !== token) return

    const streamUrl = await mainPromise
    if (activeToken !== token) return
    if (!streamUrl) return

    // Re-resolve the registered element — the focused card may have
    // remounted between focus and timer fire.
    const targetEl = videoTargets.get(focusedItem.id)
    if (!targetEl) return

    targetEl.src = `/api/proxy-stream?url=${encodeURIComponent(streamUrl)}`
    targetEl.muted = true
    targetEl.playsInline = true
    targetEl.loop = true
    targetEl.preload = 'auto'
    try { targetEl.load() } catch { /* ignore */ }
    activeVideo = targetEl

    targetEl.addEventListener('canplay', () => {
      if (activeToken !== token) return
      targetEl.style.opacity = '1'
      const playPromise = targetEl.play()
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {})
      }
    }, { once: true })

    targetEl.addEventListener('error', () => {
      if (activeToken !== token) return
      const code = targetEl.error?.code
      console.warn(`[FocusPreview] video error code=${code} for ${focusedItem.id}`)
      // Invalidate the cached stream URL — some CDNs expire URLs within
      // minutes, and a cached-but-dead URL would make every retry fail
      // until TTL elapses. Drop the entry so the next focus refetches.
      urlCache.delete(focusedItem.id)
      targetEl.removeAttribute('src')
      targetEl.style.opacity = '0'
      if (activeVideo === targetEl) activeVideo = null
    }, { once: true })
  }, debounceMs)
}

export default function useFocusPreview() {
  const focusedItem = useHomeStore((s) => s.focusedItem)

  useEffect(() => {
    startPreviewForFocus(focusedItem)
    return () => cancelPreview()
  }, [focusedItem])
}

// Test helpers — only used by useFocusPreview.test.js to reset module
// state between cases and drive the focus pipeline directly without
// needing renderHook from @testing-library/react.
export function _resetForTests() {
  videoTargets.clear()
  urlCache.clear()
  urlPromises.clear()
  if (activeTimer) {
    clearTimeout(activeTimer)
    activeTimer = null
  }
  activeToken = null
  activeVideo = null
}

export function _applyFocusForTests(focusedItem) {
  startPreviewForFocus(focusedItem)
}

export function _peekForTests() {
  return {
    videoTargetCount: videoTargets.size,
    urlCacheCount: urlCache.size,
    urlPromisesCount: urlPromises.size,
    activeToken,
    activeVideo,
    activeTimer,
  }
}
