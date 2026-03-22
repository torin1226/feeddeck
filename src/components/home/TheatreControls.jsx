import { useRef, useState } from 'react'
import useHomeStore from '../../stores/homeStore'
import usePlayerStore from '../../stores/playerStore'
import useQueueStore from '../../stores/queueStore'

// ============================================================
// TheatreControls
// Floating pill-shaped control bar at bottom center during
// theatre mode. Wired to playerStore for real playback state.
// ============================================================

function fmtTime(s) {
  if (!s || !isFinite(s)) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export default function TheatreControls() {
  const { heroItem, theatreMode, toggleTheatre } = useHomeStore()
  const { isPlaying, setPlaying, currentTime, duration } = usePlayerStore()
  const { advance } = useQueueStore()
  const progressRef = useRef(null)

  if (!theatreMode || !heroItem) return null

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  function handleProgressClick(e) {
    if (!progressRef.current || duration <= 0) return
    const rect = progressRef.current.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    // Dispatch a custom event that HeroSection's video element listens for
    window.dispatchEvent(new CustomEvent('theatre-seek', { detail: { time: pct * duration } }))
  }

  return (
    <div
      className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[300]
        bg-[rgba(14,14,16,0.9)] backdrop-blur-[20px] border border-surface-border
        rounded-full px-5 py-2.5 flex items-center gap-4 whitespace-nowrap
        shadow-[0_8px_40px_rgba(0,0,0,0.6)]"
    >
      <span className="text-xs text-text-secondary font-medium">
        {isPlaying ? '\u25B6 Playing' : '\u23F8 Paused'}
      </span>
      <span className="text-[13px] font-semibold max-w-[200px] truncate">
        {heroItem.title}
      </span>

      {/* Separator */}
      <div className="w-px h-4 bg-white/10" />

      <button
        onClick={() => setPlaying(!isPlaying)}
        className="text-text-primary text-lg hover:bg-white/10 rounded-md px-1.5 py-1 transition-colors"
        title={isPlaying ? 'Pause' : 'Play'}
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying ? '\u23F8' : '\u25B6'}
      </button>
      <button
        onClick={() => advance()}
        className="text-text-primary text-lg hover:bg-white/10 rounded-md px-1.5 py-1 transition-colors"
        title="Next"
        aria-label="Next video"
      >
        &#9197;
      </button>

      {/* Progress bar */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-text-muted tabular-nums">{fmtTime(currentTime)}</span>
        <div
          ref={progressRef}
          onClick={handleProgressClick}
          className="w-[140px] h-[3px] bg-white/15 rounded-sm relative cursor-pointer overflow-hidden"
        >
          <div
            className="h-full bg-accent rounded-sm transition-[width] duration-100"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-[11px] text-text-muted tabular-nums">{fmtTime(duration)}</span>
      </div>

      <SpeedSelector />

      <button
        onClick={toggleTheatre}
        title="Exit theatre"
        aria-label="Exit theatre mode"
        className="w-7 h-7 rounded-full bg-white/[0.08] text-text-secondary text-[13px]
          flex items-center justify-center hover:bg-white/[0.16] hover:text-text-primary
          transition-all ml-1"
      >
        &#10005;
      </button>
    </div>
  )
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]

function SpeedSelector() {
  const [speed, setSpeed] = useState(1)

  function cycle() {
    const idx = SPEEDS.indexOf(speed)
    const next = SPEEDS[(idx + 1) % SPEEDS.length]
    setSpeed(next)
    // Apply to all video elements on page
    document.querySelectorAll('video').forEach(v => { v.playbackRate = next })
  }

  return (
    <button
      onClick={cycle}
      title={`Speed: ${speed}x`}
      className="text-[11px] font-semibold text-text-secondary hover:text-text-primary
        hover:bg-white/10 rounded-md px-1.5 py-1 transition-colors tabular-nums"
    >
      {speed === 1 ? '1x' : `${speed}x`}
    </button>
  )
}
