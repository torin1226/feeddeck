import { useCallback } from 'react'
import useRatingsStore from '../../stores/ratingsStore'

// ============================================================
// FullscreenOverlay
// TV-app style chrome that lives INSIDE the player container.
// Auto-hides on idle (driven by parent via `visible`).
// Top: title/uploader + thumbs up/down + exit (icon-only).
// Bottom: scrubber + transport controls + scroll-for-suggested
//         + Hide Chrome (OS fullscreen toggle).
// In PIP mode (panelOpen), the top bar hides and the bottom row
// simplifies to play/pause + thin progress.
// ============================================================

function fmt(s) {
  if (!Number.isFinite(s)) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60).toString().padStart(2, '0')
  return `${m}:${sec}`
}

export default function FullscreenOverlay({
  item,
  visible,
  panelOpen,
  isPlaying,
  currentTime,
  duration,
  muted,
  isOSFullscreen,
  onTogglePlay,
  onSeekRel,
  onToggleMute,
  onScrubTo,
  onExit,
  onScrollHint,
  onToggleOSFullscreen,
}) {
  const ratedUrls = useRatingsStore((s) => s.ratedUrls)
  const recordRating = useRatingsStore((s) => s.recordRating)
  const undoRating = useRatingsStore((s) => s.undoRating)

  const currentRating = item?.url ? ratedUrls?.[item.url] : null
  const upActive = currentRating === 'up'
  const downActive = currentRating === 'down'

  const handleRate = useCallback((next) => {
    if (!item?.url) return
    const surfaceKey = `watch_page:${item.id}`
    if (currentRating === next) {
      undoRating?.(item.url, surfaceKey)
      fetch('/api/ratings/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: item.url }),
      }).catch(() => {})
      return
    }
    recordRating(item.url, surfaceKey, next)
    fetch('/api/ratings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoUrl: item.url,
        surfaceType: 'watch_page',
        surfaceKey,
        rating: next,
        tags: Array.isArray(item.tags) ? item.tags : [],
        creator: item.uploader || '',
        title: item.title || '',
        thumbnail: item.thumbnail || '',
        source: item.genre || '',
      }),
    }).catch(() => {})
  }, [item, currentRating, recordRating, undoRating])

  const handleScrubClick = useCallback((e) => {
    if (!duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const pct = Math.max(0, Math.min(1, x / rect.width))
    onScrubTo?.(pct * duration)
  }, [duration, onScrubTo])

  const pct = duration > 0 ? (currentTime / duration) * 100 : 0
  const showClasses = visible
    ? 'opacity-100 pointer-events-auto'
    : 'opacity-0 pointer-events-none'

  const PlayIcon = (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
      {isPlaying ? (
        <>
          <rect x="6" y="4" width="4" height="16" />
          <rect x="14" y="4" width="4" height="16" />
        </>
      ) : (
        <polygon points="5 3 19 12 5 21 5 3" />
      )}
    </svg>
  )

  return (
    <div
      className={`absolute inset-0 z-10 flex flex-col justify-between transition-opacity duration-300 ${showClasses}`}
      // Stop click propagation only on the chrome itself so clicks elsewhere
      // (the video) still bubble up to the page-level handlers.
      onClick={(e) => e.stopPropagation()}
    >
      {/* Top bar — hidden in PIP */}
      {!panelOpen && (
        <div
          className="flex items-start justify-between p-7 pb-12"
          style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.8) 0%, transparent 100%)' }}
        >
          <div className="min-w-0 mr-6">
            <div className="text-2xl font-bold tracking-tight font-display [text-shadow:0_2px_12px_rgba(0,0,0,0.8)] line-clamp-2">
              {item?.title}
            </div>
            <div className="text-sm text-white/60 mt-1">
              {item?.uploader ? <span>{item.uploader}</span> : null}
              {item?.views && <span> &middot; {item.views} views</span>}
              {item?.duration && <span> &middot; {item.duration}</span>}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="inline-flex rounded-lg border border-white/20 bg-white/[0.08] backdrop-blur-md overflow-hidden">
              <button
                type="button"
                onClick={() => handleRate('up')}
                aria-pressed={upActive}
                aria-label={upActive ? 'Liked' : 'Like'}
                className={`px-3.5 py-2 transition-colors ${upActive ? 'text-emerald-400 bg-emerald-400/15' : 'text-white/85 hover:bg-white/15'}`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill={upActive ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
                </svg>
              </button>
              <span className="w-px bg-white/15" aria-hidden="true" />
              <button
                type="button"
                onClick={() => handleRate('down')}
                aria-pressed={downActive}
                aria-label={downActive ? 'Not for me' : 'Dislike'}
                className={`px-3.5 py-2 transition-colors ${downActive ? 'text-rose-400 bg-rose-400/15' : 'text-white/85 hover:bg-white/15'}`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill={downActive ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17" />
                </svg>
              </button>
            </div>
            {/* Exit (icon-only) */}
            <button
              type="button"
              onClick={onExit}
              aria-label="Exit fullscreen"
              title="Exit fullscreen"
              className="p-2 rounded-lg border border-white/20 bg-white/[0.08] backdrop-blur-md text-white/85 hover:bg-white/15 transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Bottom bar */}
      <div
        className={panelOpen ? 'px-2 pb-1.5 pt-6' : 'px-7 pb-7 pt-12'}
        style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 100%)' }}
      >
        <div className={`flex items-center gap-3 ${panelOpen ? 'mb-1' : 'mb-3.5'}`}>
          <div
            className="flex-1 h-1 bg-white/20 rounded-full cursor-pointer relative"
            onClick={handleScrubClick}
            role="slider"
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={duration || 0}
            aria-valuenow={currentTime || 0}
            tabIndex={0}
          >
            <div
              className="h-full rounded-full bg-accent relative"
              style={{ width: `${pct}%` }}
            >
              <div className="absolute right-[-6px] top-[-5px] w-3.5 h-3.5 rounded-full bg-white" />
            </div>
          </div>
          <span className={`whitespace-nowrap text-white/70 tabular-nums ${panelOpen ? 'text-[10px]' : 'text-sm'}`}>
            {fmt(currentTime)} / {fmt(duration)}
          </span>
        </div>

        {!panelOpen && (
          <div className="flex items-center gap-3.5">
            <button
              type="button"
              onClick={() => onSeekRel?.(-10)}
              className="p-1.5 rounded-md text-white/85 hover:bg-white/10"
              aria-label="Rewind 10 seconds"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M11 17l-5-5 5-5" /><path d="M19 17l-5-5 5-5" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onTogglePlay}
              className="p-1.5 rounded-md text-white/95 hover:bg-white/10"
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {PlayIcon}
            </button>
            <button
              type="button"
              onClick={() => onSeekRel?.(10)}
              className="p-1.5 rounded-md text-white/85 hover:bg-white/10"
              aria-label="Forward 10 seconds"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M13 17l5-5-5-5" /><path d="M5 17l5-5-5-5" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onToggleMute}
              className="p-1.5 rounded-md text-white/85 hover:bg-white/10"
              aria-label={muted ? 'Unmute' : 'Mute'}
            >
              {muted ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <line x1="23" y1="9" x2="17" y2="15" />
                  <line x1="17" y1="9" x2="23" y2="15" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                </svg>
              )}
            </button>

            <button
              type="button"
              onClick={onScrollHint}
              className="ml-2 px-3 py-1.5 rounded-full text-xs font-semibold text-white/85
                bg-white/[0.06] border border-dashed border-white/25
                hover:bg-accent/20 hover:text-white hover:border-accent/50 transition-colors
                inline-flex items-center gap-1.5"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
              Scroll for suggested
            </button>

            <button
              type="button"
              onClick={onToggleOSFullscreen}
              className="ml-auto px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-2
                bg-accent/20 border border-accent/40 text-violet-200 hover:bg-accent/35 hover:text-white transition-colors"
              aria-label={isOSFullscreen ? 'Exit OS fullscreen' : 'Hide chrome (OS fullscreen)'}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {isOSFullscreen ? (
                  <path d="M8 3v2a2 2 0 0 1-2 2H4M21 8h-2a2 2 0 0 1-2-2V4M3 16h2a2 2 0 0 1 2 2v2M16 21v-2a2 2 0 0 1 2-2h2" />
                ) : (
                  <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                )}
              </svg>
              {isOSFullscreen ? 'Show Chrome' : 'Hide Chrome'}
            </button>
          </div>
        )}

        {panelOpen && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onTogglePlay}
              className="p-1 rounded text-white/95 hover:bg-white/10"
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {PlayIcon}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
