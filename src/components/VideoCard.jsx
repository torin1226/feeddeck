import { useCallback, useRef, useState } from 'react'
import clsx from 'clsx'
import useQueueStore from '../stores/queueStore'
import useLibraryStore from '../stores/libraryStore'
import useToastStore from '../stores/toastStore'
import useHoverPreview from '../hooks/useHoverPreview'
import ContextMenu from './ContextMenu'

// ============================================================
// VideoCard
// Single thumbnail card in the grid.
// In Social mode: shows neutral image + fake title.
// In NSFW mode: shows real thumbnail + title.
// Right-click opens context menu with queue actions.
// ============================================================

export default function VideoCard({ video, onClick }) {
  const { addToQueue } = useQueueStore()
  const { toggleFavorite } = useLibraryStore()
  const showToast = useToastStore(s => s.showToast)
  const [ctxMenu, setCtxMenu] = useState(null)
  const { startPreview, cancelPreview } = useHoverPreview()
  const longPressTimer = useRef(null)
  const longPressTriggered = useRef(false)

  const display = {
    title: video.title,
    thumbnail: video.thumbnail,
    duration: video.durationFormatted || '0:00',
    views: video.views || '',
    channel: video.channel || video.source || '',
    uploadDate: video.addedAt ? timeAgo(video.addedAt) : '',
  }

  const handleContextMenu = (e) => {
    e.preventDefault()
    setCtxMenu({ x: e.clientX, y: e.clientY })
  }

  const handleTouchStart = useCallback((e) => {
    longPressTriggered.current = false
    const touch = e.touches[0]
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true
      setCtxMenu({ x: touch.clientX, y: touch.clientY })
    }, 600)
  }, [])

  const handleTouchEnd = useCallback(() => {
    clearTimeout(longPressTimer.current)
  }, [])

  const handleTouchMove = useCallback(() => {
    clearTimeout(longPressTimer.current)
  }, [])

  return (
    <div
      className="group cursor-pointer"
      onClick={(_e) => {
        if (longPressTriggered.current) { longPressTriggered.current = false; return }
        onClick?.(video)
      }}
      onContextMenu={handleContextMenu}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchMove}
    >
      {/* Thumbnail container */}
      <div
        className="relative aspect-video rounded-lg overflow-hidden bg-surface-overlay mb-2"
        onMouseEnter={(e) => {
          const vid = e.currentTarget.querySelector('video')
          if (video.url && vid) startPreview(video.url, vid)
        }}
        onMouseLeave={cancelPreview}
      >
        {display.thumbnail ? (
          <img
            src={display.thumbnail}
            alt={video.title}
            loading="lazy"
            className="w-full h-full object-cover transition-transform duration-200 ease-out group-hover:scale-[var(--hover-scale)]"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-text-muted">
            <span className="text-3xl">▶</span>
          </div>
        )}

        {/* Hover preview video */}
        <video
          className="absolute inset-0 w-full h-full object-cover z-content pointer-events-none transition-opacity duration-300"
          style={{ opacity: 0 }}
          muted
          playsInline
          loop
        />

        {/* Demo badge */}
        {video.source === 'demo' && (
          <div className="absolute top-2 left-2 bg-amber-500/80 text-white text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wider z-content">
            Demo
          </div>
        )}

        {/* Duration badge */}
        <div className="absolute bottom-2 right-2 bg-black/80 text-white text-xs px-1.5 py-0.5 rounded font-medium z-content">
          {display.duration}
        </div>

        {/* Watch progress bar (Netflix-style thin bar at bottom of thumbnail) */}
        {video.watchProgress > 0.05 && (
          <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-white/10 z-content">
            <div
              className="h-full bg-accent rounded-r-sm"
              style={{ width: `${Math.round(video.watchProgress * 100)}%` }}
            />
          </div>
        )}

        {/* Hover overlay with actions */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100 z-content">
          <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
            {/* Add to queue */}
            <button
              onClick={() => { addToQueue(video); showToast('Added to queue') }}
              title="Add to queue"
              aria-label="Add to queue"
              className="w-9 h-9 rounded-full bg-black/70 text-white flex items-center justify-center
                hover:bg-accent transition-colors text-sm"
            >
              +
            </button>
            {/* Play — largest button, triggers the card's onClick */}
            <button
              onClick={() => onClick?.(video)}
              title="Play"
              aria-label="Play video"
              className="w-12 h-12 rounded-full bg-white/90 text-black flex items-center justify-center
                hover:bg-white transition-colors text-lg shadow-float"
            >
              ▶
            </button>
            {/* Favorite */}
            <button
              onClick={() => toggleFavorite(video.id)}
              title={video.favorite ? 'Remove from favorites' : 'Add to favorites'}
              aria-label={video.favorite ? 'Remove from favorites' : 'Add to favorites'}
              className={clsx(
                'w-9 h-9 rounded-full bg-black/70 flex items-center justify-center hover:bg-accent transition-colors text-sm',
                video.favorite ? 'text-accent' : 'text-white'
              )}
            >
              {video.favorite ? '♥' : '♡'}
            </button>
          </div>
        </div>
      </div>

      {/* Info below thumbnail */}
      <div className="px-0.5">
        <h3 className="text-sm font-medium text-text-primary line-clamp-2 leading-snug mb-1">
          {display.title}
        </h3>
        <div className="flex items-center gap-1.5 text-xs text-text-muted">
          {display.channel && <span>{display.channel}</span>}
          {display.channel && display.views && <span>·</span>}
          {display.views && <span>{display.views}</span>}
        </div>
      </div>

      {/* Right-click context menu */}
      {ctxMenu && (
        <ContextMenu
          video={video}
          position={ctxMenu}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  )
}

// Helper: ISO date → "2 days ago"
function timeAgo(isoString) {
  const diff = Date.now() - new Date(isoString).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  return `${weeks}w ago`
}
