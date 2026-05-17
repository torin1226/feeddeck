import { useCallback } from 'react'

// ============================================================
// StandardChrome
// Slim bottom-only player chrome for standard (in-page) view.
// Mirrors the bottom row of FullscreenOverlay but at smaller
// scale, without exit / hide-chrome / scroll-for-suggested
// (those are fullscreen-only). The wrapper enters fullscreen
// via DetailMeta's existing fullscreen button.
// ============================================================

function fmt(s) {
  if (!Number.isFinite(s)) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60).toString().padStart(2, '0')
  return `${m}:${sec}`
}

export default function StandardChrome({
  isPlaying,
  currentTime,
  duration,
  muted,
  onTogglePlay,
  onSeekRel,
  onToggleMute,
  onScrubTo,
}) {
  const handleScrubClick = useCallback((e) => {
    if (!duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const pct = Math.max(0, Math.min(1, x / rect.width))
    onScrubTo?.(pct * duration)
  }, [duration, onScrubTo])

  const pct = duration > 0 ? (currentTime / duration) * 100 : 0

  const PlayIcon = (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
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
      className="absolute inset-x-0 bottom-0 z-10 px-5 pt-10 pb-3 transition-opacity duration-300 opacity-95 hover:opacity-100"
      style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 100%)' }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-3 mb-2">
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
          <div className="h-full rounded-full bg-accent relative" style={{ width: `${pct}%` }}>
            <div className="absolute right-[-5px] top-[-4px] w-3 h-3 rounded-full bg-white" />
          </div>
        </div>
        <span className="whitespace-nowrap text-white/70 tabular-nums text-xs">
          {fmt(currentTime)} / {fmt(duration)}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onSeekRel?.(-10)}
          className="p-1.5 rounded-md text-white/85 hover:bg-white/10"
          aria-label="Rewind 10 seconds"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
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
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
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
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <line x1="23" y1="9" x2="17" y2="15" />
              <line x1="17" y1="9" x2="23" y2="15" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            </svg>
          )}
        </button>
      </div>
    </div>
  )
}
