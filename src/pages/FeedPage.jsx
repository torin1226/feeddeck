import { useEffect, useRef, useCallback, useState, lazy, Suspense } from 'react'
import useFeedStore from '../stores/feedStore'
import useDesktopBreakpoint from '../hooks/useDesktopBreakpoint'

const ForYouFeed = lazy(() => import('../components/feed/ForYouFeed'))
const RemixFeed = lazy(() => import('../components/feed/RemixFeed'))
import useModeStore from '../stores/modeStore'
import useQueueStore from '../stores/queueStore'
import useFeedGestures from '../hooks/useFeedGestures'
import FeedVideo from '../components/feed/FeedVideo'
import FeedToast from '../components/feed/FeedToast'
import HeartBurst from '../components/feed/HeartBurst'
import SourceControlSheet from '../components/feed/SourceControlSheet'
import FeedBottomNav from '../components/feed/FeedBottomNav'
import FeedFilterSheet from '../components/feed/FeedFilterSheet'
import QueueSwipeAnimation from '../components/feed/QueueSwipeAnimation'

// ============================================================
// FeedPage
// TikTok-style vertical video feed with scroll-snap.
// Full-viewport, immersive. Works on mobile and desktop.
// ============================================================

export default function FeedPage() {
  const { buffer, currentIndex, loading, initialized, exhausted, initFeed, setCurrentIndex, resetFeed } = useFeedStore()
  const immersive = useFeedStore(s => s.immersive)
  const overlayVisible = useFeedStore(s => s.overlayVisible)
  const { isSFW } = useModeStore()
  const { addToQueue } = useQueueStore()
  const containerRef = useRef(null)
  const prevMode = useRef(isSFW)

  // Toast, heart burst, and source sheet state
  const [toast, setToast] = useState(null)
  const [hearts, setHearts] = useState([])
  const [sourceSheet, setSourceSheet] = useState(null)
  const [showSwipeAnim, setShowSwipeAnim] = useState(false)

  const isDesktop = useDesktopBreakpoint()
  const feedView = useFeedStore(s => s.feedView)
  const setFeedView = useFeedStore(s => s.setFeedView)
  const theatreMode = useFeedStore(s => s.theatreMode)

  // Filter sheet state
  const [filterOpen, setFilterOpen] = useState(false)
  const filters = useFeedStore(s => s.filters)
  const hasActiveFilters = (filters.sources?.length > 0) || (filters.tags?.length > 0)

  // Pull-to-refresh state
  const [refreshing, setRefreshing] = useState(false)
  // Auto-hide nav bar on scroll
  const [navHidden, setNavHidden] = useState(false)
  const lastScrollY = useRef(0)

  // Initialize feed on mount
  useEffect(() => {
    initFeed()
  }, [initFeed])

  // Reset feed when mode changes
  useEffect(() => {
    if (prevMode.current !== isSFW) {
      prevMode.current = isSFW
      resetFeed()
      setTimeout(() => useFeedStore.getState().initFeed(), 0)
    }
  }, [isSFW, resetFeed])

  // Scroll-snap observer: detect which video is snapped
  const observerRef = useRef(null)
  const videoRefs = useRef([])

  const setVideoRef = useCallback((idx, el) => {
    videoRefs.current[idx] = el
  }, [])

  useEffect(() => {
    if (!containerRef.current) return

    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
            const idx = Number(entry.target.dataset.feedIndex)
            if (!isNaN(idx)) setCurrentIndex(idx)
          }
        }
      },
      { root: containerRef.current, threshold: 0.5 }
    )

    videoRefs.current.forEach(el => {
      if (el) observerRef.current.observe(el)
    })

    return () => observerRef.current?.disconnect()
  }, [buffer.length, setCurrentIndex])

  // Gesture callbacks
  const handleSwipeLeft = useCallback(() => {
    const video = buffer[currentIndex]
    if (!video) return
    addToQueue(video)
    setShowSwipeAnim(true)
    setToast({ id: Date.now(), message: '+ Added to queue' })
  }, [buffer, currentIndex, addToQueue])

  const handleSwipeRight = useCallback(() => {
    const video = buffer[currentIndex]
    if (video?.url) window.open(video.url, '_blank')
  }, [buffer, currentIndex])

  const handleDoubleTap = useCallback((e) => {
    const touch = e.changedTouches?.[0]
    const x = touch?.clientX ?? window.innerWidth / 2
    const y = touch?.clientY ?? window.innerHeight / 2
    setHearts(prev => [...prev, { id: Date.now(), x, y }])
  }, [])

  const handleTap = useCallback(() => {
    // In immersive mode, tap flashes the overlay instead of play/pause
    if (useFeedStore.getState().immersive) {
      useFeedStore.getState().flashOverlay()
      return
    }
    // Otherwise, tap to play/pause is handled by FeedVideo directly
  }, [])

  const handleLongPress = useCallback(() => {
    const video = buffer[currentIndex]
    if (video) setSourceSheet(video)
  }, [buffer, currentIndex])

  // Wire gesture hook
  useFeedGestures({
    containerRef,
    onSwipeLeft: handleSwipeLeft,
    onSwipeRight: handleSwipeRight,
    onDoubleTap: handleDoubleTap,
    onTap: handleTap,
    onLongPress: handleLongPress,
  })

  // Pull-to-refresh: when at top and user scrolls further up
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let touchStartY = 0
    let pulling = false

    const onTouchStart = (e) => {
      if (container.scrollTop <= 0) {
        touchStartY = e.touches[0].clientY
        pulling = true
      }
    }

    const onTouchEnd = (e) => {
      if (!pulling) return
      pulling = false
      const dist = e.changedTouches[0].clientY - touchStartY
      if (dist > 100 && currentIndex === 0) {
        setRefreshing(true)
        resetFeed()
        useFeedStore.getState().initFeed().finally(() => setRefreshing(false))
      }
    }

    container.addEventListener('touchstart', onTouchStart, { passive: true })
    container.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      container.removeEventListener('touchstart', onTouchStart)
      container.removeEventListener('touchend', onTouchEnd)
    }
  }, [currentIndex, resetFeed])

  // Theatre mode swipe-up/down (mobile only) + body class
  const theatreTouchStart = useRef(0)
  useEffect(() => {
    if (isDesktop) return
    const container = containerRef.current
    if (!container) return

    const onTouchStart = (e) => {
      theatreTouchStart.current = e.touches[0].clientY
    }
    const onTouchEnd = (e) => {
      const dy = theatreTouchStart.current - e.changedTouches[0].clientY
      const currentTheatreMode = useFeedStore.getState().theatreMode
      if (dy > 80 && !currentTheatreMode) {
        useFeedStore.getState().setTheatreMode(true)
      } else if (dy < -80 && currentTheatreMode) {
        useFeedStore.getState().setTheatreMode(false)
      }
    }

    container.addEventListener('touchstart', onTouchStart, { passive: true })
    container.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      container.removeEventListener('touchstart', onTouchStart)
      container.removeEventListener('touchend', onTouchEnd)
    }
  }, [isDesktop])

  // Sync body class for theatre mode (mobile + desktop)
  useEffect(() => {
    if (theatreMode) {
      document.body.classList.add('theatre-active')
    } else {
      document.body.classList.remove('theatre-active')
    }
    return () => document.body.classList.remove('theatre-active')
  }, [theatreMode])

  // Double-tap left/right for ±10s seek in mobile theatre mode
  const theatreDoubleTapRef = useRef({ lastTap: 0, lastX: null })
  const handleTheatreDoubleTap = useCallback((e) => {
    if (!useFeedStore.getState().theatreMode) return
    const touch = e.changedTouches?.[0]
    if (!touch) return
    const now = Date.now()
    const prev = theatreDoubleTapRef.current
    if (now - prev.lastTap < 300) {
      // Double tap detected
      const { getSharedVideoEl: _getSharedVideoEl } = window.__feedSharedVideo || {}
      // Access shared video via module-level reference through a custom event
      const seekEvent = new CustomEvent('feed:seek', {
        detail: { delta: touch.clientX < window.innerWidth / 2 ? -10 : 10 }
      })
      window.dispatchEvent(seekEvent)
      prev.lastTap = 0 // reset
    } else {
      prev.lastTap = now
      prev.lastX = touch.clientX
    }
  }, [])

  // Keyboard navigation (up/down + left/right for desktop)
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault()
        const next = Math.min(currentIndex + 1, buffer.length - 1)
        videoRefs.current[next]?.scrollIntoView({ behavior: 'smooth' })
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault()
        const prev = Math.max(currentIndex - 1, 0)
        videoRefs.current[prev]?.scrollIntoView({ behavior: 'smooth' })
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        handleSwipeLeft()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        handleSwipeRight()
      } else if (e.key === 'l' || e.key === 'L') {
        // Desktop double-tap equivalent: like
        handleDoubleTap({ changedTouches: [{ clientX: window.innerWidth / 2, clientY: window.innerHeight / 2 }] })
      }
    }

    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [currentIndex, buffer.length, handleSwipeLeft, handleSwipeRight, handleDoubleTap])

  // Immersive mode: auto-hide overlay after 3s
  useEffect(() => {
    if (!immersive || !overlayVisible) return
    const timer = setTimeout(() => {
      useFeedStore.setState({ overlayVisible: false })
    }, 3000)
    return () => clearTimeout(timer)
  }, [immersive, overlayVisible])

  // Auto-hide nav on scroll down, show on scroll up
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const onScroll = () => {
      const y = container.scrollTop
      setNavHidden(y > lastScrollY.current && y > 100)
      lastScrollY.current = y
    }
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => container.removeEventListener('scroll', onScroll)
  }, [])

  // Desktop: show tab bar + selected feed view
  if (isDesktop) {
    return (
      <div className="h-dvh w-full bg-black relative">
        {/* Tab bar — top center, only visible when not in theatre mode */}
        {!theatreMode && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex gap-1 p-1 rounded-full bg-black/40 backdrop-blur-lg border border-white/10">
            {['foryou', 'remix'].map(view => (
              <button
                key={view}
                onClick={() => setFeedView(view)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  feedView === view
                    ? 'bg-white/20 text-white'
                    : 'text-white/50 hover:text-white/70'
                }`}
              >
                {view === 'foryou' ? 'For You' : 'Remix'}
              </button>
            ))}
          </div>
        )}

        <Suspense fallback={<div className="h-dvh bg-black" />}>
          {feedView === 'foryou' ? <ForYouFeed /> : <RemixFeed />}
        </Suspense>
      </div>
    )
  }

  if (!initialized && loading) {
    return (
      <div className="h-dvh w-full bg-black flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" />
          <div className="text-text-muted text-sm animate-pulse">Loading feed...</div>
        </div>
      </div>
    )
  }

  if (initialized && buffer.length === 0) {
    return (
      <div className="h-dvh w-full bg-black flex flex-col items-center justify-center gap-3">
        <div className="text-2xl">📡</div>
        <div className="text-text-muted text-sm font-medium">No videos in feed yet</div>
        <div className="text-text-muted/60 text-xs max-w-[240px] text-center">Add your first source to start discovering videos</div>
        <div className="flex gap-2 mt-4">
          <button
            onClick={() => { import('react-router-dom').then(m => m.default || m).catch(() => {}); window.location.href = '/settings' }}
            className="px-4 py-2 rounded-full bg-accent text-white text-sm font-medium"
          >
            Add Sources
          </button>
          <button
            onClick={() => { useModeStore.getState().toggleMode(); resetFeed(); setTimeout(() => initFeed(), 100) }}
            className="px-4 py-2 rounded-full bg-white/10 text-white text-sm border border-white/20"
          >
            Try {isSFW ? 'NSFW' : 'Social'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      <div
        ref={containerRef}
        className="h-dvh w-full overflow-y-scroll snap-y snap-mandatory bg-black scrollbar-none"
        style={{ scrollBehavior: 'smooth' }}
        onTouchEnd={!isDesktop ? handleTheatreDoubleTap : undefined}
      >
        {buffer.map((video, idx) => (
          <FeedVideo
            key={`${video.id}-${idx}`}
            video={video}
            index={idx}
            isActive={idx === currentIndex}
            setRef={setVideoRef}
            onSourceControl={setSourceSheet}
          />
        ))}

        {loading && (
          <div className="h-dvh w-full snap-start flex items-center justify-center bg-black">
            <div className="text-text-muted text-sm animate-pulse">Loading more...</div>
          </div>
        )}

        {exhausted && (
          <div className="h-dvh w-full snap-start flex flex-col items-center justify-center bg-black gap-3">
            <div className="text-2xl">✓</div>
            <div className="text-text-muted text-sm">You're all caught up</div>
          </div>
        )}
      </div>

      {/* Filter button (top-left) */}
      {(!immersive || overlayVisible) && !theatreMode && (
        <button
          onClick={() => setFilterOpen(true)}
          className={`fixed top-4 left-4 z-50 h-10 rounded-full
            bg-white/10 backdrop-blur-lg border border-white/20
            flex items-center justify-center gap-1.5 text-white/70
            active:scale-95 transition-all px-3
            ${hasActiveFilters ? 'border-accent/40 text-accent' : ''}`}
          aria-label="Filter feed"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
          </svg>
          {hasActiveFilters && (
            <span className="text-[11px] font-semibold">{filters.sources.length + filters.tags.length}</span>
          )}
        </button>
      )}

      {/* Refresh button (top-right, visible when at first video) */}
      {currentIndex === 0 && !refreshing && !theatreMode && (
        <button
          onClick={() => {
            setRefreshing(true)
            resetFeed()
            useFeedStore.getState().initFeed().finally(() => setRefreshing(false))
          }}
          className="fixed top-4 right-4 z-50 w-10 h-10 rounded-full
            bg-white/10 backdrop-blur-lg border border-white/20
            flex items-center justify-center text-white/70
            active:scale-95 transition-transform"
          aria-label="Refresh feed"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>
      )}

      {/* Immersive mode toggle (below refresh or alone in top-right) */}
      {(!immersive || overlayVisible) && !theatreMode && (
        <button
          onClick={() => useFeedStore.getState().toggleImmersive()}
          className={`fixed z-50 w-10 h-10 rounded-full
            bg-white/10 backdrop-blur-lg border border-white/20
            flex items-center justify-center text-white/70
            active:scale-95 transition-all duration-200
            ${currentIndex === 0 && !refreshing ? 'top-16 right-4' : 'top-4 right-4'}`}
          aria-label={immersive ? 'Exit immersive' : 'Enter immersive'}
        >
          {immersive ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3v3a2 2 0 0 1-2 2H3" />
              <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
              <path d="M3 16h3a2 2 0 0 1 2 2v3" />
              <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3H5a2 2 0 0 0-2 2v3" />
              <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
              <path d="M3 16v3a2 2 0 0 0 2 2h3" />
              <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
            </svg>
          )}
        </button>
      )}

      {/* Pull-to-refresh indicator */}
      {refreshing && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full
          bg-white/15 backdrop-blur-lg border border-white/20 text-white text-sm">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Refreshing...
          </div>
        </div>
      )}

      {/* Toast notifications */}
      {toast && (
        <FeedToast
          key={toast.id}
          message={toast.message}
          onDone={() => setToast(null)}
        />
      )}

      {/* Heart burst animations */}
      {hearts.map(h => (
        <HeartBurst
          key={h.id}
          x={h.x}
          y={h.y}
          onDone={() => setHearts(prev => prev.filter(p => p.id !== h.id))}
        />
      ))}

      {/* Queue swipe animation */}
      {showSwipeAnim && (
        <QueueSwipeAnimation onDone={() => setShowSwipeAnim(false)} />
      )}

      {/* Bottom navigation */}
      <FeedBottomNav hidden={navHidden || (immersive && !overlayVisible) || theatreMode} onFilterOpen={() => setFilterOpen(true)} />

      {/* Source control sheet (long-press) */}
      {sourceSheet && (
        <SourceControlSheet
          video={sourceSheet}
          onClose={(action) => {
            if (action === 'hide') {
              setToast({ id: Date.now(), message: 'Source hidden' })
            } else if (action === 'boost') {
              setToast({ id: Date.now(), message: 'Showing more from this source' })
            }
            setSourceSheet(null)
          }}
        />
      )}

      {/* Filter sheet */}
      {filterOpen && (
        <FeedFilterSheet onClose={() => setFilterOpen(false)} />
      )}
    </>
  )
}
