import { useState, useEffect, useRef } from 'react'

export default function TheatreTimeline({ videoRef, nextUpVisible }) {
  const [progress, setProgress] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [hovering, setHovering] = useState(false)
  const [dragging, setDragging] = useState(false)
  const barRef = useRef(null)

  // Update from video timeupdate
  useEffect(() => {
    const video = videoRef?.current
    if (!video) return

    const onTime = () => {
      const dur = video.duration || 0
      setCurrentTime(video.currentTime)
      setDuration(dur)
      setProgress(dur ? video.currentTime / dur : 0)
      if (video.buffered.length > 0) {
        setBuffered(video.buffered.end(video.buffered.length - 1) / (dur || 1))
      }
    }

    video.addEventListener('timeupdate', onTime)
    video.addEventListener('loadedmetadata', onTime)
    video.addEventListener('progress', onTime) // buffer updates
    return () => {
      video.removeEventListener('timeupdate', onTime)
      video.removeEventListener('loadedmetadata', onTime)
      video.removeEventListener('progress', onTime)
    }
  }, [videoRef])

  const seek = (e) => {
    const rect = barRef.current?.getBoundingClientRect()
    if (!rect) return
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const video = videoRef?.current
    if (video && video.duration) {
      video.currentTime = pct * video.duration
      setProgress(pct)
    }
  }

  const formatTime = (seconds) => {
    if (!seconds || !isFinite(seconds)) return '0:00'
    const m = Math.floor(Math.abs(seconds) / 60)
    const s = Math.floor(Math.abs(seconds) % 60)
    return `${seconds < 0 ? '-' : ''}${m}:${s.toString().padStart(2, '0')}`
  }

  const barHeight = hovering || dragging ? '8px' : '4px'

  return (
    <div
      className="absolute bottom-0 left-0 z-modal flex items-end gap-3 px-4 pb-4"
      style={{ right: nextUpVisible ? '296px' : '0', transition: 'right 0.3s ease' }}
    >
      {/* Current time */}
      <span className="text-white/60 text-xs font-mono mb-0.5 select-none min-w-[40px]">
        {formatTime(currentTime)}
      </span>

      {/* Progress bar */}
      <div
        ref={barRef}
        className="flex-1 relative cursor-pointer rounded-full overflow-hidden"
        style={{ height: barHeight, transition: 'height 0.15s ease' }}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => { setHovering(false); if (!dragging) setDragging(false) }}
        onClick={seek}
        onPointerDown={(e) => {
          setDragging(true)
          e.currentTarget.setPointerCapture(e.pointerId)
          seek(e)
        }}
        onPointerMove={(e) => { if (dragging) seek(e) }}
        onPointerUp={() => setDragging(false)}
      >
        {/* Background track */}
        <div className="absolute inset-0 bg-white/20" />
        {/* Buffered range */}
        <div
          className="absolute inset-y-0 left-0 bg-white/30"
          style={{ width: `${buffered * 100}%` }}
        />
        {/* Progress fill */}
        <div
          className="absolute inset-y-0 left-0 bg-white"
          style={{ width: `${progress * 100}%` }}
        />
        {/* Scrub handle (visible on hover) */}
        {(hovering || dragging) && (
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-md"
            style={{ left: `calc(${progress * 100}% - 6px)` }}
          />
        )}
      </div>

      {/* Remaining time */}
      <span className="text-white/60 text-xs font-mono mb-0.5 select-none min-w-[40px] text-right">
        {formatTime(-(duration - currentTime))}
      </span>
    </div>
  )
}
