import { useEffect, useState, useRef } from 'react'
import useToastStore from '../stores/toastStore'

// ============================================================
// GlobalToast (upgraded for 3.12 Taste Feedback)
//
// Tier 1 — Passive: pill, top-center, 3s auto-dismiss, pointer-events-none
// Tier 2 — Action: wider pill, rose left-border, CTA buttons, 8s timeout,
//          pointer-events-auto, progress shrink indicator
// ============================================================

export default function GlobalToast() {
  const toast = useToastStore(s => s.toast)
  const clearToast = useToastStore(s => s.clearToast)
  const [visible, setVisible] = useState(false)
  const progressRef = useRef(null)

  useEffect(() => {
    if (!toast) { setVisible(false); return }
    setVisible(false)
    const raf = requestAnimationFrame(() => setVisible(true))

    const timeout = toast.tier === 'action' ? (toast.timeout || 8000) : 3000

    // Start progress bar animation for action toasts
    if (toast.tier === 'action' && progressRef.current) {
      progressRef.current.style.transition = 'none'
      progressRef.current.style.width = '100%'
      requestAnimationFrame(() => {
        if (progressRef.current) {
          progressRef.current.style.transition = `width ${timeout}ms linear`
          progressRef.current.style.width = '0%'
        }
      })
    }

    const timer = setTimeout(() => {
      setVisible(false)
      setTimeout(clearToast, 300)
    }, timeout)

    return () => { clearTimeout(timer); cancelAnimationFrame(raf) }
  }, [toast, clearToast])

  if (!toast) return null

  const isAction = toast.tier === 'action'

  const colorClasses = toast.type === 'error'
    ? 'bg-red-500/20 border-red-500/30 text-red-200'
    : toast.type === 'success'
    ? 'bg-green-500/20 border-green-500/30 text-green-200'
    : 'bg-white/15 border-white/20 text-white'

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed top-6 left-1/2 z-toast rounded-full
        backdrop-blur-lg border text-sm font-medium
        transition-all duration-300
        ${isAction ? 'pointer-events-auto border-l-2 border-l-accent px-5 py-2.5' : 'pointer-events-none px-4 py-2'}
        ${colorClasses}`}
      style={{
        opacity: visible ? 1 : 0,
        transform: `translateX(-50%) translateY(${visible ? 0 : -10}px)`,
        maxWidth: isAction ? '420px' : '320px',
      }}
    >
      <div className="flex items-center gap-3">
        <span className="flex-1">{toast.message}</span>

        {/* Action buttons (Tier 2 only) */}
        {isAction && toast.actions?.length > 0 && (
          <div className="flex items-center gap-2 ml-2 flex-shrink-0">
            {toast.actions.map((action, i) => (
              <button
                key={i}
                onClick={(e) => {
                  e.stopPropagation()
                  action.onClick?.()
                  setVisible(false)
                  setTimeout(clearToast, 300)
                }}
                className={`text-xs font-semibold whitespace-nowrap px-2.5 py-1 rounded-full transition-colors ${
                  action.primary
                    ? 'bg-accent/20 text-accent hover:bg-accent/30'
                    : 'text-white/50 hover:text-white/70'
                }`}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Progress bar for action toasts */}
      {isAction && (
        <div className="absolute bottom-0 left-0 right-0 h-[2px] overflow-hidden rounded-b-full">
          <div
            ref={progressRef}
            className="h-full bg-accent/40"
            style={{ width: '100%' }}
          />
        </div>
      )}
    </div>
  )
}
