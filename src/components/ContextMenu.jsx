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
      className="min-w-[160px] bg-gray-900/95 backdrop-blur-md border border-white/15
        rounded-lg shadow-2xl py-1 animate-fade-slide-in"
    >
      <button
        onClick={handleAddToQueue}
        className="w-full text-left px-4 py-2 text-sm text-white/90
          hover:bg-white/10 transition-colors flex items-center gap-2.5"
      >
        <span className="text-white/50 text-xs">+</span>
        Add to queue
      </button>
      <button
        onClick={handlePlayNext}
        className="w-full text-left px-4 py-2 text-sm text-white/90
          hover:bg-white/10 transition-colors flex items-center gap-2.5"
      >
        <span className="text-white/50 text-xs">▶</span>
        Play next
      </button>
      <div className="border-t border-white/10 my-1" />
      <button
        onClick={() => { toggleFavorite(video.id); onClose() }}
        className="w-full text-left px-4 py-2 text-sm text-white/90
          hover:bg-white/10 transition-colors flex items-center gap-2.5"
      >
        <span className="text-white/50 text-xs">{video.favorite ? '♥' : '♡'}</span>
        {video.favorite ? 'Remove favorite' : 'Favorite'}
      </button>
      <button
        onClick={() => { toggleWatchLater(video.id); onClose() }}
        className="w-full text-left px-4 py-2 text-sm text-white/90
          hover:bg-white/10 transition-colors flex items-center gap-2.5"
      >
        <span className="text-white/50 text-xs">⏱</span>
        {video.watchLater ? 'Remove from Watch Later' : 'Watch Later'}
      </button>
      <div className="border-t border-white/10 my-1" />
      <div className="px-4 py-2 flex items-center gap-1">
        <span className="text-white/50 text-xs mr-1.5">Rate:</span>
        {[1, 2, 3, 4, 5].map(star => (
          <button
            key={star}
            onClick={() => { setRating(video.id, video.rating === star ? null : star); onClose() }}
            className={`text-sm transition-colors cursor-pointer ${
              video.rating >= star ? 'text-amber-400' : 'text-white/25 hover:text-white/50'
            }`}
          >
            ★
          </button>
        ))}
      </div>
    </div>
  )
}
