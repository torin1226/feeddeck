import { useState } from 'react'

// ============================================================
// SourceControlSheet
// Long-press bottom sheet for source actions:
// "More from this source" or "Hide this source"
// ============================================================

export default function SourceControlSheet({ video, onClose }) {
  const [submitting, setSubmitting] = useState(false)

  if (!video) return null

  async function handleAction(action) {
    setSubmitting(true)
    try {
      await fetch('/api/feed/source-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: video.source, action }),
      })
    } catch {}
    setSubmitting(false)
    onClose(action)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={() => onClose()}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" />

      {/* Sheet */}
      <div
        className="relative w-full max-w-md bg-surface-raised/90 backdrop-blur-2xl rounded-t-2xl p-5 pb-8 animate-fade-slide-in shadow-[0_-4px_24px_rgba(0,0,0,0.3)]"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-highlight-strong rounded-full mx-auto mb-4" />

        <div className="text-sm text-text-muted mb-3 truncate">
          Source: <span className="text-text-primary">{video.source || 'Unknown'}</span>
        </div>

        <button
          onClick={() => handleAction('boost')}
          disabled={submitting}
          className="w-full py-3 px-4 rounded-xl bg-highlight text-white text-sm font-medium
            hover:bg-highlight-medium transition-colors mb-2 text-left"
        >
          + More from this source
        </button>

        <button
          onClick={() => handleAction('hide')}
          disabled={submitting}
          className="w-full py-3 px-4 rounded-xl bg-highlight text-red-400 text-sm font-medium
            hover:bg-red-500/15 transition-colors text-left"
        >
          - Hide this source
        </button>
      </div>
    </div>
  )
}
