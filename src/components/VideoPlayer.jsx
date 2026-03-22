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
  const [formats, setFormats] = useState([])
  const [selectedQuality, setSelectedQuality] = useState(() => localStorage.getItem('fd-quality') || 'auto')
  const [showQuality, setShowQuality] = useState(false)

  const sfw = getSFWData(video.id)
  const displayTitle = isSFW ? sfw.title : video.title

  // Fetch direct stream URL from backend (yt-dlp resolves the page URL → CDN URL)
  useEffect(() => {
    if (isSFW || !video.url) return
    setStreamLoading(true)
    setFormats([])
    const params = new URLSearchParams({ url: video.url })
    if (selectedQuality !== 'auto') params.set('format', selectedQuality)
    fetch(`/api/stream-url?${params}`)
      .then(r => r.json())
      .then(data => { if (data.streamUrl) setStreamUrl(data.streamUrl) })
      .catch(() => {})
      .finally(() => setStreamLoading(false))
    // Also fetch available formats (async, non-blocking)
    fetch(`/api/stream-formats?url=${encodeURIComponent(video.url)}`)
      .then(r => r.json())
      .then(data => { if (data.formats) setFormats(data.formats) })
      .catch(() => {})
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
        case 'p': case 'P':
          e.preventDefault()
          togglePiP()
          break
        default: break
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [video])

  const handleQualityChange = (quality) => {
    setSelectedQuality(quality)
    localStorage.setItem('fd-quality', quality)
    // Re-fetch stream URL with new format
    if (!video.url) return
    setStreamLoading(true)
    const params = new URLSearchParams({ url: video.url })
    if (quality !== 'auto') params.set('format', quality)
    fetch(`/api/stream-url?${params}`)
      .then(r => r.json())
      .then(data => { if (data.streamUrl) setStreamUrl(data.streamUrl) })
      .catch(() => {})
      .finally(() => setStreamLoading(false))
  }

  const togglePiP = async () => {
    const vid = videoRef.current
    if (!vid || !document.pictureInPictureEnabled) return
    try {
      if (document.pictureInPictureElement === vid) {
        await document.exitPictureInPicture()
      } else {
        await vid.requestPictureInPicture()
      }
    } catch {}
  }

  const handleNext = () => {
    const nextItem = advance()
    if (nextItem) {
      console.log('Queue: advancing to', nextItem.id)
      onPlayVideo?.(nextItem)
    }
  }

  const handleEnded = () => {
    setIsPlaying(false)
    // Mark as fully watched
    useLibraryStore.getState().setWatchProgress(video.id, 1)
    handleNext()
  }

  // Track watch progress periodically for Continue Watching
  useEffect(() => {
    const vid = videoRef.current
    if (!vid || isSFW) return

    const trackProgress = () => {
      if (vid.duration > 0) {
        const progress = vid.currentTime / vid.duration
        useLibraryStore.getState().setWatchProgress(video.id, progress)
      }
    }

    // Update every 5 seconds of playback
    const interval = setInterval(trackProgress, 5000)
    return () => clearInterval(interval)
  }, [video.id, isSFW])

  // Video source: nature clip in Social, resolved stream URL in NSFW
  const videoSrc = isSFW ? SFW_VIDEO : (streamUrl || '')

  return (
    <div className="bg-surface border-b border-surface-border">
      <div className="relative max-w-5xl mx-auto">
        {/* Top controls */}
        <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
          {document.pictureInPictureEnabled && (
            <button
              onClick={togglePiP}
              title="Picture-in-Picture (P)"
              className="w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 transition-colors cursor-pointer"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <rect x="12" y="9" width="8" height="6" rx="1" fill="currentColor" />
              </svg>
            </button>
          )}
          <button
            onClick={onClose}
            aria-label="Close player"
            className="w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 transition-colors text-sm cursor-pointer"
          >
            ✕
          </button>
        </div>

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
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
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
            {/* Quality selector */}
            {!isSFW && formats.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setShowQuality(!showQuality)}
                  className="px-3 py-1.5 rounded-lg text-xs bg-surface-overlay border border-surface-border text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
                >
                  {selectedQuality === 'auto' ? 'Auto' : selectedQuality}
                </button>
                {showQuality && (
                  <div className="absolute right-0 top-full mt-1 bg-surface-raised border border-surface-border rounded-lg shadow-xl z-20 py-1 min-w-[100px]">
                    <button
                      onClick={() => { handleQualityChange('auto'); setShowQuality(false) }}
                      className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${selectedQuality === 'auto' ? 'text-accent' : 'text-text-secondary hover:text-text-primary hover:bg-surface-overlay'}`}
                    >
                      Auto
                    </button>
                    {formats.map(f => (
                      <button
                        key={f.format_id}
                        onClick={() => { handleQualityChange(f.format_id); setShowQuality(false) }}
                        className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${selectedQuality === f.format_id ? 'text-accent' : 'text-text-secondary hover:text-text-primary hover:bg-surface-overlay'}`}
                      >
                        {f.quality}{f.fps > 30 ? ` ${f.fps}fps` : ''}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
