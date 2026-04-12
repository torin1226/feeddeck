import { useRef, useEffect, useState, useCallback } from 'react'
import Hls from 'hls.js'
import useFeedStore from '../../stores/feedStore'

// ============================================================
// FeedVideo
// Single video in the vertical feed. Fills 100dvh, scroll-snaps.
//
// KEY DESIGN: Uses a singleton <video> DOM element shared across
// all FeedVideo instances. This preserves the user's gesture
// activation — once they tap to unmute, the same element stays
// unmuted across src changes (iOS WebKit requires gesture per element).
//
// HLS support: PornHub only serves HLS (.m3u8). iOS Safari plays
// HLS natively. Other browsers use hls.js.
// ============================================================

// Module-level singleton video element — survives React re-renders
let _sharedVideo = null
let _sharedHls = null
function getSharedVideo() {
  if (_sharedVideo && !_sharedVideo.parentNode) {
    _sharedVideo = null
    _sharedHls = null
  }
  if (!_sharedVideo) {
    _sharedVideo = document.createElement('video')
    _sharedVideo.playsInline = true
    _sharedVideo.loop = true
    _sharedVideo.preload = 'auto'
    _sharedVideo.muted = true
    _sharedVideo.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;background:black;object-fit:cover;'
  }
  return _sharedVideo
}

// Detect iOS (all iOS browsers are WebKit and support HLS natively)
const _isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

// Adaptive preload window based on connection quality
function _getPreloadWindow() {
  const conn = navigator.connection
  if (!conn) return _isIOS ? 2 : 3 // default: conservative on iOS, wider on desktop
  const type = conn.effectiveType
  if (type === '4g') return 4
  if (type === '3g') return 2
  return 1 // 2g or slow-2g
}

// Load a URL into the shared video.
// All CDN URLs go through /api/proxy-stream to avoid ORB blocking on desktop
// and ensure correct Referer headers. iOS could play direct but proxying
// keeps behavior consistent and avoids CORS issues.
// Returns a Promise that resolves when the media is ready to play.
function loadSource(vid, url) {
  // Destroy previous hls.js instance
  if (_sharedHls) {
    _sharedHls.destroy()
    _sharedHls = null
  }

  const isHls = url.includes('.m3u8')

  if (isHls && Hls.isSupported()) {
    // Desktop: use hls.js with proxied URL (same-origin, no ORB)
    vid.removeAttribute('src')
    const proxyUrl = `/api/hls-proxy?url=${encodeURIComponent(url)}`
    return new Promise((resolve, reject) => {
      _sharedHls = new Hls({ enableWorker: true, lowLatencyMode: false })
      _sharedHls.on(Hls.Events.MANIFEST_PARSED, () => resolve())
      _sharedHls.on(Hls.Events.ERROR, (_, data) => {
        console.error('HLS error:', data.type, data.details, data.fatal)
        if (data.fatal) {
          // Fatal error — attempt recovery or reject
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            _sharedHls.startLoad() // try to recover network errors
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            _sharedHls.recoverMediaError() // try to recover media errors
          } else {
            // Unrecoverable — destroy and reject
            _sharedHls.destroy()
            _sharedHls = null
            reject(new Error(`HLS fatal: ${data.details}`))
            return
          }
        }
        // Non-fatal errors: resolve and let playback continue
        // (hls.js handles recovery internally for non-fatal)
      })
      _sharedHls.loadSource(proxyUrl)
      _sharedHls.attachMedia(vid)
    })
  }

  // MP4 (or HLS on iOS) — proxy through our server to avoid ORB/CORS
  const proxyUrl = `/api/proxy-stream?url=${encodeURIComponent(url)}`
  return new Promise((resolve) => {
    let done = false
    const finish = () => { if (!done) { done = true; resolve() } }
    vid.addEventListener('canplay', finish, { once: true })
    vid.src = proxyUrl
    setTimeout(finish, 5000)
  })
}

export default function FeedVideo({ video, index, isActive, setRef, _onSourceControl }) {
  const videoEl = useRef(null) // points to shared video when active
  const containerEl = useRef(null)
  const [streamUrl, setStreamUrl] = useState(video.streamUrl || null)
  const [streamLoading, setStreamLoading] = useState(false)
  const streamRetries = useRef(0)
  const [videoError, setVideoError] = useState(false)
  const muted = useFeedStore(s => s.muted)
  const setMuted = useFeedStore(s => s.setMuted)
  const [paused, setPaused] = useState(false)
  const [isLandscape, setIsLandscape] = useState(false)
  const [debugMsg, setDebugMsg] = useState(video.streamUrl ? 'has stream url' : 'init')
  const letterbox = useFeedStore(s => s.letterbox)
  const immersive = useFeedStore(s => s.immersive)
  const overlayVisible = useFeedStore(s => s.overlayVisible)
  const _hideOverlay = immersive && !overlayVisible
  const currentIndex = useFeedStore(s => s.currentIndex)

  const shouldLoad = Math.abs(index - currentIndex) <= _getPreloadWindow()

  // Register ref with parent for scrollIntoView
  useEffect(() => {
    setRef(index, containerEl.current)
  }, [index, setRef])

  // Resolve stream URL when within preload range
  useEffect(() => {
    if (!shouldLoad || streamUrl || streamLoading || videoError) return
    if (!video.url) return
    if (video.streamUrl) { setStreamUrl(video.streamUrl); return }

    const controller = new AbortController()
    setStreamLoading(true)
    setDebugMsg('fetching stream...')

    fetch(`/api/stream-url?url=${encodeURIComponent(video.url)}`, { signal: controller.signal })
      .then(r => r.json())
      .then(data => {
        if (data.streamUrl) {
          setStreamUrl(data.streamUrl)
          setDebugMsg('got stream url')
        } else {
          setDebugMsg('stream error: ' + (data.error || 'no url'))
          setVideoError(true)
        }
        setStreamLoading(false)
      })
      .catch((err) => {
        if (err.name === 'AbortError') return // cleanup cancelled this fetch
        setStreamLoading(false)
        setDebugMsg('fetch error: ' + err.message)
        setVideoError(true)
      })

    return () => { controller.abort() }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- streamLoading intentionally omitted to prevent re-trigger loop
  }, [shouldLoad, video.url, video.streamUrl, streamUrl, videoError])

  // Claim the shared video element when this slot becomes active
  useEffect(() => {
    if (!isActive || !streamUrl || !containerEl.current) {
      // Always return cleanup even when early-exiting, so that if
      // conditions change mid-cycle any prior setup is torn down.
      return () => {
        const vid = videoEl.current
        if (vid) {
          vid.pause()
          if (vid.parentNode) vid.parentNode.removeChild(vid)
          if (_sharedHls) { _sharedHls.destroy(); _sharedHls = null }
          videoEl.current = null
        }
      }
    }
    let cancelled = false

    const vid = getSharedVideo()
    videoEl.current = vid

    // Move the shared element into this container
    containerEl.current.appendChild(vid)

    // Always start muted for autoplay policy compliance
    vid.muted = true

    // Event listeners
    const onPlaying = () => setDebugMsg(`PLAYING muted=${vid.muted}`)
    const onWaiting = () => setDebugMsg('buffering...')
    const onError = () => {
      const err = vid.error
      setDebugMsg('VIDEO ERROR: code=' + err?.code + ' ' + (err?.message || ''))
      // Retry once with a fresh stream URL (catches expired CDN URLs)
      if (streamUrl && streamRetries.current < 1) {
        streamRetries.current++
        setStreamUrl(null)
        setStreamLoading(false)
        setDebugMsg('retrying stream URL...')
      } else {
        setVideoError(true)
      }
    }
    const onLoadedMetadata = () => {
      if (vid.videoWidth && vid.videoHeight) {
        setIsLandscape(vid.videoWidth / vid.videoHeight > 1.5)
      }
    }
    vid.addEventListener('playing', onPlaying)
    vid.addEventListener('waiting', onWaiting)
    vid.addEventListener('error', onError)
    vid.addEventListener('loadedmetadata', onLoadedMetadata)

    setDebugMsg('loading source...')
    setVideoError(false)

    // Load source (waits for HLS manifest if needed), then play.
    // Always attempt play — the separate pause/unpause effect will
    // immediately pause if the user tapped pause during loading.
    loadSource(vid, streamUrl).then(() => {
      if (cancelled) return

      setDebugMsg('playing muted...')
      vid.play().then(() => {
        if (cancelled) return
        // Now try to unmute if user previously unmuted (gesture is on this element)
        const wantsMuted = useFeedStore.getState().muted
        if (!wantsMuted) {
          vid.muted = false
          // If iOS silently re-mutes or pauses, just keep going muted
          if (vid.paused) {
            vid.muted = true
            vid.play().catch(() => {})
          }
        }
        setDebugMsg(`PLAYING muted=${vid.muted}`)
      }).catch(() => {
        setDebugMsg('autoplay failed, retrying muted...')
        vid.muted = true
        vid.play().catch(() => {})
      })
    }).catch((err) => {
      if (!cancelled) {
        setDebugMsg(`HLS load failed: ${err.message}`)
        setVideoError(true)
      }
    })

    const onSeek = (e) => {
      if (vid.duration) {
        vid.currentTime = Math.max(0, Math.min(vid.duration, vid.currentTime + e.detail.delta))
      }
    }
    window.addEventListener('feed:seek', onSeek)

    return () => {
      cancelled = true
      vid.removeEventListener('playing', onPlaying)
      vid.removeEventListener('waiting', onWaiting)
      vid.removeEventListener('error', onError)
      vid.removeEventListener('loadedmetadata', onLoadedMetadata)
      window.removeEventListener('feed:seek', onSeek)
      vid.pause()
      if (vid.parentNode) vid.parentNode.removeChild(vid)
      if (_sharedHls) { _sharedHls.destroy(); _sharedHls = null }
      videoEl.current = null
    }
  }, [isActive, streamUrl])

  // Update object-fit when landscape/letterbox changes (without reloading the video)
  useEffect(() => {
    const vid = videoEl.current
    if (!vid) return
    vid.style.objectFit = isLandscape ? 'contain' : (letterbox ? 'contain' : 'cover')
  }, [isLandscape, letterbox])

  // Handle pause/unpause while active
  useEffect(() => {
    if (!isActive) return
    const vid = getSharedVideo()
    if (paused) {
      vid.pause()
    } else if (vid.paused && vid.src) {
      vid.play().catch(() => {})
    }
  }, [paused, isActive])

  // Tap to unmute or play/pause
  const handleTap = useCallback((e) => {
    if (e.target.closest('button') || e.target.closest('a')) return
    const vid = getSharedVideo()
    if (!vid.src) return

    if (vid.muted) {
      // User gesture — unmute the shared element (persists across videos!)
      vid.muted = false
      setMuted(false)
      setDebugMsg('user unmuted')
    } else {
      setPaused(p => !p)
    }
  }, [setMuted])

  const objectFit = letterbox ? 'contain' : 'cover'

  return (
    <div
      ref={containerEl}
      data-feed-index={index}
      className={`w-full snap-start snap-always relative flex items-center justify-center bg-black ${isLandscape ? 'min-h-[60dvh]' : 'h-dvh'}`}
      onClick={handleTap}
    >
      {/* Thumbnail placeholder — shown when this slot is NOT active */}
      {video.thumbnail && !isActive && (
        <img
          src={video.thumbnail}
          alt=""
          className="absolute inset-0 w-full h-full"
          style={{ objectFit }}
          draggable="false"
        />
      )}

      {/* The shared <video> element is appended via DOM when active — no React <video> here */}

      {/* Loading spinner overlay */}
      {shouldLoad && streamLoading && !videoError && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        </div>
      )}

      {/* Error recovery card */}
      {videoError && isActive && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black z-20 gap-4">
          <div className="text-text-muted text-sm font-medium">Couldn't load this video</div>
          <div className="flex gap-3">
            <button
              onClick={(e) => {
                e.stopPropagation()
                setVideoError(false)
                streamRetries.current = 0
                setStreamUrl(null)
                setStreamLoading(false)
              }}
              className="px-4 py-2 bg-surface-overlay border border-surface-border rounded-lg text-white text-sm font-medium active:scale-95 transition-transform"
            >
              Tap to retry
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setVideoError(false)
                useFeedStore.getState().setCurrentIndex(currentIndex + 1)
              }}
              className="px-4 py-2 bg-surface-overlay border border-surface-border rounded-lg text-text-muted text-sm font-medium active:scale-95 transition-transform"
            >
              Skip
            </button>
          </div>
        </div>
      )}

      {/* Paused indicator */}
      {paused && isActive && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-16 h-16 rounded-full bg-black/50 flex items-center justify-center">
            <span className="text-white text-2xl ml-1">▶</span>
          </div>
        </div>
      )}

      {/* Muted indicator */}
      {muted && isActive && !paused && streamUrl && (
        <div className="absolute top-4 right-4 w-8 h-8 rounded-full bg-black/50 flex items-center justify-center pointer-events-none z-30">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <line x1="23" y1="9" x2="17" y2="15" />
            <line x1="17" y1="9" x2="23" y2="15" />
          </svg>
        </div>
      )}

      {/* DEBUG overlay — dev only */}
      {import.meta.env.DEV && isActive && (
        <div className="absolute top-12 left-2 right-2 z-50 px-2 py-1 bg-red-900/80 text-white text-[10px] font-mono rounded pointer-events-none whitespace-pre-wrap">
          {debugMsg}
          {'\n'}muted={String(muted)} paused={String(paused)} load={String(streamLoading)}
          {'\n'}type={streamUrl?.includes('.m3u8') ? 'HLS' : 'MP4'} iOS={String(_isIOS)}
          {'\n'}url={streamUrl ? streamUrl.substring(0, 60) + '...' : 'none'}
        </div>
      )}
    </div>
  )
}