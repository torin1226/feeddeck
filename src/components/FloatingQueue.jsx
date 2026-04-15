import { useState, useEffect, useRef, useCallback } from 'react'
import useQueueStore from '../stores/queueStore'
import useModeStore from '../stores/modeStore'
import { queueCollapseRef } from '../hooks/useKeyboard'

// ============================================================
// FloatingQueue
// A floating pill/panel in the bottom-right corner that shows
// the playback queue. Collapsed by default (small pill),
// expands into a scrollable list with drag-to-reorder.
// In Social mode, shows neutral titles and thumbnails instead.
// ============================================================

export default function FloatingQueue() {
  const [expanded, setExpanded] = useState(false)
  const [pulsing, setPulsing] = useState(false)
  const [dragOverIdx, setDragOverIdx] = useState(-1)
  const panelRef = useRef(null)
  const dragFromIdx = useRef(null)
  const prevLength = useRef(0)

  const { isSFW } = useModeStore()
  const {
    queue,
    currentIndex,
    removeFromQueue,
    reorder,
    clearQueue,
  } = useQueueStore()

  // Register collapse callback so Escape key can close the panel
  useEffect(() => {
    queueCollapseRef.current = () => setExpanded(false)
    return () => { queueCollapseRef.current = null }
  }, [])

  // Pulse animation when a new item is added
  useEffect(() => {
    if (queue.length > prevLength.current && !expanded) {
      setPulsing(true)
      const timer = setTimeout(() => setPulsing(false), 200)
      prevLength.current = queue.length
      return () => clearTimeout(timer)
    }
    prevLength.current = queue.length
  }, [queue.length, expanded])

  // Close panel when clicking outside
  useEffect(() => {
    if (!expanded) return

    const handleClick = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setExpanded(false)
      }
    }

    // Small delay so the opening click doesn't immediately close it
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClick)
    }, 50)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClick)
    }
  }, [expanded])

  // Handle clear with confirmation if 3+ items
  const handleClear = useCallback(() => {
    if (queue.length >= 3) {
      if (!window.confirm(`Remove all ${queue.length} items from the queue?`)) {
        return
      }
    }
    clearQueue()
  }, [queue.length, clearQueue])

  // --- Drag and drop handlers ---
  const handleDragStart = (e, idx) => {
    dragFromIdx.current = idx
    e.dataTransfer.effectAllowed = 'move'
    // Make the drag image slightly transparent
    if (e.target) {
      e.dataTransfer.setDragImage(e.target, 0, 0)
    }
  }

  const handleDragOver = (e, idx) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverIdx(idx)
  }

  const handleDragLeave = () => {
    setDragOverIdx(-1)
  }

  const handleDrop = (e, toIdx) => {
    e.preventDefault()
    const fromIdx = dragFromIdx.current
    if (fromIdx !== null && fromIdx !== toIdx) {
      reorder(fromIdx, toIdx)
    }
    dragFromIdx.current = null
    setDragOverIdx(-1)
  }

  const handleDragEnd = () => {
    dragFromIdx.current = null
    setDragOverIdx(-1)
  }

  // -------------------------------------------------------
  // Collapsed pill view
  // -------------------------------------------------------
  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className={`fixed bottom-6 right-6 z-toast flex items-center gap-2 px-4 py-2.5
          bg-gray-900/90 backdrop-blur-sm rounded-full shadow-float
          border border-white/10 hover:border-white/20
          transition-all duration-200 cursor-pointer
          ${pulsing ? 'animate-queue-pulse' : ''}`}
      >
        {/* Queue icon */}
        <svg
          className="w-4 h-4 text-white/70"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h10" />
        </svg>

        <span className={`text-sm font-medium ${queue.length > 0 ? 'text-white' : 'text-white/50'}`}>
          Queue
        </span>

        {/* Count badge */}
        {queue.length > 0 && (
          <span className="min-w-[20px] h-5 flex items-center justify-center text-xs font-bold
            bg-accent text-white rounded-full px-1.5">
            {queue.length}
          </span>
        )}
      </button>
    )
  }

  // -------------------------------------------------------
  // Expanded panel view
  // -------------------------------------------------------
  return (
    <div
      ref={panelRef}
      className="fixed bottom-6 right-6 z-toast w-80 max-h-[60vh] flex flex-col
        bg-gray-900/95 backdrop-blur-md rounded-xl border border-white/10 shadow-modal
        animate-fade-slide-in"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0">
        <h3 className="text-sm font-semibold text-white">
          Queue
          {queue.length > 0 && (
            <span className="text-white/50 font-normal ml-1.5">
              ({queue.length})
            </span>
          )}
        </h3>
        {queue.length > 0 && (
          <button
            onClick={handleClear}
            className="text-xs text-white/50 hover:text-white transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Queue items list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {queue.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
            <span className="text-2xl mb-2 opacity-50">📋</span>
            <p className="text-sm text-white/40">No videos queued</p>
            <p className="text-xs text-white/25 mt-1">Click + on search results to add</p>
          </div>
        ) : (
          <ul className="py-1">
            {queue.map((item, index) => (
              <QueueRow
                key={item.id}
                item={item}
                index={index}
                isCurrent={index === currentIndex}
                isSFW={isSFW}
                showDropIndicator={dragOverIdx === index}
                onRemove={() => removeFromQueue(item.id)}
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, index)}
                onDragEnd={handleDragEnd}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Collapse chevron at bottom */}
      <button
        onClick={() => setExpanded(false)}
        aria-label="Collapse queue"
        className="flex items-center justify-center py-2 border-t border-white/10
          text-white/40 hover:text-white/70 transition-colors shrink-0"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
    </div>
  )
}

// -------------------------------------------------------
// Single queue item row
// Shows social data in SFW mode, real data otherwise.
// Supports drag-to-reorder and hover-to-remove.
// -------------------------------------------------------
function QueueRow({
  item,
  isCurrent,
  _isSFW,
  showDropIndicator,
  onRemove,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}) {
  const thumb = item.thumbnail
  const title = item.title
  const duration = item.duration_formatted || item.durationFormatted || '0:00'

  return (
    <li
      draggable="true"
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={`group relative flex items-center gap-3 px-4 py-2 cursor-grab
        active:cursor-grabbing transition-colors
        ${isCurrent ? 'bg-white/10 border-l-2 border-l-accent' : 'hover:bg-white/5 border-l-2 border-l-transparent'}
        ${showDropIndicator ? 'border-t-2 border-t-accent' : ''}`}
    >
      {/* Small thumbnail (56x36, roughly 16:9) */}
      <div className="w-14 h-9 rounded overflow-hidden bg-white/10 shrink-0">
        {thumb ? (
          <img
            src={thumb}
            alt={title}
            className="w-full h-full object-cover"
            loading="lazy"
            draggable="false"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-white/30 text-xs">
            ▶
          </div>
        )}
      </div>

      {/* Title and duration */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-white truncate">{title}</p>
        <p className="text-xs text-white/40">{duration}</p>
      </div>

      {/* Remove button — visible on hover */}
      <button
        onClick={(e) => { e.stopPropagation(); onRemove() }}
        className="opacity-0 group-hover:opacity-100 text-white/40 hover:text-white
          transition-all text-sm shrink-0 w-6 h-6 flex items-center justify-center rounded
          hover:bg-white/10"
        title="Remove from queue"
      >
        ✕
      </button>
    </li>
  )
}
