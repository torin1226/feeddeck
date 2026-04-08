import { useRef, useCallback, useEffect } from 'react'

// ============================================================
// useHoverPreview Hook
// Manages hover-to-preview video playback on thumbnail cards.
// - 300ms debounce before fetching stream
// - Only 1 preview at a time (new hover cancels previous)
// - Abort on mouseout
// - Plays muted, low-res
// - Waits for canplay before calling play() (prevents AbortError)
// - Race-condition safe: checks activeAbort identity before applying
// ============================================================

// Singleton: only one preview active across all cards
let activeAbort = null
let activeVideo = null

// Module-level cancel — operates only on singletons, no React state
function doCancel(timerRef) {
  clearTimeout(timerRef.current)
  timerRef.current = null

  if (activeAbort) {
    activeAbort.abort()
    activeAbort = null
  }

  if (activeVideo) {
    activeVideo.pause()
    activeVideo.removeAttribute('src')
    activeVideo.load()
    activeVideo.style.opacity = '0'
    activeVideo = null
  }
}

export default function useHoverPreview() {
  const timerRef = useRef(null)

  const cancelPreview = useCallback(() => doCancel(timerRef), [])

  const startPreview = useCallback((url, videoEl) => {
    if (!url || !videoEl) return

    // Cancel any existing preview
    doCancel(timerRef)

    const abort = new AbortController()
    activeAbort = abort

    // Set up preload hint for faster metadata fetch
    videoEl.preload = 'metadata'

    timerRef.current = setTimeout(async () => {
      if (abort.signal.aborted) return

      try {
        const res = await fetch(
          `/api/stream-url?url=${encodeURIComponent(url)}`,
          { signal: abort.signal }
        )
        if (!res.ok) {
          console.warn(`[HoverPreview] stream-url returned ${res.status} for ${url}`)
          return
        }
        if (abort.signal.aborted) return
        const data = await res.json()
        if (!data.streamUrl) {
          console.warn(`[HoverPreview] No streamUrl in response for ${url}`)
          return
        }
        if (abort.signal.aborted) return

        // Race condition guard: if a new hover started while we were fetching,
        // activeAbort will have changed — bail out
        if (activeAbort !== abort) return

        // Skip HLS streams — they require hls.js which is too heavy for hover previews
        const cdnUrl = data.streamUrl
        if (cdnUrl.includes('.m3u8')) return

        // Proxy CDN URL to avoid CORS/ORB blocking
        videoEl.src = `/api/proxy-stream?url=${encodeURIComponent(cdnUrl)}`
        videoEl.muted = true
        videoEl.playsInline = true
        videoEl.loop = true
        videoEl.preload = 'metadata'
        videoEl.load()
        activeVideo = videoEl

        // Wait for canplay before attempting play — prevents AbortError
        videoEl.addEventListener('canplay', () => {
          // Double-check we're still the active preview
          if (!abort.signal.aborted && activeAbort === abort) {
            videoEl.style.opacity = '1'
            videoEl.play().catch(() => {})
          }
        }, { once: true })

        // Handle video element errors (bad proxy response, codec issues)
        videoEl.addEventListener('error', () => {
          if (!abort.signal.aborted) {
            const err = videoEl.error
            console.warn(`[HoverPreview] Video error: code=${err?.code} ${err?.message || ''}`)
            // Clean up — don't leave broken state
            videoEl.removeAttribute('src')
            videoEl.style.opacity = '0'
            if (activeVideo === videoEl) activeVideo = null
          }
        }, { once: true })
      } catch (e) {
        // Only log non-abort errors
        if (e.name !== 'AbortError') {
          console.warn('[HoverPreview] Fetch failed:', e.message)
        }
      }
    }, 300)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Cleanup on unmount to prevent orphaned video elements
  useEffect(() => {
    return () => doCancel(timerRef)
  }, [])

  return { startPreview, cancelPreview }
}
