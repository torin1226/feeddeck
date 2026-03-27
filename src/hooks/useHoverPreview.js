import { useRef, useCallback } from 'react'

// ============================================================
// useHoverPreview Hook
// Manages hover-to-preview video playback on thumbnail cards.
// - 300ms debounce before fetching stream
// - Only 1 preview at a time (new hover cancels previous)
// - Abort on mouseout
// - Plays muted, low-res
// ============================================================

// Singleton: only one preview active across all cards
let activeAbort = null
let activeVideo = null

// Shared cancel logic (module-level so startPreview can call it safely)
function cancelActivePreview(timerRef) {
  // Clear debounce timer
  if (timerRef) {
    clearTimeout(timerRef.current)
    timerRef.current = null
  }

  // Abort any in-flight fetch
  if (activeAbort) {
    activeAbort.abort()
    activeAbort = null
  }

  // Stop and hide any playing video
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

  const startPreview = useCallback((url, videoEl) => {
    if (!url || !videoEl) return

    // Cancel any existing preview (use shared function)
    cancelActivePreview(timerRef)

    const abort = new AbortController()
    activeAbort = abort

    timerRef.current = setTimeout(async () => {
      if (abort.signal.aborted) return

      try {
        const res = await fetch(
          `/api/stream-url?url=${encodeURIComponent(url)}`,
          { signal: abort.signal }
        )
        if (!res.ok || abort.signal.aborted) return
        const data = await res.json()
        if (!data.streamUrl || abort.signal.aborted) return

        // Proxy CDN URL to avoid CORS/ORB blocking
        const cdnUrl = data.streamUrl
        videoEl.src = cdnUrl.includes('.m3u8')
          ? `/api/hls-proxy?url=${encodeURIComponent(cdnUrl)}`
          : `/api/proxy-stream?url=${encodeURIComponent(cdnUrl)}`
        videoEl.muted = true
        videoEl.playsInline = true
        videoEl.loop = true
        videoEl.style.opacity = '1'
        activeVideo = videoEl
        videoEl.play().catch(() => {})
      } catch {
        // Aborted or network error — silent
      }
    }, 300)
  }, [])

  const cancelPreview = useCallback(() => {
    cancelActivePreview(timerRef)
  }, [])

  return { startPreview, cancelPreview }
}
