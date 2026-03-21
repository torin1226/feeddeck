import { useEffect, useRef, useState } from 'react'
import useModeStore from '../stores/modeStore'
import useQueueStore from '../stores/queueStore'
import useLibraryStore from '../stores/libraryStore'
import { getSFWData } from '../data/socialData'

// ============================================================
// VideoPlayer
// Full-width player above the grid. Handles keyboard shortcuts,
// queue advancement, and Social mode (shows neutral video instead).
// ============================================================

// Royalty-free nature video for Social mode
const SFW_VIDEO = 'https://videos.pexels.com/video-files/856974/856974-hd_1280_720_30fps.mp4'

export default function VideoPlayer({ video, onClose, onPlayVideo }) {
  const videoRef = useRef(null)
  const { isSFW } = useModeStore()
  const { advance, queue } = useQueueStore()
  const { markWatched } = useLibraryStore()
  const [isPlaying, setIsPlaying] = useState(false)
  const [streamUrl, setStreamUrl] = useState(null)
  const [streamLoading, setStreamLoading] = useState(false)

  const sfw = getSFWData(video.id)
  const displayTitle = isSFW ? sfw.title : video.title

  // Fetch direct stream URL from backend (yt-dlp resolves the page URL → CDN URL)
  useEffect(() => {
    if (isSFW || !video.url) return
    setStreamLoading(true)
    fetch(`/api/stream-url?url=${encodeURIComponent(video.url)}`)
      .then(r => r.json())
      .then(data => { if (data.streamUrl) setStreamUrl(data.streamUrl) })
      .catch(() => {})
      .finally(() => setStreamLoading(false))
  }, [video.url, isSFW])

  // Mark video as watched on mount
  useEffect(() => {
    markWatched(video.id)
  }, [video.id])

  // Player-specific keyboard shortcuts
  useEffect(() => {
    const handleKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      const vid = videoRef.current
      if (!vid) return

      switch (e.key) {
        case ' ':
          e.preventDefault()
          vid.paused ? vid.play() : vid.pause()
          break
        case 'ArrowLeft':
          e.preventDefault()
          vid.currentTime = Math.max(0, vid.currentTime - 5)
          break
        case 'ArrowRight':
          e.preventDefault()
          vid.currentTime = Math.min(vid.duration || 0, vid.currentTime + 5)
          break
        case 'ArrowUp':
          e.preventDefault()
          vid.volume = Math.min(1, vid.volume + 0.1)
          break
        case 'ArrowDown':
          e.preventDefault()
          vid.volume = Math.max(0, vid.volume - 0.1)
          break
        case 'f': case 'F':
          e.preventDefault()
          document.fullscreenElement ? document.exitFullscreen() : vid.requestFullscreen?.()
          break
        case 'm': case 'M':
          e.preventDefault()
          vid.muted = !vid.muted
          break
        case 'n': case 'N':
          e.preventDefault()
          handleNext()
          break
        default: break
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [video])

  const handleNext = () => {
    const nextItem = advance()
    if (nextItem) {
      console.log('Queue: advancing to', nextItem.id)
      onPlayVideo?.(nextItem)
    }
  }

  const handleEnded = () => {
    setIsPlaying(false)
    handleNext()
  }

  // Video source: nature clip in Social, resolved stream URL in NSFW
  const videoSrc = isSFW ? SFW_VIDEO : (streamUrl || '')

  return (
    <div className="bg-surface border-b border-surface-border">
      <div className="relative max-w-5xl mx-auto">
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-black/60
            text-white flex items-center justify-center hover:bg-black/80 transition-colors text-sm"
        >
          ✕
        </button>

        {/* Video area */}
        <div className="aspect-video bg-black">
          {videoSrc ? (
            <video
              ref={videoRef}
              src={videoSrc}
              className="w-full h-full object-contain"
              controls
              autoPlay={!isSFW}
              muted={isSFW}
              loop={isSFW}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onEnded={handleEnded}
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-text-muted gap-3 relative">
              {video.thumbnail && (
                <img
                  src={isSFW ? sfw.thumbnail : video.thumbnail}
                  alt=""
                  className="absolute inset-0 w-full h-full object-contain opacity-40"
                />
              )}
              {streamLoading ? (
                <div className="relative flex flex-col items-center gap-2">
                  <div className="w-8 h-8 border-2 border-text-muted border-t-white rounded-full animate-spin" />
                  <p className="text-sm">Loading stream...</p>
                </div>
              ) : (
                <div className="relative flex flex-col items-center gap-2">
                  <span className="text-5xl">▶</span>
                  <p className="text-sm">Could not load stream</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Info bar */}
        <div className="px-4 py-3">
          <h2 className="text-base font-semibold text-text-primary mb-1">{displayTitle}</h2>
          <div className="flex items-center gap-3 text-sm text-text-muted">
            <span>{isSFW ? sfw.channel : (video.channel || video.source)}</span>
            <span>·</span>
            <span>{isSFW ? sfw.views : video.views}</span>
            {queue.length > 0 && (
              <>
                <span>·</span>
                <span className="text-accent">{queue.length} in queue</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
