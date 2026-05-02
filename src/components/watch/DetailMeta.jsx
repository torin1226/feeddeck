import { useCallback } from 'react'
import useRatingsStore from '../../stores/ratingsStore'
import useToastStore from '../../stores/toastStore'

// ============================================================
// DetailMeta
// Title + uploader + genre/views row + thumbs up/down +
// share + add-to-queue + (collapsible) description.
// Wires thumbs up/down directly to ratingsStore so a rating
// here is consistent with cards across the rest of the app.
// ============================================================

function ratingFor(item, ratedUrls) {
  if (!item?.url) return null
  return ratedUrls?.[item.url] || null
}

function postRating({ videoUrl, item, surfaceKey, rating }) {
  return fetch('/api/ratings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      videoUrl,
      surfaceType: 'watch_page',
      surfaceKey,
      rating,
      tags: Array.isArray(item?.tags) ? item.tags : [],
      creator: item?.uploader || '',
      title: item?.title || '',
      thumbnail: item?.thumbnail || '',
      source: item?.genre || '',
    }),
  }).catch(() => {})
}

export default function DetailMeta({ item, onAddToQueue, onEnterFullscreen }) {
  const recordRating = useRatingsStore((s) => s.recordRating)
  const undoRating = useRatingsStore((s) => s.undoRating)
  const ratedUrls = useRatingsStore((s) => s.ratedUrls)
  const showToast = useToastStore((s) => s.showToast)
  const showActionToast = useToastStore((s) => s.showActionToast)

  const currentRating = ratingFor(item, ratedUrls)

  const handleRate = useCallback((next) => {
    if (!item?.url) return
    const surfaceKey = `watch_page:${item.id}`
    const url = item.url

    // Toggle off if clicking the same rating again.
    if (currentRating === next) {
      undoRating?.(url, surfaceKey)
      fetch('/api/ratings/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: url }),
      }).catch(() => {})
      return
    }

    recordRating(url, surfaceKey, next)
    postRating({ videoUrl: url, item, surfaceKey, rating: next })

    if (next === 'down') {
      showActionToast?.("Got it. We'll show less like this.", {
        position: 'bottom',
        timeout: 8000,
      })
    } else if (showToast) {
      showToast(item.uploader ? `Saved. More from ${item.uploader} coming your way.` : 'Saved', 'success')
    }
  }, [item, currentRating, recordRating, undoRating, showToast, showActionToast])

  const handleShare = useCallback(() => {
    try {
      navigator.clipboard.writeText(window.location.href)
      showToast?.('Link copied', 'success')
    } catch {
      showToast?.('Could not copy link', 'error')
    }
  }, [showToast])

  if (!item) return null

  const upActive = currentRating === 'up'
  const downActive = currentRating === 'down'

  return (
    <div className="mt-6 mb-8">
      <h1 className="font-display text-2xl font-bold tracking-tight mb-2">
        {item.title}
      </h1>
      <div className="flex items-center gap-3 text-sm text-text-muted mb-4 flex-wrap">
        {item.uploader && <span className="font-medium text-text-secondary">{item.uploader}</span>}
        {item.uploader && <span>&middot;</span>}
        {item.genre && (
          <span className="px-2 py-0.5 rounded-full text-xs bg-white/5 border border-white/10">
            {item.genre}
          </span>
        )}
        {item.views && <span>{item.views} views</span>}
        {item.daysAgo && <span>&middot;</span>}
        {item.daysAgo && <span>{item.daysAgo}d ago</span>}
        {item.duration && <span>&middot;</span>}
        {item.duration && <span>{item.duration}</span>}
      </div>

      {/* Action row: thumbs up/down + share + queue */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="inline-flex rounded-full border border-white/10 bg-white/5 overflow-hidden" role="group" aria-label="Rate video">
          <button
            type="button"
            onClick={() => handleRate('up')}
            aria-pressed={upActive}
            aria-label={upActive ? 'Liked' : 'Like'}
            className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold transition-colors
              ${upActive
                ? 'text-emerald-400 bg-emerald-400/10'
                : 'text-text-secondary hover:bg-white/10 hover:text-text-primary'}`}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill={upActive ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
            </svg>
            <span>{upActive ? 'Liked' : 'Like'}</span>
          </button>
          <span className="w-px bg-white/10" aria-hidden="true" />
          <button
            type="button"
            onClick={() => handleRate('down')}
            aria-pressed={downActive}
            aria-label={downActive ? 'Not for me' : 'Dislike'}
            className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold transition-colors
              ${downActive
                ? 'text-rose-400 bg-rose-400/10'
                : 'text-text-secondary hover:bg-white/10 hover:text-text-primary'}`}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill={downActive ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17" />
            </svg>
          </button>
        </div>

        <button
          type="button"
          onClick={handleShare}
          className="inline-flex items-center gap-2 px-5 py-2 rounded-full text-sm font-semibold
            bg-white/5 text-text-secondary border border-white/10 hover:bg-white/10 hover:text-text-primary transition-colors"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
          </svg>
          Share
        </button>

        <button
          type="button"
          onClick={onAddToQueue}
          className="inline-flex items-center gap-2 px-5 py-2 rounded-full text-sm font-semibold
            bg-accent text-white hover:bg-accent-hover transition-colors"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
          Add to Queue
        </button>

        {onEnterFullscreen && (
          <button
            type="button"
            onClick={onEnterFullscreen}
            aria-label="Enter fullscreen"
            title="Fullscreen"
            className="ml-auto p-2.5 rounded-full text-text-secondary
              bg-white/5 border border-white/10 hover:bg-white/10 hover:text-text-primary transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
            </svg>
          </button>
        )}
      </div>

      {item.desc && (
        <p className="mt-4 text-sm text-text-muted leading-relaxed max-w-3xl">
          {item.desc}
        </p>
      )}
    </div>
  )
}
