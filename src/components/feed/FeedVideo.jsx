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
    return new Promise((resolve) => {
      _sharedHls = new Hls({ enableWorker: true, lowLatencyMode: false })
      _sharedHls.on(Hls.Events.MANIFEST_PARSED, () => resolve())
      _sharedHls.on(Hls.Events.ERROR, (_, data) => {
        console.error('HLS error:', data.type, data.details)
        resolve()
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

export default function FeedVideo({ video, index, isActive, setRef, onSourceControl }) {
  const videoEl = useRef(null) // points to shared video when active
  const containerEl = useRef(null)
  const [streamUrl, setStreamUrl] = useState(video.streamUrl || null)
  const [streamLoading, setStreamLoading] = useState(false)
  const muted = useFeedStore(s => s.muted)
  const setMuted = useFeedStore(s => s.setMuted)
  const [paused, setPaused] = useState(false)
  const [debugMsg, setDebugMsg] = useState(video.streamUrl ? 'has stream url' : 'init')
  const letterbox = useFeedStore(s => s.letterbox)
  const immersive = useFeedStore(s => s.immersive)
  const overlayVisible = useFeedStore(s => s.overlayVisible)
  const hideOverlay = immersive && !overlayVisible
  const currentIndex = useFeedStore(s => s.currentIndex)

  const shouldLoad = Math.abs(index - currentIndex) <= _getPreloadWindow()

  // Register ref with parent for scrollIntoView
  useEffect(() => {
    setRef(index, containerEl.current)
  }, [index, setRef])

  // Resolve stream URL when within preload range
  useEffect(() => {
    if (!shouldLoad || streamUrl || streamLoading) return
    if (!video.url) return
    if (video.streamUrl) { setStreamUrl(video.streamUrl); return }

    let cancelled = false
    setStreamLoading(true)
    setDebugMsg('fetching stream...')

    fetch(`/api/stream-url?url=${encodeURIComponent(video.url)}`)
      .then(r => r.json())
      .then(data => {
        if (!cancelled && data.streamUrl) {
          setStreamUrl(data.streamUrl)
          setDebugMsg('got stream url')
        } else {
          setDebugMsg('no streamUrl in response')
        }
        setStreamLoading(false)
      })
      .catch((err) => {
        if (!cancelled) {
          setStreamLoading(false)
          setDebugMsg('fetch error: ' + err.message)
        }
      })

    return () => { cancelled = true }
  }, [shouldLoad, video.url, streamUrl, streamLoading])

  // Claim the shared video element when this slot becomes active
  useEffect(() => {
    if (!isActive || !streamUrl || !containerEl.current) return
    let cancelled = false

    const vid = getSharedVideo()
    videoEl.current = vid

    // Move the shared element into this container
    containerEl.current.appendChild(vid)
    vid.style.objectFit = letterbox ? 'contain' : 'cover'

    // Always start muted for autoplay policy compliance
    vid.muted = true

    // Event listeners
    const onPlaying = () => setDebugMsg(`PLAYING muted=${vid.muted}`)
    const onWaiting = () => setDebugMsg('buffering...')
    const onError = () => {
      const err = vid.error
      setDebugMsg('VIDEO ERROR: code=' + err?.code + ' ' + (err?.message || ''))
    }
    vid.addEventListener('playing', onPlaying)
    vid.addEventListener('waiting', onWaiting)
    vid.addEventListener('error', onError)

    setDebugMsg('loading source...')

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
    })

    return () => {
      cancelled = true
      vid.removeEventListener('playing', onPlaying)
      vid.removeEventListener('waiting', onWaiting)
      vid.removeEventListener('error', onError)
      vid.pause()
      if (_sharedHls) { _sharedHls.destroy(); _sharedHls = null }
      videoEl.current = null
    }
  }, [isActive, streamUrl, letterbox])

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
      className="h-dvh w-full snap-start snap-always relative flex items-center justify-center bg-black"
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
      {shouldLoad && streamLoading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
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

      {/* Video info overlay — bottom left (hidden in immersive mode unless flashed) */}
      <div className={`absolute bottom-6 left-4 right-16 z-10 pointer-events-none transition-opacity duration-300
        ${hideOverlay ? 'opacity-0' : 'opacity-100'}`}>
        <div className="text-white text-sm font-semibold leading-tight line-clamp-2 drop-shadow-lg">
          {video.title}
        </div>
        {video.uploader && (
          <div className="text-white/70 text-xs mt-1 drop-shadow-md">
            {video.uploader}
          </div>
        )}
        {video.source && (
          <div className="text-white/50 text-[10px] mt-0.5 uppercase tracking-wider drop-shadow-md">
            {video.source}
          </div>
        )}
      </div>

      {/* Source control button — right side, tap-friendly alternative to long-press */}
      {isActive && (
        <div className={`absolute bottom-20 right-3 z-10 flex flex-col items-center gap-4
          transition-opacity duration-300 ${hideOverlay ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
          <button
            onClick={(e) => { e.stopPropagation(); onSourceControl?.(video) }}
            className="w-10 h-10 rounded-full bg-black/40 backdrop-blur flex items-center justify-center
              text-white/80 active:scale-95 transition-transform"
            aria-label="Source controls"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="12" cy="19" r="2" />
            </svg>
          </button>
        </div>
      )}

      {/* Timeline bar — thin progress at very bottom */}
      {isActive && streamUrl && (
        <FeedTimeline videoRef={videoEl} />
      )}
    </div>
  )
}

// -------------------------------------------------------
// Thin timeline bar at bottom of video
// -------------------------------------------------------
function FeedTimeline({ videoRef }) {
  const barRef = useRef(null)

  useEffect(() => {
    const vid = videoRef.current || getSharedVideo()
    if (!vid) return

    const update = () => {
      if (barRef.current && vid.duration) {
        const pct = (vid.currentTime / vid.duration) * 100
        barRef.current.style.width = `${pct}%`
      }
    }

    vid.addEventListener('timeupdate', update)
    return () => vid.removeEventListener('timeupdate', update)
  }, [videoRef])

  return (
    <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-white/10 z-20">
      <div
        ref={barRef}
        className="h-full bg-white/70 rounded-r-sm"
        style={{ width: '0%', transition: 'width 0.25s linear' }}
      />
    </div>
  )
}
