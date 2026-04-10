import { useEffect, useRef } from 'react'
import useQueueStore from '../stores/queueStore'
import useLibraryStore from '../stores/libraryStore'

// ============================================================
// ContextMenu
// Minimal dark context menu for video cards.
// Shows queue, favorite, watch later, and rating options.
// Dismissed on click outside, Escape, or action.
// ============================================================

export default function ContextMenu({ video, position, onClose }) {
  const menuRef = useRef(null)
  const { addToQueue, insertNext } = useQueueStore()
  const { toggleFavorite, toggleWatchLater, setRating } = useLibraryStore()

  // Close on click outside or Escape
  useEffect(() => {
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose()
      }
    }
    const handleKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation() // Don't trigger SFW panic
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey, true)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey, true)
    }
  }, [onClose])

  // Clamp position so menu stays within viewport
  const style = {
    position: 'fixed',
    left: Math.min(position.x, window.innerWidth - 200),
    top: Math.min(position.y, window.innerHeight - 260),
    zIndex: 9999,
  }

  const handleAddToQueue = () => {
    addToQueue(video)
    onClose()
  }

  const handlePlayNext = () => {
    insertNext(video)
    onClose()
  }

  return (
    <div
      ref={menuRef}
      style={style}
      className="min-w-[160px] glass-heavy border border-highlight-medium
        rounded-lg shadow-2xl py-1 animate-fade-slide-in border-t-highlight-medium"
    >
      <button
        onClick={handleAddToQueue}
        className="w-full text-left px-4 py-2 text-sm text-white/90
          hover:bg-highlight transition-colors flex items-center gap-2.5"
      >
        <span className="text-white/50 text-xs">+</span>
        Add to queue
      </button>
      <button
        onClick={handlePlayNext}
        className="w-full text-left px-4 py-2 text-sm text-white/90
          hover:bg-highlight transition-colors flex items-center gap-2.5"
      >
        <span className="text-white/50 text-xs">▶</span>
        Play next
      </button>
      <div className="border-t border-highlight my-1" />
      <button
        onClick={() => { toggleFavorite(video.id); onClose() }}
        className="w-full text-left px-4 py-2 text-sm text-white/90
          hover:bg-highlight transition-colors flex items-center gap-2.5"
      >
        <span className="text-white/50 text-xs">{video.favorite ? '♥' : '♡'}</span>
        {video.favorite ? 'Remove favorite' : 'Favorite'}
      </button>
      <button
        onClick={() => { toggleWatchLater(video.id); onClose() }}
        className="w-full text-left px-4 py-2 text-sm text-white/90
          hover:bg-highlight transition-colors flex items-center gap-2.5"
      >
        <span className="text-white/50 text-xs">⏱</span>
        {video.watchLater ? 'Remove from Watch Later' : 'Watch Later'}
      </button>
      <div className="border-t border-highlight my-1" />
      <div className="px-4 py-2">
        <span className="text-white/50 text-[10px] uppercase tracking-wider font-semibold block mb-1.5">Rate</span>
        <div className="flex items-center gap-0.5">
          {[1, 2, 3, 4, 5].map(star => (
            <button
              key={star}
              onClick={() => { setRating(video.id, video.rating === star ? null : star); onClose() }}
              aria-label={`Rate ${star} star${star > 1 ? 's' : ''}`}
              className={`w-7 h-7 flex items-center justify-center text-base transition-colors cursor-pointer rounded ${
                video.rating >= star ? 'text-amber-400 hover:text-amber-300' : 'text-white/25 hover:text-amber-300'
              }`}
            >
              ★
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
