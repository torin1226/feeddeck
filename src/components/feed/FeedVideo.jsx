import { useRef, useEffect, useState, useCallback } from 'react'
import useFeedStore, { resolveStreamUrl } from '../../stores/feedStore'
import ThumbsRating from '../ThumbsRating'
import { isClickOutSource } from '../../utils/isClickOutSource'

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
async function loadSource(vid, url) {
  if (_sharedHls) {
    _sharedHls.destroy()
    _sharedHls = null
  }

  const isHls = url.includes('.m3u8')

  if (isHls) {
    // hls.js loaded lazily -- only when an HLS stream is encountered
    const { default: Hls } = await import('hls.js')
    if (Hls.isSupported()) {
      // Desktop: use hls.js with proxied URL (same-origin, no ORB)
      vid.removeAttribute('src')
      const proxyUrl = `/api/hls-proxy?url=${encodeURIComponent(url)}`
      return new Promise((resolve, reject) => {
        _sharedHls = new Hls({ enableWorker: true, lowLatencyMode: false })
        _sharedHls.on(Hls.Events.MANIFEST_PARSED, () => resolve())
        _sharedHls.on(Hls.Events.ERROR, (_, data) => {
          console.error('HLS error:', data.type, data.details, data.fatal)
          if (data.fatal) {
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              _sharedHls.startLoad()
            } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              _sharedHls.recoverMediaError()
            } else {
              _sharedHls.destroy()
              _sharedHls = null
              reject(new Error(`HLS fatal: ${data.details}`))
              return
            }
          }
        })
        _sharedHls.loadSource(proxyUrl)
        _sharedHls.attachMedia(vid)
      })
    }
    // HLS not supported (iOS native HLS) -- fall through to proxy-stream
  }

  // MP4 (or HLS on iOS via native) -- proxy through our server to avoid ORB/CORS
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
  // Click-out sources (Instagram) can't be played in-app: yt-dlp's extractor
  // is upstream-broken and static cookies fail. Render a CTA card that opens
  // the source URL in a new tab instead of a broken video element.
  const clickOut = isClickOutSource(video.source)
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

  // Resolve stream URL when within preload range. We always prefer the
  // buffer's already-warmed video.streamUrl over firing our own fetch,
  // even mid-load — that way the warmer's parallel resolve wins and the
  // active slot doesn't sit on a duplicate in-flight request waiting on
  // the same yt-dlp call.
  useEffect(() => {
    if (clickOut) return
    if (!shouldLoad || streamUrl || videoError) return
    if (!video.url) return
    if (video.streamUrl) { setStreamUrl(video.streamUrl); return }
    if (streamLoading) return

    let cancelled = false
    setStreamLoading(true)
    setDebugMsg('fetching stream...')

    // Shared resolver dedupes against feedStore's _warmStreamUrls so
    // we never fire two parallel /api/stream-url requests for the same
    // source URL.
    resolveStreamUrl(video.url).then((resolved) => {
      if (cancelled) return
      if (resolved) {
        setStreamUrl(resolved)
        setDebugMsg('got stream url')
      } else {
        setDebugMsg('stream error: no url')
        setVideoError(true)
      }
      setStreamLoading(false)
    })

    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- streamLoading intentionally omitted to prevent re-trigger loop
  }, [shouldLoad, video.url, video.streamUrl, streamUrl, videoError])

  // Claim the shared video element when this slot becomes active
  useEffect(() => {
    // Click-out items render a static CTA card; never claim the shared <video>.
    if (clickOut) return
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
  }, [clickOut, isActive, streamUrl])

  // Update object-fit when landscape/letterbox changes (without reloading the video)
  useEffect(() => {
    const vid = videoEl.current
    if (!vid) return
    vid.style.objectFit = isLandscape ? 'contain' : (letterbox ? 'contain' : 'cover')
  }, [isLandscape, letterbox])

  // Handle pause/unpause while active
  useEffect(() => {
    if (clickOut) return
    if (!isActive) return
    const vid = getSharedVideo()
    if (paused) {
      vid.pause()
    } else if (vid.paused && vid.src) {
      vid.play().catch(() => {})
    }
  }, [clickOut, paused, isActive])

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

  // Click-out card for sources with no in-app playback (Instagram).
  // Renders the thumbnail behind a clear CTA that opens the source URL in a
  // new tab. Tap target covers the whole card so the gesture matches the
  // rest of the feed; the explicit button is the screen-reader affordance.
  if (clickOut) {
    const openSource = (e) => {
      e?.stopPropagation()
      if (video.url) window.open(video.url, '_blank', 'noopener,noreferrer')
    }
    return (
      <div
        ref={containerEl}
        data-feed-index={index}
        data-click-out="instagram"
        className="w-full snap-start snap-always relative flex items-center justify-center bg-black h-dvh"
        onClick={openSource}
      >
        {video.thumbnail && (
          <img
            src={video.thumbnail}
            alt=""
            className="absolute inset-0 w-full h-full"
            style={{ objectFit: 'cover' }}
            draggable="false"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-black/40 pointer-events-none" />
        <div className="relative z-10 flex flex-col items-center gap-4 px-6 text-center">
          <div className="text-white/90 text-base font-medium max-w-[28ch] line-clamp-3">
            {video.title || 'Instagram Reel'}
          </div>
          <button
            type="button"
            onClick={openSource}
            className="px-5 py-2.5 rounded-full bg-white text-black text-sm font-semibold flex items-center gap-2 active:scale-95 transition-transform shadow-lg"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="5" />
              <circle cx="12" cy="12" r="4" />
              <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
            </svg>
            Open on Instagram
          </button>
          <div className="text-white/55 text-xs">
            Plays in a new tab
          </div>
        </div>
      </div>
    )
  }

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

      {/* Thumbs rating — visible on active video */}
      {isActive && !videoError && streamUrl && (
        <ThumbsRating
          videoUrl={video.url}
          surfaceType="feed_tab"
          surfaceKey="feed"
          tags={[]}
          creator={video.uploader || video.creator || ''}
          title={video.title || ''}
          thumbnail={video.thumbnail || ''}
          source={video.source || ''}
          visible={!_hideOverlay}
          item={video}
        />
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