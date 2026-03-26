import { useRef, useEffect, useState, memo } from 'react'
import Hls from 'hls.js'
import useFeedStore from '../../stores/feedStore'

const ForYouSlot = memo(function ForYouSlot({ video, index, isActive, onVideoRef }) {
  const videoRef = useRef(null)
  const hlsRef = useRef(null)
  const theatreMode = useFeedStore(s => s.theatreMode)
  const muted = useFeedStore(s => s.muted)
  const [progress, setProgress] = useState(0)
  const [resolving, setResolving] = useState(false)

  // Expose video element to parent when active
  useEffect(() => {
    if (isActive && videoRef.current && onVideoRef) {
      onVideoRef(videoRef.current)
    }
  }, [isActive, onVideoRef])

  // Resolve stream URL and play when active
  useEffect(() => {
    if (!isActive) {
      // Pause and detach
      const vid = videoRef.current
      if (vid) { vid.pause(); vid.removeAttribute('src'); vid.load() }
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null }
      return
    }

    let cancelled = false
    const vid = videoRef.current
    if (!vid) return

    const play = async () => {
      let url = video.streamUrl
      if (!url && video.url) {
        setResolving(true)
        try {
          const res = await fetch(`/api/stream-url?url=${encodeURIComponent(video.url)}`)
          const data = await res.json()
          url = data.streamUrl
          // Update buffer so we don't re-resolve
          if (url) {
            const state = useFeedStore.getState()
            const idx = state.buffer.findIndex(b => b.id === video.id)
            if (idx !== -1) {
              const updated = [...state.buffer]
              updated[idx] = { ...updated[idx], streamUrl: url }
              useFeedStore.setState({ buffer: updated })
            }
          }
        } catch { /* fallback below */ }
        setResolving(false)
      }

      if (cancelled || !url) return

      const isHls = url.includes('.m3u8')
      if (isHls) {
        if (vid.canPlayType('application/vnd.apple.mpegurl')) {
          // Native HLS (Safari/iOS)
          vid.src = `/api/proxy-stream?url=${encodeURIComponent(url)}`
        } else if (Hls.isSupported()) {
          hlsRef.current = new Hls({ enableWorker: true, lowLatencyMode: false })
          hlsRef.current.loadSource(`/api/proxy-stream?url=${encodeURIComponent(url)}`)
          hlsRef.current.attachMedia(vid)
        }
      } else {
        vid.src = `/api/proxy-stream?url=${encodeURIComponent(url)}`
      }

      vid.muted = muted
      try { await vid.play() } catch { /* autoplay blocked */ }
    }

    play()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- muted/video.streamUrl/video.url are used inside async play(); re-running on their change would restart playback
  }, [isActive, video.id])

  // Sync mute state
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted
  }, [muted])

  // Track progress
  useEffect(() => {
    const vid = videoRef.current
    if (!vid || !isActive) return
    const onTime = () => {
      if (vid.duration) setProgress(vid.currentTime / vid.duration)
    }
    vid.addEventListener('timeupdate', onTime)
    return () => vid.removeEventListener('timeupdate', onTime)
  }, [isActive])

  return (
    <div
      data-slot-index={index}
      className="relative h-dvh flex-shrink-0 snap-start bg-black"
      style={{ width: '100vw' }}
    >
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        playsInline
        loop
        preload="none"
      />

      {/* Resolving spinner */}
      {isActive && resolving && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-10 h-10 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" />
        </div>
      )}

      {/* Light overlay — hidden in theatre mode */}
      {!theatreMode && (
        <>
          {/* Bottom gradient + metadata */}
          <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black/80 via-black/30 to-transparent pointer-events-none" />
          <div className="absolute bottom-8 left-8 z-10 max-w-md">
            <p className="text-white/50 text-xs uppercase tracking-widest mb-1 font-medium">{video.source}</p>
            <h2 className="text-white text-2xl font-bold leading-tight">{video.title}</h2>
            {video.creator && <p className="text-white/60 text-sm mt-1">{video.creator}</p>}
          </div>

          {/* Theatre button — top right */}
          <button
            onClick={() => useFeedStore.getState().setTheatreMode(true)}
            className="absolute top-8 right-8 z-10 px-3 py-1.5 rounded-full bg-black/40 backdrop-blur-lg text-white/70 text-sm font-medium border border-white/10 hover:bg-black/60 hover:text-white transition-colors"
            aria-label="Enter theatre mode"
          >
            ⛶ Theatre
          </button>

          {/* Thin progress bar at bottom */}
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/10 z-10">
            <div
              className="h-full bg-white/40 transition-[width] duration-300"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        </>
      )}
    </div>
  )
})

export default ForYouSlot
