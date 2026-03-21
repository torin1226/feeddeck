import { useEffect, useState } from 'react'

// ============================================================
// HeartBurst
// Double-tap heart animation. Shows a burst of heart particles
// at the tap location, TikTok-style.
// ============================================================

export default function HeartBurst({ x, y, onDone }) {
  const [particles] = useState(() =>
    Array.from({ length: 8 }, (_, i) => ({
      id: i,
      angle: (i / 8) * 360 + (Math.random() - 0.5) * 30,
      distance: 40 + Math.random() * 40,
      size: 16 + Math.random() * 12,
      delay: Math.random() * 100,
    }))
  )

  useEffect(() => {
    const timer = setTimeout(() => onDone?.(), 800)
    return () => clearTimeout(timer)
  }, [onDone])

  return (
    <div
      className="fixed z-50 pointer-events-none"
      style={{ left: x, top: y, transform: 'translate(-50%, -50%)' }}
    >
      {/* Center heart */}
      <div className="absolute -translate-x-1/2 -translate-y-1/2 text-3xl animate-heart-pop">
        ❤️
      </div>

      {/* Particle hearts */}
      {particles.map(p => (
        <div
          key={p.id}
          className="absolute -translate-x-1/2 -translate-y-1/2 animate-heart-particle"
          style={{
            fontSize: `${p.size}px`,
            '--angle': `${p.angle}deg`,
            '--distance': `${p.distance}px`,
            animationDelay: `${p.delay}ms`,
          }}
        >
          ❤️
        </div>
      ))}
    </div>
  )
}
