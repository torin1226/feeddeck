import { useCallback, useEffect, useRef, useState } from 'react'

// ============================================================
// useFullscreenChrome
// Idle-timer driven chrome reveal for the fullscreen view.
// Any qualifying input (mousemove, click, keydown, touchstart)
// reveals the chrome and resets a 3s hide timer. Disabled when
// `enabled === false` (i.e. user is not in fullscreen).
// ============================================================

const IDLE_MS = 3000

export default function useFullscreenChrome({ enabled, rootRef, force = false }) {
  const [visible, setVisible] = useState(true)
  const timerRef = useRef(null)

  const reveal = useCallback(() => {
    setVisible(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    if (force) return
    timerRef.current = setTimeout(() => setVisible(false), IDLE_MS)
  }, [force])

  // Force-reveal stays visible regardless of timer
  useEffect(() => {
    if (force) {
      setVisible(true)
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    } else if (enabled) {
      reveal()
    }
  }, [force, enabled, reveal])

  // Listen for input events on the root container
  useEffect(() => {
    if (!enabled) return undefined
    const root = rootRef?.current || document
    const handler = () => reveal()
    root.addEventListener('mousemove', handler)
    root.addEventListener('click', handler)
    root.addEventListener('touchstart', handler, { passive: true })
    document.addEventListener('keydown', handler)
    return () => {
      root.removeEventListener('mousemove', handler)
      root.removeEventListener('click', handler)
      root.removeEventListener('touchstart', handler)
      document.removeEventListener('keydown', handler)
    }
  }, [enabled, rootRef, reveal])

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  // Reset visibility when entering / exiting fullscreen
  useEffect(() => {
    if (!enabled) {
      setVisible(true)
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    } else {
      reveal()
    }
  }, [enabled, reveal])

  return { visible, reveal }
}
