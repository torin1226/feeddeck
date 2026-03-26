import { useRef, useCallback } from 'react'

// ============================================================
// useHoverPreview Hook
// Manages hover-to-preview video playback on thumbnail cards.
// Uses a SINGLE shared <video> element that gets moved into
// whichever container is hovered, eliminating per-card video
// elements from the DOM (previously 50+ video tags).
// - 300ms debounce before fetching stream
// - Only 1 preview at a time (new hover cancels previous)
// - Abort on mouseout
// - Plays muted, low-res
// ============================================================

// Singleton shared video element — created once, reused everywhere
let sharedVideoEl = null
let activeAbort = null
let activeContainer = null

function getSharedVideo() {
  if (!sharedVideoEl) {
    sharedVideoEl = document.createElement('video')
    sharedVideoEl.className = 'absolute inset-0 w-full h-full object-cover z-[1] pointer-events-none transition-opacity duration-300'
    sharedVideoEl.style.opacity = '0'
    sharedVideoEl.muted = true
    sharedVideoEl.playsInline = true
    sharedVideoEl.loop = true
  }
  return sharedVideoEl
}

export default function useHoverPreview() {
  const timerRef = useRef(null)

  // startPreview now takes the URL and the container element (the thumbnail wrapper)
  const startPreview = useCallback((url, containerOrVideo) => {
    if (!url || !containerOrVideo) return

    // Cancel any existing preview
    cancelPreview()

    // Determine the container — callers may pass the container div or a video element inside it
    const container = containerOrVideo.tagName === 'VIDEO'
      ? containerOrVideo.parentElement
      : containerOrVideo

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

        const videoEl = getSharedVideo()

        // Move the shared video into this container
        container.appendChild(videoEl)
        activeContainer = container

        // Proxy CDN URL to avoid CORS/ORB blocking
        const cdnUrl = data.streamUrl
        videoEl.src = cdnUrl.includes('.m3u8')
          ? `/api/hls-proxy?url=${encodeURIComponent(cdnUrl)}`
          : `/api/proxy-stream?url=${encodeURIComponent(cdnUrl)}`
        videoEl.style.opacity = '1'
        videoEl.play().catch(() => {})
      } catch {
        // Aborted or network error — silent
      }
    }, 300)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cancelPreview is a stable useCallback ref defined below
  }, [])

  const cancelPreview = useCallback(() => {
    // Clear debounce timer
    clearTimeout(timerRef.current)
    timerRef.current = null

    // Abort any in-flight fetch
    if (activeAbort) {
      activeAbort.abort()
      activeAbort = null
    }

    // Stop and detach the shared video element
    if (sharedVideoEl) {
      sharedVideoEl.pause()
      sharedVideoEl.removeAttribute('src')
      sharedVideoEl.load()
      sharedVideoEl.style.opacity = '0'
    }
    if (activeContainer && sharedVideoEl?.parentElement === activeContainer) {
      activeContainer.removeChild(sharedVideoEl)
    }
    activeContainer = null
  }, [])

  return { startPreview, cancelPreview }
}
