import { useEffect, useRef, useState } from 'react'
import useHomeStore from '../../stores/homeStore'
import usePlayerStore from '../../stores/playerStore'
import useQueueStore from '../../stores/queueStore'
import useLibraryStore from '../../stores/libraryStore'
import HeroCarousel from './HeroCarousel'

// ============================================================
// HeroSection
// Full-viewport hero with featured video background, title
// overlay, action buttons, and carousel strip at the bottom.
// Ken Burns animation on the background image.
// In theatre mode: plays video, hides carousel, expands to
// full screen.
// ============================================================

// Hoisted static styles to avoid re-creating objects on every render
const VIGNETTE_STYLE = {
  background: 'radial-gradient(ellipse at center, transparent 50%, var(--color-surface) 100%)',
}
const GRADIENT_TOP_BG = 'linear-gradient(to top, var(--color-surface) 0%, var(--color-gradient-mid) 30%, var(--color-gradient-faint) 65%, transparent 100%)'
const GRADIENT_RIGHT_BG = 'linear-gradient(to right, var(--color-gradient-solid) 0%, var(--color-gradient-mid) 40%, transparent 75%)'

export default function HeroSection() {
  const { heroItem, theatreMode, toggleTheatre } = useHomeStore()
  const { addToQueue, advance, queue } = useQueueStore()
  const toggleFavorite = useLibraryStore(s => s.toggleFavorite)
  const {
    _activeVideo, setActiveVideo, isPlaying, setPlaying,
    currentTime, setCurrentTime, duration, setDuration,
    streamUrl, streamLoading, streamError, resolveStream, handleStreamError,
  } = usePlayerStore()

  const [previewing, setPreviewing] = useState(false)
  const [showBadge, setShowBadge] = useState(false)
  const badgeTimer = useRef(null)
  const videoRef = useRef(null)

  // Start Ken Burns animation when hero item changes
  useEffect(() => {
    setPreviewing(false)
    requestAnimationFrame(() => {
      setPreviewing(true)
      setShowBadge(true)
      clearTimeout(badgeTimer.current)
      badgeTimer.current = setTimeout(() => setShowBadge(false), 3000)
    })
    return () => clearTimeout(badgeTimer.current)
  }, [heroItem?.id])

  // When theatre mode activates, set active video and resolve stream
  useEffect(() => {
    if (theatreMode && heroItem) {
      setActiveVideo(heroItem)
      if (heroItem.url) {
        resolveStream(heroItem.url)
      }
      setPlaying(true)
    }
    // Only pause on explicit theatre exit, not on every render where !theatreMode
  }, [theatreMode, heroItem?.id])

  // Sync video element with playerStore state
  useEffect(() => {
    const vid = videoRef.current
    if (!vid) return
    if (isPlaying) {
      vid.play().catch(() => {})
    } else {
      vid.pause()
    }
  }, [isPlaying, streamUrl])

  // Video time update → playerStore
  useEffect(() => {
    const vid = videoRef.current
    if (!vid) return

    const onTime = () => setCurrentTime(vid.currentTime)
    const onDur = () => setDuration(vid.duration)
    const onEnd = () => {
      setPlaying(false)
      // Queue autoadvance: play next video in queue when current ends
      const nextItem = advance()
      if (nextItem) {
        setActiveVideo(nextItem)
        if (nextItem.url) resolveStream(nextItem.url)
        setPlaying(true)
      }
    }

    vid.addEventListener('timeupdate', onTime)
    vid.addEventListener('loadedmetadata', onDur)
    vid.addEventListener('ended', onEnd)
    return () => {
      vid.removeEventListener('timeupdate', onTime)
      vid.removeEventListener('loadedmetadata', onDur)
      vid.removeEventListener('ended', onEnd)
    }
  }, [streamUrl])

  // Listen for seek events from TheatreControls
  useEffect(() => {
    function onSeek(e) {
      const vid = videoRef.current
      if (vid && isFinite(e.detail?.time)) {
        vid.currentTime = e.detail.time
      }
    }
    window.addEventListener('theatre-seek', onSeek)
    return () => window.removeEventListener('theatre-seek', onSeek)
  }, [])

  // Theatre mode keyboard shortcuts (Space, arrows, F, M)
  useEffect(() => {
    if (!theatreMode) return

    function handleKey(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      const vid = videoRef.current
      if (!vid) return

      switch (e.key) {
        case ' ':
          e.preventDefault()
          vid.paused ? vid.play() : vid.pause()
          setPlaying(!vid.paused)
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
        default: break
      }
    }

    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [theatreMode])

  if (!heroItem) return null

  return (
    <div
      className={`relative overflow-hidden transition-[height] duration-500 ease-[cubic-bezier(0.25,0.46,0.45,0.94)] ${
        theatreMode ? 'h-screen min-h-screen' : ''
      }`}
      style={theatreMode ? {} : { height: '100vh', minHeight: '540px' }}
    >
      {/* Background image with Ken Burns */}
      {/* Hero thumbnail — uses object-contain to avoid cropping + blurred fill behind for letterbox */}
      <div className="absolute inset-0">
        {/* Blurred scaled-up copy as background fill */}
        <img
          src={heroItem.thumbnail}
          alt=""
          className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-40"
        />
        {/* Sharp centered image */}
        <img
          src={heroItem.thumbnail}
          alt=""
          className={`absolute inset-0 w-full h-full object-contain transition-[src] duration-500 ${
            previewing ? 'animate-kenburns' : ''
          }`}
        />
        {/* Vignette overlay to blend edges into background */}
        <div className="absolute inset-0" style={VIGNETTE_STYLE} />
      </div>

      {/* Video element for theatre mode — proxy CDN URL to avoid CORS/ORB blocking */}
      {theatreMode && streamUrl && (
        <video
          ref={videoRef}
          src={streamUrl.includes('.m3u8')
            ? `/api/hls-proxy?url=${encodeURIComponent(streamUrl)}`
            : `/api/proxy-stream?url=${encodeURIComponent(streamUrl)}`}
          className="absolute inset-0 w-full h-full object-contain z-[1]"
          autoPlay
          playsInline
          onError={handleStreamError}
        />
      )}

      {/* Stream loading indicator */}
      {theatreMode && streamLoading && (
        <div className="absolute inset-0 flex items-center justify-center z-[2]">
          <div className="text-text-secondary text-sm font-medium bg-black/60 px-4 py-2 rounded-lg backdrop-blur">
            Loading stream...
          </div>
        </div>
      )}

      {/* Stream error */}
      {theatreMode && streamError && (
        <div className="absolute inset-0 flex items-center justify-center z-[2]">
          <div className="text-red-400 text-sm font-medium bg-black/60 px-4 py-2 rounded-lg backdrop-blur">
            Stream error: {streamError}
          </div>
        </div>
      )}

      {/* Next-up preview in last 10 seconds */}
      {theatreMode && duration > 0 && (duration - currentTime) <= 10 && (duration - currentTime) > 0 && (() => {
        const next = queue[0]
        if (!next) return null
        return (
          <div className="absolute bottom-20 right-6 z-[3] bg-black/80 backdrop-blur-lg border border-white/10 rounded-lg p-2.5 flex items-center gap-3 animate-fade-slide-in max-w-[260px]">
            {next.thumbnail && (
              <img src={next.thumbnail} alt="" className="w-16 h-9 object-cover rounded flex-none" />
            )}
            <div className="min-w-0">
              <div className="text-[10px] text-text-muted uppercase font-semibold tracking-wider mb-0.5">Up Next</div>
              <div className="text-xs font-medium truncate">{next.title || 'Next video'}</div>
            </div>
          </div>
        )
      })()}

      {/* Gradient overlays — dimmer in theatre mode so video is visible */}
      <div
        className="absolute inset-0 transition-opacity duration-500"
        style={{ background: GRADIENT_TOP_BG, opacity: theatreMode ? 0.3 : 1 }}
      />
      <div
        className="absolute inset-0 transition-opacity duration-500"
        style={{ background: GRADIENT_RIGHT_BG, opacity: theatreMode ? 0.2 : 1 }}
      />

      {/* Preview badge */}
      <div
        className={`absolute top-[72px] right-10 flex items-center gap-1.5
          bg-black/50 border border-white/[0.12] backdrop-blur-lg rounded-md
          px-2.5 py-1.5 text-[11px] font-semibold text-text-secondary
          uppercase tracking-wider transition-opacity duration-400
          ${showBadge && !theatreMode ? 'opacity-100' : 'opacity-0'}`}
      >
        <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
        Preview
      </div>

      {/* Hero content — fades out in theatre mode */}
      <div
        className={`absolute left-10 max-w-[520px] z-10 transition-all duration-500 ease-[cubic-bezier(0.25,0.46,0.45,0.94)] ${
          theatreMode ? 'bottom-24 opacity-0 pointer-events-none' : 'bottom-[230px]'
        }`}
      >
        {/* Tags */}
        <div className="flex gap-1.5 mb-3 flex-wrap">
          <span className="text-[11px] font-semibold text-text-muted">
            {2020 + Math.floor(Math.random() * 6)}
          </span>
          <span className="px-2.5 py-0.5 rounded text-[11px] font-semibold bg-white/10 text-text-secondary tracking-wide">
            {heroItem.genre}
          </span>
          <span className="px-2.5 py-0.5 rounded text-[11px] font-semibold bg-white/10 text-text-secondary tracking-wide">
            {heroItem.duration}
          </span>
        </div>

        {/* Title */}
        <h1 className="font-display text-[clamp(28px,4vw,48px)] font-bold tracking-tighter leading-[1.05] mb-2.5 drop-shadow-[0_2px_20px_rgba(0,0,0,0.5)]">
          {heroItem.title}
        </h1>

        {/* Meta */}
        <div className="flex items-center gap-2.5 text-[13px] text-text-secondary mb-5 flex-wrap">
          <span className="flex items-center gap-1 text-amber-400 font-semibold">
            &#9733; {heroItem.rating}/10
          </span>
          <span className="text-text-muted">&middot;</span>
          <span>{heroItem.views} views</span>
          <span className="text-text-muted">&middot;</span>
          <span>{heroItem.uploader}</span>
          <span className="text-text-muted">&middot;</span>
          <span>{heroItem.daysAgo}d ago</span>
        </div>

        {/* Description */}
        <p className="text-sm text-text-secondary leading-relaxed mb-5 max-w-[400px] font-light line-clamp-2">
          {heroItem.desc}
        </p>

        {/* Actions */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => {
              // Play inline — start video without entering theatre mode
              if (heroItem) {
                setActiveVideo(heroItem)
                if (heroItem.url) resolveStream(heroItem.url)
                setPlaying(true)
              }
            }}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-accent text-white
              text-sm font-semibold hover:bg-accent-hover hover:-translate-y-px transition-all"
          >
            &#9654; &nbsp;Play
          </button>
          <button
            onClick={toggleTheatre}
            className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-lg
              text-sm font-semibold backdrop-blur-lg transition-all
              ${
                theatreMode
                  ? 'bg-accent/15 border border-accent/40 text-red-300'
                  : 'bg-white/10 border border-white/15 text-text-primary hover:bg-white/[0.16]'
              }`}
          >
            {theatreMode ? '\u229E \u00A0Exit Theatre' : '\u26F6 \u00A0Theatre'}
          </button>
          <button
            onClick={() => addToQueue(heroItem)}
            className="w-[42px] h-[42px] rounded-full bg-white/[0.08] border border-white/[0.12]
              text-text-primary text-base flex items-center justify-center
              hover:bg-white/[0.16] transition-all"
            title="Add to queue"
          >
            +
          </button>
          <button
            onClick={() => heroItem?.id && toggleFavorite(heroItem.id)}
            className="w-[42px] h-[42px] rounded-full bg-white/[0.08] border border-white/[0.12]
              text-text-primary text-sm flex items-center justify-center
              hover:bg-white/[0.16] hover:text-accent transition-all active:scale-95"
            title="Like"
            aria-label="Toggle favorite"
          >
            &#9825;
          </button>
        </div>
      </div>

      {/* Carousel strip at bottom */}
      <div
        className={`absolute bottom-0 left-0 right-0 z-20 pb-7 pt-5 transition-all duration-500
          ease-[cubic-bezier(0.25,0.46,0.45,0.94)]
          ${theatreMode ? 'translate-y-[30px] opacity-0 pointer-events-none' : ''}`}
        style={{
          background: 'linear-gradient(to top, var(--color-surface) 0%, transparent 100%)',
        }}
      >
        <HeroCarousel />
      </div>
    </div>
  )
}
