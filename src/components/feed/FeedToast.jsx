import { useEffect, useRef, useState } from 'react'

// ============================================================
// FeedToast
// Transient notification that auto-dismisses after 2 seconds.
// ============================================================

export default function FeedToast({ message, onDone }) {
  const [visible, setVisible] = useState(false)
  // Tracks the 300ms dismiss-animation timer so the component unmount
  // path can cancel it. Otherwise a stale onDone fires after unmount.
  const dismissTimerRef = useRef(null)

  useEffect(() => {
    // Animate in
    const raf = requestAnimationFrame(() => setVisible(true))
    const timer = setTimeout(() => {
      setVisible(false)
      dismissTimerRef.current = setTimeout(() => onDone?.(), 300)
    }, 2000)
    return () => {
      clearTimeout(timer)
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current)
        dismissTimerRef.current = null
      }
      cancelAnimationFrame(raf)
    }
  }, [onDone])

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-6 left-1/2 -translate-x-1/2 z-toast px-4 py-2 rounded-full
        bg-white/15 backdrop-blur-lg border border-white/20 text-white text-sm font-medium
        transition-all duration-300"
      style={{
        opacity: visible ? 1 : 0,
        transform: `translateX(-50%) translateY(${visible ? 0 : -10}px)`,
      }}
    >
      {message}
    </div>
  )
}
