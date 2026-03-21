import useModeStore from '../stores/modeStore'
import useQueueStore from '../stores/queueStore'
import useLibraryStore from '../stores/libraryStore'
import { getSFWData } from '../data/socialData'

// ============================================================
// QueueSidebar
// Desktop-only sidebar showing the playback queue.
// In Social mode: shows neutral titles/thumbnails.
// Supports remove and clear. Drag reorder is Phase 2.
// ============================================================

export default function QueueSidebar() {
  const { isSFW } = useModeStore()
  const { queue, removeFromQueue, clearQueue } = useQueueStore()
  const { videos } = useLibraryStore()

  // Resolve video objects from queue IDs
  const queueVideos = queue
    .map((id) => videos.find((v) => v.id === id))
    .filter(Boolean)

  return (
    <aside className="w-72 border-l border-surface-border bg-surface-raised flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-border">
        <h3 className="text-sm font-semibold text-text-primary">
          Queue
          {queueVideos.length > 0 && (
            <span className="text-text-muted font-normal ml-1.5">
              ({queueVideos.length})
            </span>
          )}
        </h3>
        {queueVideos.length > 0 && (
          <button
            onClick={clearQueue}
            className="text-xs text-text-muted hover:text-text-primary transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Queue items */}
      <div className="flex-1 overflow-y-auto">
        {queueVideos.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <span className="text-3xl mb-3">📋</span>
            <p className="text-sm text-text-muted">
              Right-click or use + to add videos
            </p>
          </div>
        ) : (
          <ul className="py-1">
            {queueVideos.map((video, index) => (
              <QueueItem
                key={video.id}
                video={video}
                index={index}
                isSFW={isSFW}
                onRemove={() => removeFromQueue(video.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}

// -----------------------------------------------------------
// Single queue item row
// -----------------------------------------------------------
function QueueItem({ video, index, isSFW, onRemove }) {
  const sfw = getSFWData(video.id)
  const thumb = isSFW ? sfw.thumbnail : video.thumbnail
  const title = isSFW ? sfw.title : video.title
  const duration = isSFW ? sfw.duration : video.durationFormatted

  return (
    <li className="group flex items-center gap-3 px-4 py-2 hover:bg-surface-overlay transition-colors">
      {/* Index */}
      <span className="text-xs text-text-muted w-4 shrink-0 text-right">
        {index + 1}
      </span>

      {/* Thumbnail */}
      <div className="w-16 aspect-video rounded overflow-hidden bg-surface-overlay shrink-0">
        {thumb ? (
          <img src={thumb} alt="" className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-text-muted text-xs">
            ▶
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-text-primary truncate">{title}</p>
        <p className="text-xs text-text-muted">{duration || '0:00'}</p>
      </div>

      {/* Remove button */}
      <button
        onClick={(e) => { e.stopPropagation(); onRemove() }}
        className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-text-primary
          transition-all text-sm shrink-0"
        title="Remove from queue"
      >
        ✕
      </button>
    </li>
  )
}
