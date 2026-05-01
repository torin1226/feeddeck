import { useEffect, useMemo, useCallback, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import useHomeStore from '../stores/homeStore'
import useQueueStore from '../stores/queueStore'
import useLibraryStore from '../stores/libraryStore'
import useToastStore from '../stores/toastStore'
import useModeStore from '../stores/modeStore'
import HomeHeader from '../components/home/HomeHeader'
import DetailPlayer from '../components/watch/DetailPlayer'
import DetailMeta from '../components/watch/DetailMeta'
import SuggestedRail from '../components/watch/SuggestedRail'
import FullscreenOverlay from '../components/watch/FullscreenOverlay'
import FullscreenSuggestedSheet from '../components/watch/FullscreenSuggestedSheet'
import EndCard from '../components/watch/EndCard'
import useVideoEngine from '../hooks/useVideoEngine'
import useSuggested from '../hooks/useSuggested'
import useViewMode from '../hooks/useViewMode'
import useFullscreenChrome from '../hooks/useFullscreenChrome'

// ============================================================
// VideoDetailPage
// /watch/:id (with /video/:id legacy redirect).
// Two view modes:
//   - standard   : in-page layout, native controls
//   - fullscreen : custom CSS fullscreen + TV-app overlay,
//                  scroll-down to reveal suggested-videos sheet,
//                  optional OS-fullscreen ("Hide Chrome").
// View mode is URL-backed (?view=fullscreen).
//
// Continuous-playback contract: <DetailPlayer> renders at the
// SAME JSX position regardless of viewMode. The wrapper div's
// className changes (in-flow vs fixed inset-0), but the
// <video> DOM node is preserved across mode transitions.
// ============================================================

const SFW_VIDEO = 'https://videos.pexels.com/video-files/856974/856974-hd_1280_720_30fps.mp4'

export default function VideoDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isSFW = useModeStore((s) => s.isSFW)
  const { viewMode, setViewMode } = useViewMode()

  // Locate item across all home-page sources.
  const categories = useHomeStore((s) => s.categories)
  const carouselItems = useHomeStore((s) => s.carouselItems)
  const top10 = useHomeStore((s) => s.top10)
  const heroItem = useHomeStore((s) => s.heroItem)
  const item = useMemo(() => {
    const sId = String(id)
    if (heroItem && String(heroItem.id) === sId) return heroItem
    for (const c of carouselItems || []) if (c && String(c.id) === sId) return c
    for (const c of top10 || []) if (c && String(c.id) === sId) return c
    for (const cat of categories || []) {
      for (const v of (cat.items || [])) {
        if (v && !v._isDivider && String(v.id) === sId) return v
      }
    }
    return null
  }, [id, categories, carouselItems, top10, heroItem])

  // Defensive: clear stale home theatre flag on mount.
  useEffect(() => {
    useHomeStore.getState().setTheatreMode(false)
  }, [])

  // Player engine
  const {
    videoRef,
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
  } = useVideoEngine({
    videoUrl: item?.url,
    isSFW,
    sfwSrc: SFW_VIDEO,
  })

  const scrubTo = useCallback((t) => {
    const v = videoRef.current
    if (!v) return
    if (Number.isFinite(t)) v.currentTime = Math.max(0, Math.min(v.duration || 0, t))
  }, [videoRef])

  // Watch progress reporting
  const setWatchProgress = useLibraryStore((s) => s.setWatchProgress)
  const markWatched = useLibraryStore((s) => s.markWatched)
  useEffect(() => {
    if (item?.id) markWatched(item.id)
  }, [item?.id, markWatched])
  useEffect(() => {
    const vid = videoRef.current
    if (!vid || !item?.id || isSFW) return undefined
    const interval = setInterval(() => {
      if (vid.duration > 0) {
        setWatchProgress(item.id, vid.currentTime / vid.duration)
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [item?.id, isSFW, setWatchProgress, videoRef])

  // Suggested rail data
  const { related, recommended } = useSuggested(item?.id)

  // Queue
  const addToQueue = useQueueStore((s) => s.addToQueue)
  const showToast = useToastStore((s) => s.showToast)
  const queue = useQueueStore((s) => s.queue)
  const queueIndex = useQueueStore((s) => s.currentIndex)
  const handleAddToQueue = useCallback((video) => {
    addToQueue(video || item)
    showToast('Added to queue')
  }, [addToQueue, item, showToast])

  // ── Autoadvance + End Card ─────────────────────────────────
  // Resolve the "next" video: queue-next first, then top suggested.
  const nextItem = useMemo(() => {
    if (queue && queue.length > 0 && queueIndex >= 0 && queueIndex < queue.length - 1) {
      const nextQ = queue[queueIndex + 1]
      if (nextQ) {
        return {
          id: nextQ.id || nextQ.video_url,
          title: nextQ.title,
          thumbnail: nextQ.thumbnail,
          duration: nextQ.duration_formatted || nextQ.durationFormatted,
          uploader: nextQ.uploader || '',
          url: nextQ.url || nextQ.video_url,
          _source: 'queue',
        }
      }
    }
    if (related && related.length > 0) return { ...related[0], _source: 'related' }
    if (recommended && recommended.length > 0) return { ...recommended[0], _source: 'recommended' }
    return null
  }, [queue, queueIndex, related, recommended])

  const [endCardActive, setEndCardActive] = useState(false)
  const [autoAdvanceCancelled, setAutoAdvanceCancelled] = useState(false)

  // Detect video end — show end card unless cancelled
  useEffect(() => {
    const vid = videoRef.current
    if (!vid) return undefined
    const onEnded = () => {
      if (!autoAdvanceCancelled && nextItem) setEndCardActive(true)
    }
    vid.addEventListener('ended', onEnded)
    return () => vid.removeEventListener('ended', onEnded)
  }, [videoRef, nextItem, autoAdvanceCancelled])

  // Reset end-card state when item changes
  useEffect(() => {
    setEndCardActive(false)
    setAutoAdvanceCancelled(false)
  }, [item?.id])

  const advanceNow = useCallback(() => {
    if (!nextItem?.id) return
    setEndCardActive(false)
    const target = viewMode === 'fullscreen'
      ? `/watch/${nextItem.id}?view=fullscreen`
      : `/watch/${nextItem.id}`
    navigate(target)
  }, [nextItem, viewMode, navigate])

  const cancelAutoAdvance = useCallback(() => {
    setEndCardActive(false)
    setAutoAdvanceCancelled(true)
  }, [])

  // ── Fullscreen-only state ───────────────────────────────────
  const isFullscreen = viewMode === 'fullscreen'
  const wrapRef = useRef(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [isOSFullscreen, setIsOSFullscreen] = useState(false)

  const { visible: chromeVisible, reveal: revealChrome } = useFullscreenChrome({
    enabled: isFullscreen,
    rootRef: wrapRef,
    force: panelOpen || !!streamError,
  })

  useEffect(() => {
    if (isFullscreen) {
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = '' }
    }
    setPanelOpen(false)
    return undefined
  }, [isFullscreen])

  useEffect(() => {
    if (!isFullscreen) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (isOSFullscreen) return
        if (panelOpen) { setPanelOpen(false); return }
        setViewMode('standard')
      }
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        setViewMode('standard')
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isFullscreen, panelOpen, isOSFullscreen, setViewMode])

  useEffect(() => {
    const onFsChange = () => setIsOSFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  useEffect(() => {
    if (!isFullscreen) return undefined
    const root = wrapRef.current
    if (!root) return undefined
    let accum = 0
    const onWheel = (e) => {
      const t = e.target
      if (t.closest?.('[data-fs-panel-inner]')) return
      if (t.tagName === 'VIDEO' && !panelOpen) return
      if (e.deltaY > 0 && !panelOpen) {
        accum += e.deltaY
        if (accum > 60) { accum = 0; setPanelOpen(true) }
      } else if (e.deltaY < 0 && panelOpen) {
        if (!t.closest?.('[data-fs-panel-inner]')) setPanelOpen(false)
      }
    }
    root.addEventListener('wheel', onWheel, { passive: true })
    return () => root.removeEventListener('wheel', onWheel)
  }, [isFullscreen, panelOpen])

  useEffect(() => {
    if (!isFullscreen) return undefined
    const root = wrapRef.current
    if (!root) return undefined
    const onClick = (e) => {
      if (panelOpen && e.target.tagName === 'VIDEO') setPanelOpen(false)
    }
    root.addEventListener('click', onClick)
    return () => root.removeEventListener('click', onClick)
  }, [isFullscreen, panelOpen])

  const pickSuggested = useCallback((rv) => {
    if (!rv?.id) return
    const target = isFullscreen ? `/watch/${rv.id}?view=fullscreen` : `/watch/${rv.id}`
    navigate(target)
    setPanelOpen(false)
  }, [navigate, isFullscreen])

  const toggleOSFullscreen = useCallback(() => {
    const root = wrapRef.current
    if (!root) return
    if (isOSFullscreen) {
      document.exitFullscreen?.().catch(() => {})
    } else {
      root.requestFullscreen?.().catch(() => {
        showToast('Browser blocked fullscreen', 'error')
      })
    }
  }, [isOSFullscreen, showToast])

  const onScrollHint = useCallback(() => {
    revealChrome()
    setPanelOpen(true)
  }, [revealChrome])

  if (!item) {
    return (
      <div className="min-h-screen bg-surface text-text-primary font-sans">
        <HomeHeader />
        <div className="flex flex-col items-center justify-center pt-32 gap-4">
          <p className="text-text-muted text-lg">Video not found</p>
          <button
            onClick={() => navigate('/')}
            className="px-6 py-2.5 rounded-full bg-accent text-white font-semibold hover:bg-accent-hover transition-colors"
          >
            Back to Home
          </button>
        </div>
      </div>
    )
  }

  const wrapClass = isFullscreen
    ? 'fixed inset-0 z-50 bg-black overflow-hidden'
    : 'max-w-6xl mx-auto px-6'

  return (
    <div className="min-h-screen bg-surface text-text-primary font-sans">
      {!isFullscreen && <HomeHeader />}

      {!isFullscreen && (
        <div className="px-6 pt-4 pb-2">
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1.5 text-text-muted hover:text-text-primary transition-colors text-sm"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back
          </button>
        </div>
      )}

      {/* The same wrap div hosts all detail content in BOTH modes so React
          preserves the DetailPlayer (and its <video>) across transitions.
          In fullscreen mode, FullscreenOverlay renders INSIDE DetailPlayer
          so chrome scales with the player when it shrinks to PIP. */}
      <div ref={wrapRef} className={wrapClass}>
        <DetailPlayer
          videoRef={videoRef}
          poster={item.thumbnail}
          streamLoading={streamLoading}
          streamError={streamError}
          onRetry={retryStream}
          ariaTitle={item.title}
          mode={isFullscreen ? 'fullscreen' : 'standard'}
          pipMode={isFullscreen && panelOpen}
        >
          {endCardActive && nextItem && (
            <EndCard
              next={nextItem}
              onAdvance={advanceNow}
              onCancel={cancelAutoAdvance}
            />
          )}
          {isFullscreen && (
            <FullscreenOverlay
              item={item}
              visible={chromeVisible}
              panelOpen={panelOpen}
              isPlaying={isPlaying}
              currentTime={currentTime}
              duration={duration}
              muted={muted}
              isOSFullscreen={isOSFullscreen}
              onTogglePlay={togglePlay}
              onSeekRel={seekRel}
              onToggleMute={toggleMute}
              onScrubTo={scrubTo}
              onExit={() => setViewMode('standard')}
              onScrollHint={onScrollHint}
              onToggleOSFullscreen={toggleOSFullscreen}
            />
          )}
        </DetailPlayer>

        {!isFullscreen && (
          <DetailMeta
            item={item}
            onAddToQueue={() => handleAddToQueue(item)}
            onEnterFullscreen={() => setViewMode('fullscreen')}
          />
        )}

        {!isFullscreen && (
          <SuggestedRail
            related={related}
            recommended={recommended}
            onAddToQueue={handleAddToQueue}
          />
        )}

        {isFullscreen && (
          <FullscreenSuggestedSheet
            open={panelOpen}
            related={related}
            recommended={recommended}
            onPickItem={pickSuggested}
            onClose={() => setPanelOpen(false)}
          />
        )}
      </div>
    </div>
  )
}
