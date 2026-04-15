import { useEffect, useRef, useState, useCallback } from 'react'
import useHomeStore from '../../stores/homeStore'
import useQueueStore from '../../stores/queueStore'

// ============================================================
// PosterInfoPanel
// Card-anchored glass metadata panel for the focused poster card.
// Rendered inside GalleryShelf (not inside PosterCard), positioned
// absolutely over the track wrapper, centered on the focused card.
// Slides up from translateY(20px) → translateY(-24px) on focus.
// ============================================================

const EASE_SPRING = 'cubic-bezier(0.34, 1.56, 0.64, 1)'
const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)'
const ACCENT = '#f43f5e'

// How long rapid-nav debounce waits before re-showing panel (ms)
const NAV_DEBOUNCE_MS = 120

export default function PosterInfoPanel({ item, cardRef, trackWrapRef }) {
  const [pos, setPos] = useState(null)       // { left, top, width }
  const [visible, setVisible] = useState(false)
  const [entering, setEntering] = useState(false)
  const debounceRef = useRef(null)
  const roRef = useRef(null)

  const markViewed = useHomeStore((s) => s.markViewed)
  const setHeroItem = useHomeStore((s) => s.setHeroItem)
  const setTheatreMode = useHomeStore((s) => s.setTheatreMode)
  const addToQueue = useQueueStore((s) => s.addToQueue)

  // -------------------------------------------------------
  // Layout: compute position relative to trackWrapRef
  // -------------------------------------------------------
  const recalc = useCallback(() => {
    if (!cardRef?.current || !trackWrapRef?.current) return
    const cardRect = cardRef.current.getBoundingClientRect()
    const wrapRect = trackWrapRef.current.getBoundingClientRect()

    const left = cardRect.left - wrapRect.left + cardRect.width / 2  // center of card
    const top = cardRect.bottom - wrapRect.top                         // card's bottom edge

    setPos({ left, top, cardWidth: cardRect.width })
  }, [cardRef, trackWrapRef])

  // -------------------------------------------------------
  // React to item / card ref changes (focus change)
  // -------------------------------------------------------
  useEffect(() => {
    if (!item) {
      // No focused item — hide immediately
      setVisible(false)
      setEntering(false)
      clearTimeout(debounceRef.current)
      return
    }

    // Rapid navigation: fade out immediately, wait briefly, then show
    setVisible(false)
    setEntering(false)
    clearTimeout(debounceRef.current)

    debounceRef.current = setTimeout(() => {
      recalc()
      setVisible(true)
      // Short delay so browser paints the initial state before entering kicks in
      setTimeout(() => setEntering(true), 20)
    }, NAV_DEBOUNCE_MS)

    return () => clearTimeout(debounceRef.current)
  }, [item, recalc])

  // -------------------------------------------------------
  // ResizeObserver on trackWrapRef to recalc on resize
  // -------------------------------------------------------
  useEffect(() => {
    if (!trackWrapRef?.current) return
    roRef.current = new ResizeObserver(() => {
      if (item) recalc()
    })
    roRef.current.observe(trackWrapRef.current)
    window.addEventListener('resize', recalc, { passive: true })
    return () => {
      roRef.current?.disconnect()
      window.removeEventListener('resize', recalc)
    }
  }, [trackWrapRef, item, recalc])

  // -------------------------------------------------------
  // Nothing to render
  // -------------------------------------------------------
  if (!item || !pos) return null

  // -------------------------------------------------------
  // Stagger helpers
  // -------------------------------------------------------
  const stagger = (delayMs) => ({
    opacity: entering ? 1 : 0,
    transform: entering ? 'translateY(0)' : 'translateY(8px)',
    transition: `opacity 240ms ${EASE_OUT} ${delayMs}ms, transform 240ms ${EASE_OUT} ${delayMs}ms`,
  })

  // -------------------------------------------------------
  // Panel position + entrance
  // -------------------------------------------------------
  const panelStyle = {
    position: 'absolute',
    left: `${pos.left}px`,
    top: `${pos.top}px`,
    transform: entering ? 'translate(-50%, -24px)' : 'translate(-50%, 20px)',
    transition: visible
      ? `opacity 350ms ${EASE_SPRING}, transform 350ms ${EASE_SPRING}`
      : `opacity 120ms ${EASE_OUT}`,
    opacity: visible && entering ? 1 : 0,
    zIndex: 20,
    pointerEvents: visible && entering ? 'auto' : 'none',
    width: 'min(420px, 90vw)',
    maxWidth: '420px',
    borderRadius: '16px',
    padding: '24px 28px',
    backgroundColor: 'rgba(10,10,12,0.50)',
    backdropFilter: 'blur(24px)',
    WebkitBackdropFilter: 'blur(24px)',
    border: '1px solid var(--glass-border)',
    // Top highlight via box-shadow inset
    boxShadow: 'inset 0 1px 0 var(--glass-highlight), 0 8px 40px rgba(0,0,0,0.5)',
  }

  // -------------------------------------------------------
  // Action handlers
  // -------------------------------------------------------
  const handlePlay = () => {
    markViewed(item.id)
    setHeroItem(item)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTheatreMode(true)
  }

  const handleQueue = () => {
    addToQueue(item)
  }

  const handleFavorite = () => {
    fetch(`/api/library/favorite?id=${encodeURIComponent(item.id)}`, { method: 'POST' }).catch(() => {})
  }

  // -------------------------------------------------------
  // Derived display values
  // -------------------------------------------------------
  const genre = item.genre || null
  const duration = item.duration || null
  const rating = item.rating != null ? parseFloat(item.rating) : null
  const views = item.views || null
  const uploader = item.uploader || null
  const desc = item.desc || null

  return (
    <div style={panelStyle} role="complementary" aria-label="Video info">

      {/* Tags: genre + duration pills */}
      {(genre || duration) && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px', ...stagger(0) }}>
          {genre && (
            <span style={pillStyle}>{genre}</span>
          )}
          {duration && (
            <span style={pillStyle}>{duration}</span>
          )}
        </div>
      )}

      {/* Title */}
      {item.title && (
        <div style={{
          fontSize: 'clamp(20px, 2.2vw, 30px)',
          fontWeight: 700,
          letterSpacing: '-0.8px',
          lineHeight: 1.2,
          color: 'var(--color-text-primary, #e5e5e5)',
          marginBottom: '8px',
          fontFamily: 'var(--font-display, "Space Grotesk", system-ui, sans-serif)',
          ...stagger(60),
        }}>
          {item.title}
        </div>
      )}

      {/* Meta: rating · views · uploader */}
      {(rating != null || views || uploader) && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: '13px',
          color: 'rgba(255,255,255,0.6)',
          marginBottom: '10px',
          flexWrap: 'wrap',
          ...stagger(120),
        }}>
          {rating != null && (
            <>
              <span style={{ color: ACCENT, fontWeight: 600, display: 'flex', alignItems: 'center', gap: '3px' }}>
                <StarIcon />
                {rating.toFixed(1)}
                <span style={{ color: 'rgba(255,255,255,0.4)', fontWeight: 400 }}>/10</span>
              </span>
            </>
          )}
          {rating != null && (views || uploader) && <Dot />}
          {views && <span>{views} views</span>}
          {views && uploader && <Dot />}
          {uploader && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '140px' }}>{uploader}</span>}
        </div>
      )}

      {/* Description */}
      {desc && (
        <div style={{
          fontSize: '12px',
          lineHeight: 1.6,
          color: 'rgba(255,255,255,0.45)',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          marginBottom: '18px',
          ...stagger(180),
        }}>
          {desc}
        </div>
      )}

      {/* Action buttons */}
      <div style={{
        display: 'flex',
        gap: '8px',
        alignItems: 'center',
        ...stagger(240),
      }}>
        {/* Play */}
        <button
          onClick={handlePlay}
          style={{
            ...btnBase,
            backgroundColor: ACCENT,
            color: '#fff',
            border: 'none',
            padding: '9px 20px',
            gap: '6px',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#e11d48' }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ACCENT }}
        >
          <PlayIcon />
          Play
        </button>

        {/* Queue */}
        <button
          onClick={handleQueue}
          style={{
            ...btnBase,
            backgroundColor: 'var(--glass-bg)',
            color: 'rgba(255,255,255,0.8)',
            border: '1px solid var(--glass-border)',
            padding: '9px 16px',
            gap: '6px',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--glass-bg-elevated)' }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--glass-bg)' }}
        >
          <QueueIcon />
          + Queue
        </button>

        {/* Favorite */}
        <button
          onClick={handleFavorite}
          style={{
            ...btnBase,
            backgroundColor: 'var(--glass-bg)',
            color: 'rgba(255,255,255,0.8)',
            border: '1px solid var(--glass-border)',
            padding: '9px 12px',
            minWidth: '38px',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--glass-bg-elevated)' }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--glass-bg)' }}
          aria-label="Add to favorites"
        >
          <HeartIcon />
        </button>
      </div>
    </div>
  )
}

// -------------------------------------------------------
// Shared styles
// -------------------------------------------------------
const pillStyle = {
  fontSize: '10px',
  fontWeight: 500,
  color: 'rgba(255,255,255,0.7)',
  backgroundColor: 'rgba(255,255,255,0.06)',
  borderRadius: '999px',
  padding: '3px 10px',
  lineHeight: 1.5,
  letterSpacing: '0.02em',
}

const btnBase = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '10px',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
  transition: `background-color 150ms ${EASE_OUT}`,
  outline: 'none',
  fontFamily: 'inherit',
  letterSpacing: '0.01em',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
}

// -------------------------------------------------------
// Micro SVG icons (inline, no dep)
// -------------------------------------------------------
function StarIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill={ACCENT} style={{ flexShrink: 0 }}>
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
      <path d="M8 5v14l11-7z" />
    </svg>
  )
}

function QueueIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0 }}>
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  )
}

function HeartIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  )
}

function Dot() {
  return (
    <span style={{
      width: '2px',
      height: '2px',
      borderRadius: '50%',
      backgroundColor: 'rgba(255,255,255,0.3)',
      display: 'inline-block',
      flexShrink: 0,
    }} />
  )
}
