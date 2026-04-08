import { useEffect, useState } from 'react'

// ============================================================
// QueueSwipeAnimation
// Brief card-slides-left animation + queue icon when user
// swipes left to add a video to their queue.
// ============================================================

export default function QueueSwipeAnimation({ onDone }) {
  const [phase, setPhase] = useState('enter') // enter → hold → exit

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('hold'), 50)
    const t2 = setTimeout(() => setPhase('exit'), 600)
    const t3 = setTimeout(() => onDone?.(), 900)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [onDone])

  return (
    <div className="fixed inset-0 z-toast pointer-events-none flex items-center justify-center">
      {/* Sliding card overlay */}
      <div
        className="absolute inset-0 bg-gradient-to-l from-transparent via-transparent to-accent/20
          transition-transform duration-500 ease-out"
        style={{
          transform: phase === 'enter' ? 'translateX(0)'
            : phase === 'hold' ? 'translateX(-30%)'
            : 'translateX(-100%)',
        }}
      />

      {/* Queue icon */}
      <div
        className="transition-all duration-300 ease-out"
        style={{
          opacity: phase === 'hold' ? 1 : 0,
          transform: phase === 'hold' ? 'scale(1) translateX(-40px)' : 'scale(0.5) translateX(0)',
        }}
      >
        <div className="w-16 h-16 rounded-full bg-accent/90 flex items-center justify-center shadow-float shadow-accent/30">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#000"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </div>
      </div>
    </div>
  )
}
