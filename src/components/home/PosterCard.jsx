import { forwardRef, memo, useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useHomeStore from '../../stores/homeStore'
import useQueueStore from '../../stores/queueStore'
import useRatingsStore from '../../stores/ratingsStore'
import useToastStore from '../../stores/toastStore'
import { registerPreviewTarget, prefetchStreamUrl } from '../../hooks/useFocusPreview'
import ThumbsRating from '../ThumbsRating'
import WhyThisCardTooltip from './WhyThisCardTooltip'
import useIsTouch from '../../hooks/useIsTouch'

// ============================================================
// PosterCard
// Individual poster card used in GalleryRow and GalleryShelf carousels.
// Supports focus expansion, mixed aspect ratios (h/v),
// distance-based dimming, badges, and overlay gradient.
// Width transitions use spring easing (450ms).
// ============================================================

// Spring easing — matches tailwind 'spring' preset
const EASE_SPRING = 'cubic-bezier(0.34, 1.56, 0.64, 1)'
const EASE_OUT = 'cubic-bezier(0.4, 0, 0.2, 1)'

// Width tokens
const WIDTH = {
  h: { default: 420, focused: 600 },
  v: { default: 320, focused: 420 },
}

// How many positions away from the focused card to mount a <video> preview element.
// 1 = focused card + its immediate neighbors. Keeps live <video> count well under
// iOS Safari's ~16 concurrent element cap even when many rows are visible.
const PREVIEW_MOUNT_DIST = 1

// Distance-based visual weight
function distProps(dist) {
  const raw = dist >= 3 ? 1 - dist * 0.18 : [1.0, 0.82, 0.64][dist]
  const clamped = Math.max(0.1, Math.min(1, raw))
  const scale = dist === 0 ? 1.0 : dist === 1 ? 0.98 : dist === 2 ? 0.96 : Math.max(0.88, 1 - dist * 0.04)
  return { opacity: clamped, brightness: clamped, scale }
}

const PosterCard = memo(
  forwardRef(function PosterCard({ item, dist, isFocused, onClick, loading = 'lazy', variant = 'poster', progressPercent, surfaceKey, onRated }, ref) {
    const [showThumbs, setShowThumbs] = useState(false)
    const [showReason, setShowReason] = useState(false)
    const reasonTimerRef = useRef(null)
    const navigate = useNavigate()
    const markViewed = useHomeStore((s) => s.markViewed)
    const addToQueue = useQueueStore((s) => s.addToQueue)
    const recordRating = useRatingsStore((s) => s.recordRating)
    const existingRating = useRatingsStore((s) => s.ratedUrls[item?.url])
    const isToastPaused = useRatingsStore((s) => s.isToastPaused)
    const showToast = useToastStore((s) => s.showToast)
    const dismissAndAdvance = useHomeStore((s) => s.dismissAndAdvance)
    // True when the primary pointer is touch/coarse — disables hover-gating on the
    // thumbs overlay so it's always visible on the focused card on mobile.
    const isTouch = useIsTouch()
    // Subscribe to whether THIS card is the current preview focus (i.e. hovered).
    // Zustand only re-renders this specific card when focusedItem.id matches item.id,
    // so the subscription cost across 250+ cards is negligible.
    const isFocusedByPreview = useHomeStore((s) => s.focusedItem?.id === item?.id)

    // Callback ref for the conditionally-mounted <video> element.
    // Using useState (not useRef) so Effect 2 re-runs when the element mounts/unmounts.
    const [videoEl, setVideoEl] = useState(null)
    const containerRef = useRef(null)
    // Combine the forwarded ref with our local containerRef so the IO can observe the card.
    const setContainerRef = useCallback((node) => {
      containerRef.current = node
      if (typeof ref === 'function') ref(node)
      else if (ref) ref.current = node
    }, [ref])

    // Effect 1 — viewport-aware stream URL prefetch on the card container.
    // Decoupled from video mount so the prefetch fires for every card in the
    // viewport, not just the ones near focus. By the time the user hovers, the
    // URL is usually already cached and the preview attaches in <300ms.
    useEffect(() => {
      const id = item?.id
      const url = item?.url
      const container = containerRef.current
      if (!id || !url || !container || typeof IntersectionObserver === 'undefined') return undefined
      let prefetched = false
      const io = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting && !prefetched) {
              prefetched = true
              prefetchStreamUrl(id, url)
              io.disconnect()
              break
            }
          }
        },
        { rootMargin: '300px 1000px', threshold: 0.01 }
      )
      io.observe(container)
      return () => io.disconnect()
    }, [item?.id, item?.url])

    // Effect 2 — register the video element with useFocusPreview.
    // Only runs when videoEl is non-null (i.e. dist <= PREVIEW_MOUNT_DIST).
    // The returned cleanup removes the entry from videoTargets on unmount so
    // stale refs never linger in the module-level Map.
    useEffect(() => {
      const id = item?.id
      if (!id || !videoEl) return undefined
      return registerPreviewTarget(id, videoEl)
    }, [item?.id, videoEl])

    useEffect(() => () => clearTimeout(reasonTimerRef.current), [])

    const orient = item?.orient || 'h'
    const widths = WIDTH[orient] ?? WIDTH.h
    const width = isFocused ? widths.focused : widths.default
    const { opacity, brightness, scale } = distProps(dist)

    // Focused card overrides opacity/brightness/scale to 1
    const finalOpacity = isFocused ? 1 : opacity
    const finalBrightness = isFocused ? 1 : brightness
    const finalScale = isFocused ? 1 : scale

    // Landscape rows (e.g. Continue Watching, category rows) get capped height.
    // 16:9 cards at full 50vh would be too wide on 1080p+ monitors, so we cap.
    // Portrait rows get a mobile cap so ~2 cards are visible on narrow viewports.
    const isMobilePortrait = typeof window !== 'undefined' && window.innerWidth <= 640
    const cardHeight = variant === 'landscape' ? 'min(50vh, 420px)' : isMobilePortrait ? 'min(35vh, 220px)' : '50vh'

    const containerStyle = {
      position: 'relative',
      flexShrink: 0,
      width: `${width}px`,
      height: cardHeight,
      borderRadius: '12px',
      overflow: 'hidden',
      cursor: 'pointer',
      border: '1px solid',
      borderColor: isFocused ? 'rgba(30,58,138,0.3)' : 'var(--glass-border)',
      boxShadow: isFocused
        ? '0 0 24px rgba(30,58,138,0.4), 0 0 60px rgba(30,58,138,0.2), 0 20px 60px rgba(0,0,0,0.5)'
        : 'inset 0 1px 0 var(--glass-highlight), 0 4px 24px rgba(0,0,0,0.35)',
      zIndex: isFocused ? 10 : 1,
      opacity: finalOpacity,
      transform: `scale(${finalScale})`,
      filter: `brightness(${finalBrightness})`,
      // Width spring, opacity/filter/transform ease-out
      transition: [
        `width 450ms ${EASE_SPRING}`,
        `opacity 300ms ${EASE_OUT}`,
        `transform 300ms ${EASE_OUT}`,
        `filter 300ms ${EASE_OUT}`,
        `border-color 200ms ${EASE_OUT}`,
        `box-shadow 200ms ${EASE_OUT}`,
      ].join(', '),
      backgroundColor: 'var(--glass-bg)',
    }

    const imgStyle = {
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      objectPosition: 'center',
      display: 'block',
    }

    const handleRate = async (rating) => {
      if (existingRating || !item?.url) return
      recordRating(item.url, surfaceKey, rating)
      // Drop the card immediately on thumbs-down. Server-side filtering
      // covers the persistence on the next fetch; this is the optimistic
      // hide so the user doesn't keep staring at it.
      if (rating === 'down') dismissAndAdvance(item)
      try {
        await fetch('/api/ratings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            videoUrl: item.url, surfaceType: 'home_row', surfaceKey,
            rating, tags: item.tags || [], creator: item.uploader || '',
            title: item.title || '', thumbnail: item.thumbnail || '', source: item.genre || '',
          }),
        })
      } catch { /* silent */ }
      if (!isToastPaused() && rating === 'up' && item?.uploader) {
        showToast(`Saved. More from ${item.uploader} coming your way.`, 'success')
      }
    }

    const isExpanded = isFocused && variant !== 'landscape'

    // Gradient — stronger on expanded focused poster cards to back the richer content
    const overlayStyle = {
      position: 'absolute',
      inset: 0,
      background: isExpanded
        ? 'linear-gradient(to top, rgba(0,0,0,0.97) 0%, rgba(0,0,0,0.80) 50%, rgba(0,0,0,0.2) 75%, transparent 100%)'
        : 'linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.55) 45%, transparent 100%)',
      transition: `background 200ms ${EASE_OUT}`,
      pointerEvents: 'none',
    }

    // Content layer — always visible; expanded when focused poster
    const textOverlayStyle = {
      position: 'absolute',
      inset: 0,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'flex-end',
      padding: isExpanded ? '14px 16px 14px' : '20px 16px 16px',
      pointerEvents: isExpanded ? 'auto' : 'none',
    }

    const durationBadgeStyle = {
      position: 'absolute',
      top: '10px',
      right: '10px',
      backgroundColor: 'rgba(0,0,0,0.6)',
      backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
      borderRadius: '8px',
      padding: '3px 7px',
      fontSize: '11px',
      lineHeight: '1.45',
      fontWeight: 600,
      color: 'rgba(255,255,255,0.9)',
      letterSpacing: '0.02em',
    }

    const shortBadgeStyle = {
      position: 'absolute',
      top: '10px',
      left: '10px',
      backgroundColor: 'rgba(0,0,0,0.6)',
      backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
      borderRadius: '8px',
      padding: '3px 8px',
      fontSize: '11px',
      lineHeight: '1.45',
      fontWeight: 600,
      color: 'rgba(255,255,255,0.9)',
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
    }

    const titleStyle = {
      fontFamily: 'var(--font-display, "Space Grotesk", system-ui, sans-serif)',
      color: 'var(--color-text-primary, #e5e5e5)',
      fontSize: isExpanded ? '15px' : '14px',
      fontWeight: 700,
      lineHeight: 1.3,
      display: '-webkit-box',
      WebkitLineClamp: 2,
      WebkitBoxOrient: 'vertical',
      overflow: 'hidden',
      marginBottom: '5px',
    }

    const metaStyle = {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      fontSize: '12px',
      lineHeight: 1.4,
      color: 'rgba(255,255,255,0.6)',
    }

    const metaDotStyle = {
      width: '2px',
      height: '2px',
      borderRadius: '50%',
      backgroundColor: 'rgba(255,255,255,0.4)',
      flexShrink: 0,
    }

    const pillStyle = {
      fontSize: '10px',
      fontWeight: 500,
      color: 'rgba(255,255,255,0.75)',
      backgroundColor: 'rgba(255,255,255,0.1)',
      backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
      borderRadius: '999px',
      padding: '2px 9px',
      lineHeight: 1.5,
      letterSpacing: '0.02em',
    }

    const btnBase = {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: '8px',
      fontSize: '12px',
      fontWeight: 600,
      cursor: 'pointer',
      fontFamily: 'inherit',
      letterSpacing: '0.01em',
      border: 'none',
    }

    return (
      <div ref={setContainerRef} style={containerStyle} className={isFocused ? 'poster-card-focused' : undefined}
        onClick={onClick} role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.() } }}
        onMouseEnter={() => {
          if (isFocused && !isExpanded) setShowThumbs(true)
          clearTimeout(reasonTimerRef.current)
          if (item?.reason) {
            reasonTimerRef.current = setTimeout(() => setShowReason(true), 600)
          }
        }}
        onMouseLeave={() => {
          setShowThumbs(false)
          clearTimeout(reasonTimerRef.current)
          setShowReason(false)
        }}>

        {/* Thumbnail */}
        {item?.thumbnail ? (
          <img
            src={item.thumbnail}
            alt={item.title || ''}
            loading={loading}
            draggable={false}
            data-parallax-img
            style={imgStyle}
          />
        ) : (
          <div style={{ ...imgStyle, backgroundColor: 'rgba(255,255,255,0.05)' }} />
        )}

        {/* Hover preview video — mounted when this card is the preview focus (hovered)
            OR within PREVIEW_MOUNT_DIST of the scroll-center (for keyboard nav).
            Keeps live <video> count small; useFocusPreview flips opacity once canplay fires.
            Source order places it above the thumbnail but below badges/overlays. */}
        {(dist <= PREVIEW_MOUNT_DIST || isFocusedByPreview) && (
          <video
            ref={setVideoEl}
            muted
            playsInline
            loop
            preload="none"
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              objectPosition: 'center',
              opacity: 0,
              transition: `opacity 250ms ${EASE_OUT}`,
              pointerEvents: 'none',
            }}
          />
        )}

        {/* Duration badge — top-right */}
        {item?.duration && (
          <div style={durationBadgeStyle}>{item.duration}</div>
        )}

        {/* Orientation badge — top-left, vertical only */}
        {orient === 'v' && (
          <div style={shortBadgeStyle}>Short</div>
        )}

        {/* Why this card? — surfaces after 600ms hover */}
        {showReason && <WhyThisCardTooltip reason={item?.reason} />}

        {/* Gradient */}
        <div style={overlayStyle} />

        {/* Content overlay — expands when focused poster */}
        <div style={textOverlayStyle} onClick={isExpanded ? (e) => e.stopPropagation() : undefined}>
          {isExpanded ? (
            <>
              {/* Genre + duration pills */}
              {(item?.genre || item?.duration) && (
                <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginBottom: '7px' }}>
                  {item.genre && <span style={pillStyle}>{item.genre}</span>}
                  {item.duration && <span style={pillStyle}>{item.duration}</span>}
                </div>
              )}
              {/* Title */}
              {item?.title && <div style={titleStyle}>{item.title}</div>}
              {/* Meta */}
              <div style={{ ...metaStyle, marginBottom: item?.desc ? '5px' : '9px' }}>
                {item?.views && <span style={{ flexShrink: 0 }}>{item.views} views</span>}
                {item?.views && item?.uploader && <span style={metaDotStyle} />}
                {item?.uploader && (
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.uploader}
                  </span>
                )}
              </div>
              {/* Description */}
              {item?.desc && (
                <div style={{
                  fontSize: '11px',
                  lineHeight: 1.5,
                  color: 'rgba(255,255,255,0.45)',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                  marginBottom: '9px',
                }}>
                  {item.desc}
                </div>
              )}
              {/* Actions */}
              <div style={{ display: 'flex', gap: '7px', alignItems: 'center' }}>
                <button
                  style={{ ...btnBase, backgroundColor: 'rgba(30,58,138,0.55)', backdropFilter: 'blur(8px)', border: '1px solid rgba(30,58,138,0.3)', color: '#fff', padding: '7px 16px', gap: '5px' }}
                  onClick={(e) => { e.stopPropagation(); markViewed(item.id); navigate(`/watch/${item.id}`) }}
                >
                  ▶ Play
                </button>
                <button
                  style={{ ...btnBase, backgroundColor: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.85)', border: '1px solid rgba(255,255,255,0.18)', padding: '7px 12px', gap: '5px' }}
                  onClick={(e) => { e.stopPropagation(); addToQueue(item) }}
                >
                  ≡ + Queue
                </button>
                {existingRating ? (
                  <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', paddingLeft: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      {existingRating === 'up'
                        ? <path d="M14 9V5a3 3 0 00-3-3l-4 9v11h11.28a2 2 0 002-1.7l1.38-9a2 2 0 00-2-2.3zM7 22H4a2 2 0 01-2-2v-7a2 2 0 012-2h3" />
                        : <path d="M10 15v4a3 3 0 003 3l4-9V2H5.72a2 2 0 00-2 1.7l-1.38 9a2 2 0 002 2.3zm7-13h2.67A2.31 2.31 0 0122 4v7a2.31 2.31 0 01-2.33 2H17" />}
                    </svg>
                    {existingRating === 'up' ? 'Liked' : 'Not for me'}
                  </span>
                ) : (
                  <>
                    <button
                      style={{ ...btnBase, backgroundColor: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.85)', border: '1px solid rgba(255,255,255,0.18)', padding: '7px 10px' }}
                      onClick={(e) => { e.stopPropagation(); handleRate('up') }}
                      aria-label="Like this"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 9V5a3 3 0 00-3-3l-4 9v11h11.28a2 2 0 002-1.7l1.38-9a2 2 0 00-2-2.3zM7 22H4a2 2 0 01-2-2v-7a2 2 0 012-2h3" />
                      </svg>
                    </button>
                    <button
                      style={{ ...btnBase, backgroundColor: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.85)', border: '1px solid rgba(255,255,255,0.18)', padding: '7px 10px' }}
                      onClick={(e) => { e.stopPropagation(); handleRate('down') }}
                      aria-label="Not for me"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M10 15v4a3 3 0 003 3l4-9V2H5.72a2 2 0 00-2 1.7l-1.38 9a2 2 0 002 2.3zm7-13h2.67A2.31 2.31 0 0122 4v7a2.31 2.31 0 01-2.33 2H17" />
                      </svg>
                    </button>
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              {item?.title && <div style={titleStyle}>{item.title}</div>}
            </>
          )}
        </div>

        {/* Watch progress bar — Continue Watching cards */}
        {progressPercent > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-white/10 z-content">
            <div
              className="h-full bg-accent rounded-r-sm"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        )}

        {/* Thumbs rating overlay — focused landscape cards.
            Mouse: shown on hover (showThumbs gate).
            Touch: shown immediately on focus (no hover events available). */}
        {isFocused && !isExpanded && item?.url && (
          <ThumbsRating
            videoUrl={item.url}
            surfaceType="home_row"
            surfaceKey={surfaceKey}
            tags={item.tags || []}
            creator={item.uploader || ''}
            title={item.title || ''}
            thumbnail={item.thumbnail || ''}
            source={item.genre || ''}
            visible={isTouch ? true : showThumbs}
            onRated={onRated}
            item={item}
          />
        )}
      </div>
    )
  }),
  // Custom memo comparator — only re-render if dist, item, isFocused, variant, or surfaceKey changes
  (prev, next) =>
    prev.dist === next.dist &&
    prev.isFocused === next.isFocused &&
    prev.item === next.item &&
    prev.variant === next.variant &&
    prev.progressPercent === next.progressPercent &&
    prev.surfaceKey === next.surfaceKey
)

PosterCard.displayName = 'PosterCard'

export default PosterCard
