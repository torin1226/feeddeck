import { useEffect, useState } from 'react'
import useToastStore from '../stores/toastStore'

export default function GlobalToast() {
  const toast = useToastStore(s => s.toast)
  const clearToast = useToastStore(s => s.clearToast)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!toast) { setVisible(false); return }
    setVisible(false)
    const raf = requestAnimationFrame(() => setVisible(true))
    const timer = setTimeout(() => {
      setVisible(false)
      setTimeout(clearToast, 300)
    }, 2000)
    return () => { clearTimeout(timer); cancelAnimationFrame(raf) }
  }, [toast, clearToast])

  if (!toast) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed top-6 left-1/2 z-toast px-4 py-2 rounded-full
        backdrop-blur-lg border text-sm font-medium
        transition-all duration-300 pointer-events-none ${
          toast.type === 'error'
            ? 'bg-red-500/20 border-red-500/30 text-red-200'
            : toast.type === 'success'
            ? 'bg-green-500/20 border-green-500/30 text-green-200'
            : 'bg-white/15 border-white/20 text-white'
        }`}
      style={{
        opacity: visible ? 1 : 0,
        transform: `translateX(-50%) translateY(${visible ? 0 : -10}px)`,
      }}
    >
      {toast.message}
    </div>
  )
}
