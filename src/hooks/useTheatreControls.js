import { useState, useEffect, useRef, useCallback } from 'react'
import useFeedStore from '../stores/feedStore'

export default function useTheatreControls(videoRef) {
  const [controlsVisible, setControlsVisible] = useState(true)
  const [scrubbing, setScrubbing] = useState(false) // true when hold threshold passed
  const [scrubSpeed, setScrubSpeed] = useState(null) // null | '2×' | '4×'
  const hideTimer = useRef(null)
  const holdTimer = useRef(null)
  const rampTimer = useRef(null)
  const rafRef = useRef(null)
  const holdDirection = useRef(null) // 'forward' | 'backward'

  const showControls = useCallback(() => {
    setControlsVisible(true)
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setControlsVisible(false), 3000)
  }, [])

  // Mouse move → show controls
  useEffect(() => {
    const onMove = () => showControls()
    window.addEventListener('mousemove', onMove)
    // Start with controls visible, auto-hide after 3s
    hideTimer.current = setTimeout(() => setControlsVisible(false), 3000)
    return () => {
      window.removeEventListener('mousemove', onMove)
      clearTimeout(hideTimer.current)
    }
  }, [showControls])

  // Subscribe to theatreMode so keyboard effect reacts to mode changes
  const theatreMode = useFeedStore(s => s.theatreMode)

  // Keyboard shortcuts for theatre mode
  useEffect(() => {
    if (!theatreMode) return

    const onKey = (e) => {
      const video = videoRef?.current
      if (!video) return
      showControls()

      switch (e.key) {
        case ' ':
          e.preventDefault()
          video.paused ? video.play() : video.pause()
          break
        case 'ArrowLeft':
          e.preventDefault()
          if (e.shiftKey) {
            // Navigate to previous video
            const { currentIndex } = useFeedStore.getState()
            if (currentIndex > 0) useFeedStore.getState().setCurrentIndex(currentIndex - 1)
          } else {
            video.currentTime = Math.max(0, video.currentTime - 10)
          }
          break
        case 'ArrowRight':
          e.preventDefault()
          if (e.shiftKey) {
            const { currentIndex, buffer } = useFeedStore.getState()
            if (currentIndex < buffer.length - 1) useFeedStore.getState().setCurrentIndex(currentIndex + 1)
          } else {
            video.currentTime = Math.min(video.duration || 0, video.currentTime + 10)
          }
          break
        case 'Escape':
        case 't':
        case 'T':
          e.preventDefault()
          useFeedStore.getState().setTheatreMode(false)
          break
        case 'n':
        case 'N': {
          e.preventDefault()
          const { currentIndex, buffer } = useFeedStore.getState()
          if (currentIndex < buffer.length - 1) useFeedStore.getState().setCurrentIndex(currentIndex + 1)
          break
        }
        case 'p':
        case 'P': {
          e.preventDefault()
          const { currentIndex } = useFeedStore.getState()
          if (currentIndex > 0) useFeedStore.getState().setCurrentIndex(currentIndex - 1)
          break
        }
        case 'm':
        case 'M':
          e.preventDefault()
          useFeedStore.getState().setMuted(!useFeedStore.getState().muted)
          break
        case 'f':
        case 'F':
          e.preventDefault()
          document.fullscreenElement
            ? document.exitFullscreen().catch(() => {})
            : document.documentElement.requestFullscreen().catch(() => {})
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [videoRef, showControls, theatreMode])

  // Hold-to-scrub: start
  const startHold = useCallback((direction) => {
    holdDirection.current = direction
    setScrubbing(false)
    setScrubSpeed(null)

    holdTimer.current = setTimeout(() => {
      setScrubbing(true)
      const video = videoRef?.current
      if (!video) return

      if (direction === 'forward') {
        video.playbackRate = 2
        setScrubSpeed('2×')
      } else {
        // Backward: rAF loop decrementing currentTime
        setScrubSpeed('2×')
        const step = () => {
          if (video) video.currentTime = Math.max(0, video.currentTime - 2 / 60)
          rafRef.current = requestAnimationFrame(step)
        }
        rafRef.current = requestAnimationFrame(step)
      }

      // Ramp to 4× after 2s of holding
      rampTimer.current = setTimeout(() => {
        setScrubSpeed('4×')
        if (direction === 'forward' && video) {
          video.playbackRate = 4
        }
        // For backward, the rAF loop continues (could increase step size but 2/60 is fine)
      }, 2000)
    }, 500)
  }, [videoRef])

  // Hold-to-scrub: end
  const endHold = useCallback((direction) => {
    const wasScrubbing = scrubbing
    clearTimeout(holdTimer.current)
    clearTimeout(rampTimer.current)
    if (rafRef.current) cancelAnimationFrame(rafRef.current)

    const video = videoRef?.current
    if (video) video.playbackRate = 1

    if (!wasScrubbing) {
      // Was a click (hold < 500ms) — do ±10s seek
      if (video) {
        if (direction === 'forward') {
          video.currentTime = Math.min(video.duration || 0, video.currentTime + 10)
        } else {
          video.currentTime = Math.max(0, video.currentTime - 10)
        }
      }
    }

    setScrubbing(false)
    setScrubSpeed(null)
    holdDirection.current = null
  }, [videoRef, scrubbing])

  // Cleanup hold timers on unmount to prevent stale callbacks
  useEffect(() => {
    return () => {
      clearTimeout(holdTimer.current)
      clearTimeout(rampTimer.current)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return { controlsVisible, scrubSpeed, scrubbing, showControls, startHold, endHold }
}
