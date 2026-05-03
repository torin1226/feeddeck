import { useState, useCallback } from 'react'
import useRatingsStore from '../stores/ratingsStore'
import useToastStore from '../stores/toastStore'

// ============================================================
// ThumbsRating
// Glass pill overlay with thumbs up/down buttons.
// Appears at the bottom of focused cards (PosterCard, FeedVideo).
// 44px tall touch targets, 120px wide centered bar.
// ============================================================

const EASE_SPRING = 'cubic-bezier(0.34, 1.56, 0.64, 1)'

export default function ThumbsRating({
  videoUrl,
  surfaceType = 'home_row',
  surfaceKey = null,
  tags = [],
  creator = '',
  title = '',
  thumbnail = '',
  source = '',
  visible = true,
  onRated,
  positionClass = 'absolute bottom-3 left-1/2 -translate-x-1/2',
}) {
  const [animating, setAnimating] = useState(null) // 'up' | 'down' | null
  const recordRating = useRatingsStore(s => s.recordRating)
  const existingRating = useRatingsStore(s => s.ratedUrls[videoUrl])
  const isToastPaused = useRatingsStore(s => s.isToastPaused)
  const undoRating = useRatingsStore(s => s.undoRating)
  const showToast = useToastStore(s => s.showToast)
  const showActionToast = useToastStore(s => s.showActionToast)

  const handleUndo = useCallback(() => {
    undoRating(videoUrl, surfaceKey || surfaceType)
    fetch('/api/ratings/undo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoUrl }),
    }).catch(err => console.warn('Undo rating failed:', err.message))
  }, [videoUrl, surfaceKey, surfaceType, undoRating])

  const handleRate = useCallback(async (rating) => {
    if (animating || existingRating) return

    setAnimating(rating)

    // Optimistic UI update
    recordRating(videoUrl, surfaceKey || surfaceType, rating)

    // Fire API call
    try {
      await fetch('/api/ratings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrl,
          surfaceType,
          surfaceKey,
          rating,
          tags: Array.isArray(tags) ? tags : [],
          creator,
          title,
          thumbnail,
          source,
        }),
      })
    } catch (err) {
      console.warn('Rating failed:', err.message)
    }

    // Toast feedback — down always shows undo toast (bypasses pause), up is ambient
    if (rating === 'down') {
      showActionToast("Got it. We'll show less like this.", {
        position: 'bottom',
        timeout: 10000,
        actions: [{ label: 'Undo', primary: true, onClick: handleUndo }],
      })
    } else if (!isToastPaused()) {
      if (rating === 'up' && creator) {
        showToast(`Saved. More from ${creator} coming your way.`, 'success')
      }
    }

    // Notify parent for animations
    onRated?.(rating, videoUrl)

    // Clear animation state after animation completes
    setTimeout(() => setAnimating(null), 350)
  }, [videoUrl, surfaceType, surfaceKey, tags, creator, title, thumbnail, source, animating, existingRating, recordRating, isToastPaused, showToast, showActionToast, handleUndo, onRated])

  if (!visible || !videoUrl) return null

  // Already rated — show subtle indicator
  if (existingRating) {
    return (
      <div
        className={`${positionClass} z-20 flex items-center gap-2 px-3 py-1.5 rounded-full`}
        style={{
          background: 'rgba(0,0,0,0.4)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}
      >
        <span className="text-xs text-white/60 font-medium flex items-center gap-1">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {existingRating === 'up'
              ? <path d="M14 9V5a3 3 0 00-3-3l-4 9v11h11.28a2 2 0 002-1.7l1.38-9a2 2 0 00-2-2.3zM7 22H4a2 2 0 01-2-2v-7a2 2 0 012-2h3" />
              : <path d="M10 15v4a3 3 0 003 3l4-9V2H5.72a2 2 0 00-2 1.7l-1.38 9a2 2 0 002 2.3zm7-13h2.67A2.31 2.31 0 0122 4v7a2.31 2.31 0 01-2.33 2H17" />}
          </svg>
          {existingRating === 'up' ? 'Liked' : 'Not for me'}
        </span>
      </div>
    )
  }

  return (
    <div
      className={`${positionClass} z-20 flex items-center gap-4`}
      style={{
        opacity: visible ? 1 : 0,
        transform: `translateX(-50%) scale(${visible ? 1 : 0.9})`,
        transition: `opacity 200ms ease-out, transform 250ms ${EASE_SPRING}`,
        pointerEvents: visible ? 'auto' : 'none',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="flex items-center gap-3 px-4 py-2 rounded-full border border-white/10"
        style={{
          background: 'rgba(0,0,0,0.5)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
        }}
      >
        {/* Thumbs Down */}
        <button
          onClick={(e) => { e.stopPropagation(); handleRate('down') }}
          aria-label="Not for me"
          className="flex items-center justify-center w-[44px] h-[44px] rounded-full hover:bg-white/10 active:scale-90 transition-all duration-150"
          style={{
            transform: animating === 'down' ? 'scale(0.7)' : 'scale(1)',
            opacity: animating === 'down' ? 0.5 : 1,
            transition: `transform 300ms ${EASE_SPRING}, opacity 300ms ease-out`,
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/80">
            <path d="M10 15v4a3 3 0 003 3l4-9V2H5.72a2 2 0 00-2 1.7l-1.38 9a2 2 0 002 2.3zm7-13h2.67A2.31 2.31 0 0122 4v7a2.31 2.31 0 01-2.33 2H17" />
          </svg>
        </button>

        {/* Divider */}
        <div className="w-px h-5 bg-white/15" />

        {/* Thumbs Up */}
        <button
          onClick={(e) => { e.stopPropagation(); handleRate('up') }}
          aria-label="Like this"
          className="flex items-center justify-center w-[44px] h-[44px] rounded-full hover:bg-white/10 active:scale-90 transition-all duration-150"
          style={{
            transform: animating === 'up' ? 'scale(1.15)' : 'scale(1)',
            transition: `transform 350ms ${EASE_SPRING}`,
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill={animating === 'up' ? '#3b82f6' : 'none'} stroke={animating === 'up' ? '#3b82f6' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/80" style={{ transition: 'fill 300ms, stroke 300ms' }}>
            <path d="M14 9V5a3 3 0 00-3-3l-4 9v11h11.28a2 2 0 002-1.7l1.38-9a2 2 0 00-2-2.3zM7 22H4a2 2 0 01-2-2v-7a2 2 0 012-2h3" />
          </svg>
        </button>
      </div>
    </div>
  )
}
