import { useRef, useEffect, useState, useCallback } from 'react'

// ============================================================
// useHeroAutoplay Hook
// Pre-resolves the stream URL for the current hero item and
// auto-plays a muted looping video as the hero background.
// Falls back to static thumbnail on error or if the user
// prefers reduced motion.
// ============================================================

export default function useHeroAutoplay(heroItem, theatreMode) {
  const videoRef = useRef(null)
  const abortRef = useRef(null)
  const [autoplayUrl, setAutoplayUrl] = useState(null)
  const [autoplayReady, setAutoplayReady] = useState(false)
  const [autoplayError, setAutoplayError] = useState(false)
  const [muted, setMuted] = useState(true)

  // Check prefers-reduced-motion
  const [reducedMotion, setReducedMotion] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false
  })

  useEffect(() => {
    const mql = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mql) return
    const handler = (e) => setReducedMotion(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])

  // Resolve stream URL when heroItem changes
  useEffect(() => {
    // Reset state
    setAutoplayUrl(null)
    setAutoplayReady(false)
    setAutoplayError(false)

    // Don't autoplay if: no hero, no real URL, in theatre mode, or reduced motion
    if (!heroItem?.url || theatreMode || reducedMotion) return

    const abort = new AbortController()
    abortRef.current = abort

    async function resolve() {
      try {
        const res = await fetch(
          `/api/stream-url?url=${encodeURIComponent(heroItem.url)}`,
          { signal: abort.signal }
        )
        if (!res.ok || abort.signal.aborted) return
        const data = await res.json()
        if (!data.streamUrl || abort.signal.aborted) return

        // Skip HLS for autoplay (too heavy for background preview)
        if (data.streamUrl.includes('.m3u8')) return

        setAutoplayUrl(data.streamUrl)
      } catch (e) {
        if (e.name !== 'AbortError') {
          setAutoplayError(true)
        }
      }
    }

    resolve()

    return () => {
      abort.abort()
      abortRef.current = null
    }
  }, [heroItem?.id, heroItem?.url, theatreMode, reducedMotion])

  // When autoplayUrl changes, load the video
  useEffect(() => {
    const vid = videoRef.current
    if (!vid || !autoplayUrl) return

    const proxiedUrl = `/api/proxy-stream?url=${encodeURIComponent(autoplayUrl)}`
    vid.src = proxiedUrl
    vid.muted = true
    vid.playsInline = true
    vid.loop = true
    vid.preload = 'auto'
    vid.load()

    const onCanPlay = () => {
      setAutoplayReady(true)
      vid.play().catch(() => {
        // Autoplay blocked — fall back to thumbnail
        setAutoplayError(true)
      })
    }

    const onError = () => {
      setAutoplayError(true)
      setAutoplayReady(false)
    }

    vid.addEventListener('canplay', onCanPlay, { once: true })
    vid.addEventListener('error', onError, { once: true })

    return () => {
      vid.removeEventListener('canplay', onCanPlay)
      vid.removeEventListener('error', onError)
    }
  }, [autoplayUrl])

  // Sync muted state to video element
  useEffect(() => {
    const vid = videoRef.current
    if (vid) vid.muted = muted
  }, [muted])

  // Pause autoplay when theatre mode activates (theatre has its own video)
  useEffect(() => {
    const vid = videoRef.current
    if (!vid) return
    if (theatreMode) {
      vid.pause()
    } else if (autoplayReady && autoplayUrl && !reducedMotion) {
      vid.play().catch(() => {})
    }
  }, [theatreMode, autoplayReady, autoplayUrl, reducedMotion])

  const toggleMute = useCallback(() => {
    setMuted(prev => !prev)
  }, [])

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort()
    }
  }, [])

  return {
    autoplayVideoRef: videoRef,
    autoplayReady: autoplayReady && !autoplayError && !theatreMode && !reducedMotion,
    autoplayUrl,
    muted,
    toggleMute,
    reducedMotion,
  }
}
