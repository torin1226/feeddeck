import { useState, useEffect } from 'react'
import useFeedStore from '../../stores/feedStore'
import useTheatreControls from '../../hooks/useTheatreControls'

export default function TheatreOverlay({ videoRef }) {
  const { controlsVisible, scrubSpeed, startHold, endHold } = useTheatreControls(videoRef)
  const [paused, setPaused] = useState(false)

  // Track play/pause state
  useEffect(() => {
    const video = videoRef?.current
    if (!video) return
    const onPlay = () => setPaused(false)
    const onPause = () => setPaused(true)
    setPaused(video.paused)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    return () => {
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
    }
  }, [videoRef])

  const togglePlay = () => {
    const v = videoRef?.current
    if (!v) return
    v.paused ? v.play() : v.pause()
  }

  return (
    <div
      className={`absolute inset-0 z-30 transition-opacity duration-300 ${
        controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
      style={{ cursor: controlsVisible ? 'default' : 'none' }}
    >
      {/* Exit button — top right */}
      <button
        onClick={() => useFeedStore.getState().setTheatreMode(false)}
        className="absolute top-6 right-6 w-10 h-10 rounded-full bg-glass backdrop-blur-lg flex items-center justify-center text-white/70 hover:text-white hover:bg-highlight-strong border border-highlight transition-colors"
        aria-label="Exit theatre mode"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M1 1l12 12M13 1L1 13" />
        </svg>
      </button>

      {/* Centre control cluster */}
      <div className="absolute inset-0 flex items-center justify-center gap-8 pointer-events-auto">
        {/* Rewind */}
        <button
          onPointerDown={() => startHold('backward')}
          onPointerUp={() => endHold('backward')}
          onPointerLeave={() => endHold('backward')}
          className="relative w-12 h-12 rounded-full bg-glass backdrop-blur-lg flex items-center justify-center text-white border border-highlight hover:bg-highlight-strong transition-colors active:scale-95"
          aria-label="Rewind 10 seconds"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 17l-5-5 5-5" />
            <path d="M18 17l-5-5 5-5" />
          </svg>
          {scrubSpeed && (
            <span className="absolute -bottom-6 text-xs text-white/70 font-mono">{scrubSpeed}</span>
          )}
        </button>

        {/* Play/Pause */}
        <button
          onClick={togglePlay}
          className="w-16 h-16 rounded-full bg-glass backdrop-blur-lg flex items-center justify-center text-white border border-highlight hover:bg-highlight-strong transition-colors active:scale-95"
          aria-label={paused ? 'Play' : 'Pause'}
        >
          {paused ? (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
              <path d="M8 5.14v14l11-7-11-7z" />
            </svg>
          ) : (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          )}
        </button>

        {/* Fast Forward */}
        <button
          onPointerDown={() => startHold('forward')}
          onPointerUp={() => endHold('forward')}
          onPointerLeave={() => endHold('forward')}
          className="relative w-12 h-12 rounded-full bg-glass backdrop-blur-lg flex items-center justify-center text-white border border-highlight hover:bg-highlight-strong transition-colors active:scale-95"
          aria-label="Fast forward 10 seconds"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 17l5-5-5-5" />
            <path d="M6 17l5-5-5-5" />
          </svg>
          {scrubSpeed && (
            <span className="absolute -bottom-6 text-xs text-white/70 font-mono">{scrubSpeed}</span>
          )}
        </button>
      </div>
    </div>
  )
}
