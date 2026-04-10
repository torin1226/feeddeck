import { useState, useEffect } from 'react'

export default function NextUpDialog({ videoRef, nextVideo, onAdvance }) {
  const [visible, setVisible] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [countdown, setCountdown] = useState(1) // 1 = full, 0 = empty

  // Reset dismissed state when next video changes
  useEffect(() => {
    setDismissed(false)
    setVisible(false)
    setCountdown(1)
  }, [nextVideo?.id])

  // Track video time to show/hide dialog
  useEffect(() => {
    const video = videoRef?.current
    if (!video || !nextVideo || dismissed) {
      setVisible(false)
      return
    }

    const onTime = () => {
      const dur = video.duration
      if (!dur || dur < 5) return // too short, no dialog

      const remaining = dur - video.currentTime
      const triggerTime = Math.min(30, dur * 0.8)

      if (remaining <= triggerTime && remaining > 0) {
        setVisible(true)
        setCountdown(Math.max(0, remaining / triggerTime))
      } else {
        setVisible(false)
        setCountdown(1)
      }
    }

    const onEnded = () => {
      if (!dismissed) onAdvance()
    }

    video.addEventListener('timeupdate', onTime)
    video.addEventListener('ended', onEnded)
    return () => {
      video.removeEventListener('timeupdate', onTime)
      video.removeEventListener('ended', onEnded)
    }
  }, [videoRef, nextVideo, dismissed, onAdvance])

  // "All caught up" variant when no next video
  if (visible && !nextVideo) {
    return (
      <div
        className="absolute bottom-20 right-4 z-50 w-[280px] rounded-xl bg-black/60 backdrop-blur-xl border border-white/10 shadow-2xl p-4 text-center"
        style={{ animation: 'foryou-slideInRight 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards' }}
      >
        <div className="text-2xl mb-2">✓</div>
        <p className="text-white text-sm font-medium">You're all caught up</p>
        <p className="text-white/50 text-xs mt-1">Pull in more videos or try a different mode</p>
        <style>{`
          @keyframes foryou-slideInRight {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
          }
        `}</style>
      </div>
    )
  }

  if (!visible || dismissed || !nextVideo) return null

  return (
    <div
      className="absolute bottom-20 right-4 z-50 w-[280px] rounded-xl bg-black/60 backdrop-blur-xl border border-white/10 shadow-2xl overflow-hidden cursor-pointer hover:border-white/20 transition-colors"
      style={{ animation: 'foryou-slideInRight 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards' }}
      onClick={onAdvance}
    >
      {/* Thumbnail */}
      <div className="relative" style={{ aspectRatio: '16/9' }}>
        <img
          src={nextVideo.thumbnail}
          alt={nextVideo.title}
          className="w-full h-full object-cover"
        />
        {/* "Up Next" badge */}
        <div className="absolute top-2 left-2 text-white/80 text-xs font-semibold px-2 py-0.5 rounded bg-black/60 backdrop-blur-sm">
          Up Next
        </div>
        {/* Dismiss button */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            setDismissed(true)
            setVisible(false)
          }}
          className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center text-white/50 hover:text-white text-xs transition-colors"
          aria-label="Dismiss next up"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M1 1l8 8M9 1l-8 8" />
          </svg>
        </button>
      </div>

      {/* Video info */}
      <div className="px-3 py-2">
        <p className="text-white text-sm font-medium leading-tight line-clamp-2">{nextVideo.title}</p>
        <p className="text-white/50 text-xs mt-1">
          {nextVideo.source}
          {nextVideo.duration && ` · ${nextVideo.duration}`}
        </p>
      </div>

      {/* Countdown progress bar */}
      <div className="h-0.5 bg-white/10">
        <div
          className="h-full bg-white/60 transition-[width] duration-200"
          style={{ width: `${countdown * 100}%` }}
        />
      </div>

      <style>{`
        @keyframes foryou-slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  )
}
