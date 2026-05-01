import { useCallback, useEffect, useRef, useState } from 'react'

// ============================================================
// useVideoEngine
// Owns stream resolution, HLS lazy-load, source attachment,
// teardown, and retry-on-error for the detail page <video>.
// Returns a ref + live state so the player chrome can drive UI.
// ============================================================

const isHlsUrl = (u) => typeof u === 'string' && u.includes('.m3u8')

export default function useVideoEngine({ videoUrl, isSFW, sfwSrc }) {
  const videoRef = useRef(null)
  const hlsRef = useRef(null)
  const retriedRef = useRef(false)

  const [streamUrl, setStreamUrl] = useState(null)
  const [streamLoading, setStreamLoading] = useState(false)
  const [streamError, setStreamError] = useState(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [muted, setMuted] = useState(true)

  // Resolve the stream URL whenever the source video changes.
  useEffect(() => {
    if (isSFW || !videoUrl) {
      setStreamUrl(null)
      setStreamError(null)
      return
    }
    let aborted = false
    setStreamUrl(null)
    setStreamError(null)
    setStreamLoading(true)
    retriedRef.current = false
    fetch(`/api/stream-url?url=${encodeURIComponent(videoUrl)}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          throw new Error(body.error || `${r.status} ${r.statusText}`)
        }
        return r.json()
      })
      .then((data) => {
        if (aborted) return
        if (data.streamUrl) setStreamUrl(data.streamUrl)
        else setStreamError('Could not resolve stream')
      })
      .catch((err) => {
        if (aborted) return
        setStreamError(err.message || 'Stream resolution failed')
      })
      .finally(() => {
        if (!aborted) setStreamLoading(false)
      })
    return () => { aborted = true }
  }, [videoUrl, isSFW])

  // Attach the resolved stream (or SFW src) to the <video> element.
  // HLS uses lazy-loaded hls.js with the same proxy pattern as FeedVideo.
  useEffect(() => {
    const vid = videoRef.current
    if (!vid) return undefined

    // Tear down any prior HLS instance before attaching new source
    const teardown = () => {
      if (hlsRef.current) {
        try { hlsRef.current.destroy() } catch { /* ignore */ }
        hlsRef.current = null
      }
    }

    if (isSFW && sfwSrc) {
      teardown()
      vid.src = sfwSrc
      return teardown
    }

    if (!streamUrl) {
      teardown()
      vid.removeAttribute('src')
      vid.load()
      return teardown
    }

    let cancelled = false

    if (isHlsUrl(streamUrl)) {
      // hls.js lazy import — only when an HLS stream is actually played.
      import('hls.js').then(({ default: Hls }) => {
        if (cancelled) return
        if (Hls.isSupported()) {
          teardown()
          vid.removeAttribute('src')
          const proxy = `/api/hls-proxy?url=${encodeURIComponent(streamUrl)}`
          const hls = new Hls({ enableWorker: true, lowLatencyMode: false })
          hls.on(Hls.Events.ERROR, (_, data) => {
            if (data.fatal) {
              if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad()
              else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError()
              else { hls.destroy(); hlsRef.current = null }
            }
          })
          hls.loadSource(proxy)
          hls.attachMedia(vid)
          hlsRef.current = hls
        } else {
          // Native HLS (iOS Safari) — proxy via /api/proxy-stream
          teardown()
          vid.src = `/api/proxy-stream?url=${encodeURIComponent(streamUrl)}`
        }
      }).catch(() => {
        if (cancelled) return
        teardown()
        vid.src = `/api/proxy-stream?url=${encodeURIComponent(streamUrl)}`
      })
    } else {
      teardown()
      vid.src = `/api/proxy-stream?url=${encodeURIComponent(streamUrl)}`
    }

    return () => {
      cancelled = true
      teardown()
    }
  }, [streamUrl, isSFW, sfwSrc])

  // Sync video element events to React state.
  useEffect(() => {
    const vid = videoRef.current
    if (!vid) return undefined
    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    const onTime = () => setCurrentTime(vid.currentTime || 0)
    const onDur = () => setDuration(vid.duration || 0)
    const onVol = () => setMuted(vid.muted)
    const onErr = () => {
      // Auto-retry stale CDN URLs once.
      if (retriedRef.current) {
        setStreamError('Playback error')
        return
      }
      retriedRef.current = true
      setStreamUrl(null)
      setStreamError(null)
      // Re-resolve by re-firing the resolve effect via a tick of streamUrl going null.
      if (videoUrl && !isSFW) {
        setStreamLoading(true)
        fetch(`/api/stream-url?url=${encodeURIComponent(videoUrl)}`)
          .then((r) => r.ok ? r.json() : Promise.reject())
          .then((data) => { if (data.streamUrl) setStreamUrl(data.streamUrl) })
          .catch(() => setStreamError('Playback error'))
          .finally(() => setStreamLoading(false))
      }
    }
    vid.addEventListener('play', onPlay)
    vid.addEventListener('pause', onPause)
    vid.addEventListener('timeupdate', onTime)
    vid.addEventListener('durationchange', onDur)
    vid.addEventListener('volumechange', onVol)
    vid.addEventListener('error', onErr)
    return () => {
      vid.removeEventListener('play', onPlay)
      vid.removeEventListener('pause', onPause)
      vid.removeEventListener('timeupdate', onTime)
      vid.removeEventListener('durationchange', onDur)
      vid.removeEventListener('volumechange', onVol)
      vid.removeEventListener('error', onErr)
    }
  }, [videoUrl, isSFW])

  // Imperative controls
  const togglePlay = useCallback(() => {
    const vid = videoRef.current
    if (!vid) return
    if (vid.paused) vid.play().catch(() => {})
    else vid.pause()
  }, [])

  const toggleMute = useCallback(() => {
    const vid = videoRef.current
    if (!vid) return
    vid.muted = !vid.muted
  }, [])

  const seekRel = useCallback((delta) => {
    const vid = videoRef.current
    if (!vid || !vid.duration) return
    vid.currentTime = Math.max(0, Math.min(vid.duration, vid.currentTime + delta))
  }, [])

  const retryStream = useCallback(() => {
    if (!videoUrl || isSFW) return
    retriedRef.current = false
    setStreamUrl(null)
    setStreamError(null)
    setStreamLoading(true)
    fetch(`/api/stream-url?url=${encodeURIComponent(videoUrl)}`)
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((data) => { if (data.streamUrl) setStreamUrl(data.streamUrl) })
      .catch(() => setStreamError('Stream resolution failed'))
      .finally(() => setStreamLoading(false))
  }, [videoUrl, isSFW])

  return {
    videoRef,
    streamUrl,
    streamLoading,
    streamError,
    isPlaying,
    currentTime,
    duration,
    muted,
    togglePlay,
    toggleMute,
    seekRel,
    retryStream,
  }
}
