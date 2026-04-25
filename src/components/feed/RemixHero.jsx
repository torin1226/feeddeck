import { useRef, useEffect, useState } from 'react'
import useFeedStore from '../../stores/feedStore'

export default function RemixHero({ video }) {
  const videoRef = useRef(null)
  const hlsRef = useRef(null)
  const [playing, setPlaying] = useState(true)
  const [progress, setProgress] = useState(0)
  const muted = useFeedStore(s => s.muted)

  // Load and autoplay hero video
  useEffect(() => {
    const vid = videoRef.current
    if (!vid || !video) return

    let cancelled = false

    const load = async () => {
      // Cleanup previous
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null }
      vid.removeAttribute('src')

      let url = video.streamUrl
      if (!url && video.url) {
        try {
          const res = await fetch(`/api/stream-url?url=${encodeURIComponent(video.url)}`)
          const data = await res.json()
          url = data.streamUrl
        } catch { return }
      }
      if (cancelled || !url) return

      const isHls = url.includes('.m3u8')
      const proxied = `/api/proxy-stream?url=${encodeURIComponent(url)}`

      if (isHls) {
        if (vid.canPlayType('application/vnd.apple.mpegurl')) {
          vid.src = proxied
        } else {
          // Load hls.js lazily -- only when an HLS stream is needed
          const { default: Hls } = await import('hls.js')
          if (Hls.isSupported()) {
            hlsRef.current = new Hls({ enableWorker: true })
            hlsRef.current.loadSource(proxied)
            hlsRef.current.attachMedia(vid)
          }
        }
      } else {
        vid.src = proxied
      }
      vid.muted = muted
      try { await vid.play(); setPlaying(true) } catch {}
    }

    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video?.id])

  // Sync mute
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted
  }, [muted])

  // Track progress
  useEffect(() => {
    const vid = videoRef.current
    if (!vid) return
    const onTime = () => {
      if (vid.duration) setProgress(vid.currentTime / vid.duration)
    }
    vid.addEventListener('timeupdate', onTime)
    return () => vid.removeEventListener('timeupdate', onTime)
  }, [])

  const togglePlay = () => {
    const vid = videoRef.current
    if (!vid) return
    if (vid.paused) { vid.play(); setPlaying(true) }
    else { vid.pause(); setPlaying(false) }
  }

  if (!video) return null

  return (
    <div className="absolute inset-0">
      {/* Video background */}
      <video
        ref={videoRef}
        className="w-full h-full object-cover"
        playsInline
        loop
        muted={muted}
      />

      {/* Bottom gradient */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.4) 35%, transparent 65%)'
        }}
      />

      {/* Metadata — bottom left */}
      <div className="absolute bottom-36 left-8 max-w-lg pointer-events-none">
        <p className="text-white/50 text-xs uppercase tracking-widest mb-1 font-medium">
          {video.source}
        </p>
        <h2 className="text-white text-3xl font-bold leading-tight mb-1">
          {video.title}
        </h2>
        <p className="text-white/60 text-sm">
          {video.creator}{video.duration ? ` · ${video.duration}` : ''}
        </p>
      </div>

      {/* Play/pause center tap zone */}
      <button
        onClick={togglePlay}
        className="absolute inset-0 w-full h-full flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity pointer-events-auto"
        aria-label={playing ? 'Pause' : 'Play'}
      >
        <div className="w-16 h-16 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center border border-white/20">
          {playing ? (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="white">
              <rect x="4" y="3" width="4" height="14" rx="1" />
              <rect x="12" y="3" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="white">
              <path d="M6 3.5l11 6.5-11 6.5V3.5z" />
            </svg>
          )}
        </div>
      </button>

      {/* Progress bar */}
      <div className="absolute bottom-32 left-8 right-8 h-1 bg-white/20 rounded-full overflow-hidden pointer-events-none">
        <div className="h-full bg-white/50 transition-[width] duration-300" style={{ width: `${progress * 100}%` }} />
      </div>
    </div>
  )
}
