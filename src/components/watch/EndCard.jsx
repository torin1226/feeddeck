import { useEffect, useState } from 'react'

// ============================================================
// EndCard
// 5s countdown overlay shown when the current video ends.
// Plays the next item in the queue first (if any), then the
// top suggested. User can cancel to stop autoadvance.
// Self-contained — only manages countdown UI; the parent owns
// what `next` resolves to.
// ============================================================

const COUNTDOWN_MS = 5000
const TICK_MS = 100

export default function EndCard({ next, onAdvance, onCancel }) {
  const [remaining, setRemaining] = useState(COUNTDOWN_MS)

  useEffect(() => {
    if (!next) return undefined
    setRemaining(COUNTDOWN_MS)
    const start = Date.now()
    const timer = setInterval(() => {
      const elapsed = Date.now() - start
      const left = Math.max(0, COUNTDOWN_MS - elapsed)
      setRemaining(left)
      if (left <= 0) {
        clearInterval(timer)
        onAdvance?.()
      }
    }, TICK_MS)
    return () => clearInterval(timer)
  }, [next, onAdvance])

  if (!next) return null

  const seconds = Math.ceil(remaining / 1000)
  const pct = ((COUNTDOWN_MS - remaining) / COUNTDOWN_MS) * 100

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/85 backdrop-blur-sm" role="dialog" aria-label="Up next">
      <div className="max-w-sm w-[80%] rounded-2xl bg-bg-raised border border-white/10 shadow-modal p-6 flex flex-col items-center gap-4 text-center">
        <div className="text-xs uppercase tracking-[0.18em] text-text-muted font-semibold">Up next in {seconds}s</div>

        <div className="w-full">
          <div className="rounded-lg overflow-hidden bg-black aspect-video relative">
            {next.thumbnail ? (
              <img src={next.thumbnail} alt={next.title} className="w-full h-full object-cover" />
            ) : null}
            {next.duration && (
              <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-black/70 text-white/90">
                {next.duration}
              </span>
            )}
          </div>
          <div className="mt-3 text-sm font-semibold leading-tight line-clamp-2">{next.title}</div>
          {next.uploader && <div className="text-xs text-text-muted mt-1">{next.uploader}</div>}
        </div>

        <div className="flex items-center gap-2 w-full">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 px-4 py-2 rounded-full text-sm font-semibold bg-white/5 border border-white/10 text-text-secondary hover:bg-white/10 hover:text-text-primary transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onAdvance}
            className="flex-1 px-4 py-2 rounded-full text-sm font-semibold bg-accent text-white hover:bg-accent-hover transition-colors"
          >
            Play now
          </button>
        </div>

        {/* Progress bar */}
        <div className="w-full h-1 rounded-full bg-white/10 overflow-hidden">
          <div className="h-full bg-accent transition-[width] duration-100 linear" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  )
}
