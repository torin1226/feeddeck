import { useState } from 'react'
import useLibraryStore from '../stores/libraryStore'
import useFocusTrap from '../hooks/useFocusTrap'

// ============================================================
// AddVideoModal
// Paste a URL → sends to backend → extracts metadata → adds to library.
// For now (pre-backend), adds a placeholder entry.
// ============================================================

export default function AddVideoModal({ onClose }) {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const { addVideo } = useLibraryStore()
  const trapRef = useFocusTrap()

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!url.trim()) return

    setLoading(true)
    setError('')

    try {
      // Try to fetch metadata from backend
      const res = await fetch(`/api/metadata?url=${encodeURIComponent(url.trim())}`)

      if (res.ok) {
        const data = await res.json()
        addVideo({
          url: url.trim(),
          title: data.title,
          thumbnail: data.thumbnail,
          duration: data.duration,
          durationFormatted: formatDuration(data.duration),
          tags: data.tags || [],
          source: data.source || new URL(url).hostname,
          views: data.view_count ? formatViews(data.view_count) : '',
          channel: data.uploader || '',
        })
      } else {
        // Backend not available — add with URL only
        addVideo({
          url: url.trim(),
          title: url.trim().split('/').pop() || 'Added Video',
          source: new URL(url).hostname,
        })
      }
      onClose()
    } catch {
      // Backend not running — add as placeholder
      try {
        addVideo({
          url: url.trim(),
          title: url.trim().split('/').pop() || 'Added Video',
          source: new URL(url).hostname,
        })
        onClose()
      } catch {
        setError('Invalid URL format')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-toast flex items-center justify-center bg-black/60 backdrop-blur-sm"
         onClick={onClose}>
      <div ref={trapRef} className="bg-surface-raised border border-surface-border rounded-xl p-6 w-full max-w-md mx-4"
           onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-text-primary mb-4">Add Video</h2>

        <form onSubmit={handleSubmit}>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste video URL..."
            autoFocus
            className="w-full bg-surface-overlay border border-surface-border rounded-lg
              px-4 py-3 text-sm text-text-primary placeholder:text-text-muted
              focus:border-text-muted transition-colors mb-4"
          />

          {error && (
            <p className="text-red-400 text-sm mb-4">{error}</p>
          )}

          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm text-text-secondary
                hover:text-text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !url.trim()}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-accent text-white
                hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? 'Adding...' : 'Add'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// Helper: seconds → "3:45"
function formatDuration(seconds) {
  if (!seconds) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = String(seconds % 60).padStart(2, '0')
  return `${m}:${s}`
}

// Helper: 1234567 → "1.2M views"
function formatViews(count) {
  if (!count) return ''
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M views`
  if (count >= 1_000) return `${(count / 1_000).toFixed(0)}K views`
  return `${count} views`
}
