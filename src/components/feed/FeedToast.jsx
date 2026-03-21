import { useEffect, useState } from 'react'

// ============================================================
// FeedToast
// Transient notification that auto-dismisses after 2 seconds.
// ============================================================

export default function FeedToast({ message, onDone }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // Animate in
    requestAnimationFrame(() => setVisible(true))
    const timer = setTimeout(() => {
      setVisible(false)
      setTimeout(() => onDone?.(), 300)
    }, 2000)
    return () => clearTimeout(timer)
  }, [onDone])

  return (
    <div
      className="fixed top-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full
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
