import { useState, useRef, useEffect } from 'react'
import { useSwipeable } from 'react-swipeable'
import clsx from 'clsx'
import useModeStore from '../stores/modeStore'
import useLibraryStore from '../stores/libraryStore'
import useQueueStore from '../stores/queueStore'
import useToastStore from '../stores/toastStore'

// ============================================================
// MobileSwipeView
// TikTok-style full-screen vertical swipe interface.
// Swipe up = next, swipe down = previous.
// Overlay UI auto-hides after 3s.
// ============================================================

export default function MobileSwipeView() {
  const { isSFW, toggleMode } = useModeStore()
  const { videos, toggleFavorite, markWatched } = useLibraryStore()
  const { addToQueue } = useQueueStore()
  const showToast = useToastStore(s => s.showToast)

  const displayVideos = videos

  const [index, setIndex] = useState(0)
  const [showOverlay, setShowOverlay] = useState(true)
  const hideTimer = useRef(null)

  const current = displayVideos[index]
  const display = current
    ? {
        title: current.title,
        thumbnail: current.thumbnail,
        views: current.views,
        channel: current.channel || current.source,
        duration: current.durationFormatted,
      }
    : null

  // Auto-hide overlay
  const showAndScheduleHide = () => {
    setShowOverlay(true)
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setShowOverlay(false), 3000)
  }

  useEffect(() => {
    showAndScheduleHide()
    return () => clearTimeout(hideTimer.current)
  }, [index])

  // Mark watched on view
  useEffect(() => {
    if (current && !current.isDemo) {
      markWatched(current.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id])

  const goNext = () => index < displayVideos.length - 1 && setIndex(i => i + 1)
  const goPrev = () => index > 0 && setIndex(i => i - 1)

  const handlers = useSwipeable({
    onSwipedUp: goNext,
    onSwipedDown: goPrev,
    preventScrollOnSwipe: true,
    trackMouse: false,
    delta: 50,
  })

  if (!current) {
    return (
      <div className="h-dvh flex items-center justify-center bg-surface text-text-muted">
        <p>No content yet</p>
      </div>
    )
  }

  return (
    <div
      {...handlers}
      className="h-dvh w-full bg-black relative overflow-hidden select-none"
      onClick={showAndScheduleHide}
    >
      {/* Full-screen content */}
      {display?.thumbnail ? (
        <img
          src={display.thumbnail}
          alt={current.title}
          className="absolute inset-0 w-full h-full object-cover"
          draggable={false}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-surface text-6xl">
          ▶
        </div>
      )}

      {/* Gradient overlays */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/30 pointer-events-none" />

      {/* UI overlay */}
      <div className={clsx(
        'absolute inset-0 transition-opacity duration-300 pointer-events-none',
        showOverlay ? 'opacity-100' : 'opacity-0'
      )}>
        {/* Top bar */}
        <div className="absolute top-0 left-0 right-0 flex items-center justify-between p-4 pointer-events-auto">
          <span className="text-xs text-white/50">{index + 1} / {displayVideos.length}</span>
          <button
            onClick={(e) => { e.stopPropagation(); toggleMode() }}
            className={clsx(
              'px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
              isSFW
                ? 'bg-sfw/30 text-sfw border border-sfw/40'
                : 'bg-white/10 text-white/80 border border-white/20'
            )}
          >
            {isSFW ? 'Social' : 'FD'}
          </button>
        </div>

        {/* Bottom info + actions */}
        <div className="absolute bottom-0 left-0 right-0 p-4 pb-8 pointer-events-auto">
          <h2 className="text-sm font-semibold mb-1 line-clamp-2">{display?.title}</h2>
          <p className="text-xs text-white/50 mb-4">
            {display?.channel}{display?.views ? ` · ${display.views}` : ''}
          </p>

          {/* Action row */}
          {!isSFW && current && !current.isDemo && (
            <div className="flex items-center gap-5">
              <ActionButton
                icon={current.favorite ? '♥' : '♡'}
                label={current.favorite ? 'Liked' : 'Like'}
                active={current.favorite}
                onClick={() => toggleFavorite(current.id)}
              />
              <ActionButton
                icon="+"
                label="Queue"
                onClick={() => { addToQueue(current); showToast('Added to queue') }}
              />
            </div>
          )}
        </div>

        {/* Swipe direction hints */}
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex flex-col gap-1 items-center text-white/20 pointer-events-none">
          {index > 0 && (
            <svg className="w-5 h-5 animate-bounce" style={{ animationDirection: 'reverse' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 15l7-7 7 7" />
            </svg>
          )}
          {index < displayVideos.length - 1 && (
            <svg className="w-5 h-5 animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 9l-7 7-7-7" />
            </svg>
          )}
        </div>
      </div>
    </div>
  )
}

function ActionButton({ icon, label, active, onClick }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick?.() }}
      className={clsx(
        'flex flex-col items-center gap-1 transition-colors',
        active ? 'text-accent' : 'text-white'
      )}
    >
      <span className="text-2xl leading-none">{icon}</span>
      <span className="text-micro">{label}</span>
    </button>
  )
}
