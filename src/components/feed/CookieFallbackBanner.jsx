import { useState, useEffect } from 'react'

// ============================================================
// CookieFallbackBanner
// Shows a dismissible warning when YouTube cookies are expired
// and the subscription feed is running in fallback mode
// (searching cached channels instead of real subscriptions).
// ============================================================

export default function CookieFallbackBanner() {
  const [status, setStatus] = useState(null) // { active, cachedChannels }
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function check() {
      try {
        const res = await fetch('/api/cookies/health')
        if (!res.ok || cancelled) return
        const data = await res.json()
        if (data.youtube?.subscriptionFallback?.active) {
          setStatus(data.youtube.subscriptionFallback)
        }
      } catch { /* silent */ }
    }
    check()
    // Re-check every 5 minutes in case cookies get re-imported
    const interval = setInterval(check, 5 * 60 * 1000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  if (!status?.active || dismissed) return null

  return (
    <div className="fixed top-0 left-0 right-0 z-toast flex items-center justify-between gap-3 px-4 py-2 bg-amber-500/90 text-black text-xs font-medium backdrop-blur-sm">
      <span>
        YouTube cookies expired — showing approximate results from {status.cachedChannels} cached channel{status.cachedChannels !== 1 ? 's' : ''}.
        Re-import cookies in Settings for your full subscription feed.
      </span>
      <button
        onClick={() => setDismissed(true)}
        className="shrink-0 px-2 py-0.5 rounded bg-black/20 hover:bg-black/30 text-white text-xs transition-colors"
      >
        Dismiss
      </button>
    </div>
  )
}
