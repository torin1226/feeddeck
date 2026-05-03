import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useHomeStore from '../../stores/homeStore'
import usePlayerStore from '../../stores/playerStore'
import useQueueStore from '../../stores/queueStore'
import useRatingsStore from '../../stores/ratingsStore'
import useToastStore from '../../stores/toastStore'
import useHeroAutoplay from '../../hooks/useHeroAutoplay'
import HeroCarousel from './HeroCarousel'

// Strip trailing date-like tokens from titles (raw timestamps shouldn't render in the hero).
const stripTrailingDate = (s) =>
  (s || '').replace(/\s+(\d{4}-\d{2}-\d{2}|\d{4}\.\d{2}\.\d{2}|\b[A-Z][a-z]{2}\s+\d{1,2},?\s+\d{4})\s*$/, '').trim()

// ============================================================
// HeroSection
// Full-viewport hero with featured video background, title
// overlay, action buttons, and carousel strip at the bottom.
// Ken Burns animation on the background image.
// In theatre mode: plays video, hides carousel, expands to
// full screen.
// ============================================================

export default function HeroSection() {
  const { heroItem, theatreMode, setFocusedItem, upNextHidden, toggleUpNextHidden } = useHomeStore()
  const navigate = useNavigate()
  const goWatch = useCallback(() => {
    if (heroItem?.id) navigate(`/watch/${heroItem.id}`)
  }, [heroItem?.id, navigate])
  const { addToQueue, advance, queue } = useQueueStore()
  const {
    setActiveVideo, isPlaying, setPlaying,
    currentTime, setCurrentTime, duration, setDuration,
    streamUrl, streamLoading, streamError, resolveStream, handleStreamError,
    prewarmStream, getPrewarmedUrl,
  } = usePlayerStore()

  const {
    autoplayVideoRef, autoplayReady, autoplayUrl,
    muted: autoplayMuted, toggleMute: toggleAutoplayMute,
  } = useHeroAutoplay(heroItem, theatreMode)

  const recordRating = useRatingsStore(s => s.recordRating)
  const undoRating = useRatingsStore(s => s.undoRating)
  const isToastPaused = useRatingsStore(s => s.isToastPaused)
  const heroRating = useRatingsStore(s => heroItem ? s.ratedUrls[heroItem.url] : null)
  const showToast = useToastStore(s => s.showToast)
  const showActionToast = useToastStore(s => s.showActionToast)

  const handleHeroRate = useCallback(async (rating) => {
    if (!heroItem?.url || heroRating) return
    recordRating(heroItem.url, 'home_hero', rating)
    try {
      await fetch('/api/ratings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrl: heroItem.url, surfaceType: 'home_hero', surfaceKey: null,
          rating, tags: heroItem.tags || [], creator: heroItem.uploader || '',
          title: heroItem.title || '', thumbnail: heroItem.thumbnail || '', source: heroItem.source || '',
        }),
      })
    } catch (err) { console.warn('Hero rating failed:', err.message) }
    if (rating === 'down') {
      showActionToast("Got it. We'll show less like this.", {
        position: 'bottom', timeout: 10000,
        actions: [{ label: 'Undo', primary: true, onClick: () => {
          undoRating(heroItem.url, 'home_hero')
          fetch('/api/ratings/undo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoUrl: heroItem.url }) }).catch(() => {})
        }}],
      })
    } else if (!isToastPaused() && heroItem.uploader) {
      showToast(`Saved. More from ${heroItem.uploader} coming your way.`, 'success')
    }
  }, [heroItem, heroRating, recordRating, undoRating, isToastPaused, showToast, showActionToast])

  const [previewing, setPreviewing] = useState(false)
  const [showBadge, setShowBadge] = useState(false)
  const badgeTimer = useRef(null)
  const videoRef = useRef(null)

  // Start Ken Burns animation and pre-warm stream URL when hero item changes
  useEffect(() => {
    setPreviewing(false)
    requestAnimationFrame(() => {
      setPreviewing(true)
      setShowBadge(true)
      clearTimeout(badgeTimer.current)
      badgeTimer.current = setTimeout(() => setShowBadge(false), 3000)
    })
    // Pre-warm the stream URL so Play is instant (covers reduced motion / HLS cases
    // where useHeroAutoplay doesn't resolve a URL)
    if (heroItem?.url) prewarmStream(heroItem.url)
    // Hero is the default focused surface — claim focus when the hero
    // card changes and theatre mode is off. inputKind 'auto' marks this
    // as a non-user-driven claim so debounce-aware consumers can treat
    // it as background state rather than intentional hover/keyboard.
    if (heroItem && !theatreMode) setFocusedItem(heroItem, 'hero', { inputKind: 'auto' })
    return () => clearTimeout(badgeTimer.current)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heroItem?.id, theatreMode])

  // When theatre mode activates, set active video and resolve stream.
  // Priority: autoplay URL > prewarmed URL > fresh resolve
  useEffect(() => {
    if (theatreMode && heroItem) {
      setActiveVideo(heroItem)
      if (autoplayUrl) {
        // Reuse the pre-resolved stream URL from autoplay — instant transition
        usePlayerStore.setState({ streamUrl: autoplayUrl, streamLoading: false, streamError: null })
      } else if (heroItem.url) {
        const prewarmed = getPrewarmedUrl(heroItem.url)
        if (prewarmed) {
          // Use pre-warmed URL (covers reduced motion / HLS cases)
          usePlayerStore.setState({ streamUrl: prewarmed, streamLoading: false, streamError: null })
        } else {
          // Fallback: resolve fresh
          resolveStream(heroItem.url)
        }
      }
      setPlaying(true)
    } else if (!theatreMode) {
      setPlaying(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- heroItem?.id avoids re-runs when object ref changes; store fns are stable
  }, [theatreMode, heroItem?.id, autoplayUrl, resolveStream, setActiveVideo, setPlaying])

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
  }, [streamUrl, advance, resolveStream, setActiveVideo, setCurrentTime, setDuration, setPlaying])

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
  }, [theatreMode, setPlaying])

  if (!heroItem) return null

  return (
    <div
      className={`relative overflow-hidden transition-[height] duration-500 ease-[cubic-bezier(0.25,0.46,0.45,0.94)] ${
        theatreMode ? 'h-screen min-h-screen' : ''
      }`}
      style={theatreMode ? {} : { height: '100vh', minHeight: '600px' }}
    >
      {/* Full-bleed background — single object-cover thumbnail, darkened.
          Autoplay video replaces it when ready. */}
      <div className="absolute inset-0">
        <img
          src={heroItem.thumbnail}
          alt=""
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 ${
            previewing && !autoplayReady ? 'animate-kenburns' : ''
          } ${autoplayReady ? 'opacity-0' : ''}`}
          style={{ filter: 'brightness(0.6) saturate(1.1)' }}
        />
        {!theatreMode && autoplayUrl && (
          <video
            ref={autoplayVideoRef}
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 ${
              autoplayReady ? 'opacity-100' : 'opacity-0'
            }`}
            style={{ filter: 'brightness(0.6) saturate(1.1)' }}
            muted
            playsInline
            loop
          />
        )}
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

      {/* Bottom scrim — covers bottom 70%, fades into page bg */}
      <div
        className="absolute inset-x-0 bottom-0 h-[70%] transition-opacity duration-500 pointer-events-none"
        style={{
          background:
            'linear-gradient(to top, var(--color-surface) 0%, rgba(10,10,12,0.8) 30%, rgba(10,10,12,0.3) 60%, transparent 100%)',
          opacity: theatreMode ? 0.3 : 1,
        }}
      />
      {/* Left scrim — covers left 60%, full height */}
      <div
        className="absolute inset-y-0 left-0 w-[60%] transition-opacity duration-500 pointer-events-none"
        style={{
          background:
            'linear-gradient(to right, rgba(10,10,12,0.7) 0%, transparent 100%)',
          opacity: theatreMode ? 0.2 : 1,
        }}
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

      {/* Mute/unmute toggle for hero autoplay video — top-right slot adjacent to Preview badge */}
      {autoplayReady && !theatreMode && (
        <button
          onClick={toggleAutoplayMute}
          className="absolute top-[68px] right-[68px] z-10
            w-9 h-9 rounded-full bg-black/50 border border-white/[0.12]
            backdrop-blur-lg flex items-center justify-center
            text-text-secondary hover:text-text-primary hover:bg-black/70
            transition-all duration-200"
          title={autoplayMuted ? 'Unmute' : 'Mute'}
          aria-label={autoplayMuted ? 'Unmute hero video' : 'Mute hero video'}
        >
          {autoplayMuted ? (
            // Muted icon (speaker with X)
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <line x1="23" y1="9" x2="17" y2="15" />
              <line x1="17" y1="9" x2="23" y2="15" />
            </svg>
          ) : (
            // Unmuted icon (speaker with waves)
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            </svg>
          )}
        </button>
      )}

      {/* Hero content — bottom-left, sits above the Up Next carousel (or above progress bar when hidden) */}
      <div
        className={`absolute left-12 max-w-[550px] z-10 transition-all duration-500 ease-[cubic-bezier(0.25,0.46,0.45,0.94)] ${
          theatreMode ? 'bottom-24 opacity-0 pointer-events-none' : (upNextHidden ? 'bottom-[40px]' : 'bottom-[212px]')
        }`}
      >
        {/* Title — 30/600/1.15, line-clamp 2, dates stripped */}
        <h1
          className="font-display text-[30px] font-semibold leading-[1.15] text-text-primary overflow-hidden"
          style={{
            letterSpacing: '-0.8px',
            textShadow: '0 2px 16px rgba(0,0,0,0.5)',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {stripTrailingDate(heroItem.title)}
        </h1>

        {/* Meta line — uploader · source · duration · views (plain inline, no chips) */}
        <div className="flex items-center gap-2 mt-2 text-[12px] text-white/50 font-medium">
          {heroItem.uploader && <span className="truncate max-w-[200px]">{heroItem.uploader}</span>}
          {heroItem.uploader && heroItem.genre && (
            <span className="w-[3px] h-[3px] rounded-full bg-white/30 flex-none" />
          )}
          {heroItem.genre && <span>{heroItem.genre}</span>}
          {heroItem.duration && (
            <>
              <span className="w-[3px] h-[3px] rounded-full bg-white/30 flex-none" />
              <span>{heroItem.duration}</span>
            </>
          )}
          {heroItem.views && (
            <>
              <span className="w-[3px] h-[3px] rounded-full bg-white/30 flex-none" />
              <span>{heroItem.views} views</span>
            </>
          )}
        </div>

        {/* Action row — Play + Queue + Thumbs Up + Thumbs Down. All 38px tall. */}
        <div className="flex items-center gap-2 mt-[14px]">
          <button
            onClick={goWatch}
            className="inline-flex items-center gap-2 h-[38px] px-6 rounded-[10px]
              bg-white text-[#0a0a0c] text-[13px] font-semibold
              transition-transform duration-200 hover:scale-[1.03]"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
            Play
          </button>

          <HeroIconButton
            onClick={() => {
              addToQueue(heroItem)
              showToast('Added to queue', 'success')
            }}
            title="Add to queue"
            ariaLabel="Add to queue"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </HeroIconButton>

          <HeroIconButton
            onClick={() => !heroRating && handleHeroRate('up')}
            title={heroRating === 'up' ? 'Liked' : 'Like this'}
            ariaLabel={heroRating === 'up' ? 'Liked' : 'Like this'}
            active={heroRating === 'up'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 9V5a3 3 0 00-3-3l-4 9v11h11.28a2 2 0 002-1.7l1.38-9a2 2 0 00-2-2.3zM7 22H4a2 2 0 01-2-2v-7a2 2 0 012-2h3" />
            </svg>
          </HeroIconButton>

          <HeroIconButton
            onClick={() => !heroRating && handleHeroRate('down')}
            title={heroRating === 'down' ? 'Not for me' : 'Not interested'}
            ariaLabel={heroRating === 'down' ? 'Not for me' : 'Not interested'}
            active={heroRating === 'down'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 15v4a3 3 0 003 3l4-9V2H5.72a2 2 0 00-2 1.7l-1.38 9a2 2 0 002 2.3zm7-13h2.67A2.31 2.31 0 0122 4v7a2.31 2.31 0 01-2.33 2H17" />
            </svg>
          </HeroIconButton>
        </div>
      </div>

      {/* Progress bar — sits at the visual baseline of the thumbnail (just above carousel).
          When Up Next is hidden, it falls to the absolute bottom of the hero.
          2px → 4px on hover. Edge-to-edge. */}
      {!theatreMode && (
        <div
          className="hero-progress absolute left-0 right-0 z-10 transition-[bottom] duration-300 ease-out"
          style={{ bottom: upNextHidden ? '0px' : '188px', height: '14px' }}
        >
          <div
            className="hero-progress__track absolute left-0 right-0 bottom-0 transition-[height] duration-200 ease-out"
            style={{ height: '2px', background: 'rgba(255,255,255,0.08)' }}
          >
            <div
              className="h-full"
              style={{
                width: duration > 0 ? `${Math.min(100, (currentTime / duration) * 100)}%` : '0%',
                background: 'var(--color-accent)',
                transition: 'width 200ms linear',
              }}
            />
          </div>
        </div>
      )}

      {/* Carousel strip at bottom — wrapper has pointer-events-none so its
          transparent top-padding doesn't intercept clicks meant for the
          action row sitting just above. Hidden when upNextHidden — carousel
          re-renders as a normal row in HomePage below the hero. */}
      {!upNextHidden && (
        <div
          className={`absolute bottom-0 left-0 right-0 z-20 pb-3 pt-2 transition-all duration-500
            ease-[cubic-bezier(0.25,0.46,0.45,0.94)] pointer-events-none
            ${theatreMode ? 'translate-y-[30px] opacity-0' : ''}`}
          style={{
            background: 'linear-gradient(to top, var(--color-surface) 0%, transparent 100%)',
          }}
        >
          <HeroCarousel />
        </div>
      )}

      {/* Hide / Show Up Next toggle — small chevron in the hero, top-right corner of the carousel band */}
      {!theatreMode && (
        <button
          onClick={toggleUpNextHidden}
          title={upNextHidden ? 'Show Up Next in hero' : 'Hide Up Next'}
          aria-label={upNextHidden ? 'Show Up Next in hero' : 'Hide Up Next'}
          className="absolute z-30 right-4 w-7 h-7 rounded-md flex items-center justify-center
            bg-black/40 border border-white/[0.08] backdrop-blur-md text-white/60
            hover:text-white hover:bg-black/60 hover:border-white/[0.18] transition-all duration-200"
          style={{ bottom: upNextHidden ? '14px' : '198px' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            {upNextHidden ? (
              <polyline points="18 15 12 9 6 15" />
            ) : (
              <polyline points="6 9 12 15 18 9" />
            )}
          </svg>
        </button>
      )}
    </div>
  )
}

// 38x38 glass-style icon button used by the hero action row.
// Shared treatment: rgba(255,255,255,0.08) bg, 1px rgba(255,255,255,0.1) border,
// blur(8px) backdrop, icon at rgba(255,255,255,0.6) — hover lifts to 0.15/white/0.2.
// Active variant locks bg/icon at the hover state to indicate a recorded rating.
function HeroIconButton({ onClick, title, ariaLabel, active = false, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      className={`hero-icon-btn group/heroBtn w-[38px] h-[38px] rounded-[10px]
        flex items-center justify-center transition-all duration-200 flex-none
        ${active
          ? 'bg-white/[0.15] border border-white/[0.2] text-white'
          : 'bg-white/[0.08] border border-white/[0.1] text-white/60 hover:bg-white/[0.15] hover:border-white/[0.2] hover:text-white'}`}
      style={{ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
    >
      {children}
    </button>
  )
}
