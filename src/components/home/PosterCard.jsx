import { forwardRef, memo, useState } from 'react'
import ThumbsRating from '../ThumbsRating'

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
    const orient = item?.orient || 'h'
    const widths = WIDTH[orient] ?? WIDTH.h
    const width = isFocused ? widths.focused : widths.default
    const { opacity, brightness, scale } = distProps(dist)

    // Focused card overrides opacity/brightness/scale to 1
    const finalOpacity = isFocused ? 1 : opacity
    const finalBrightness = isFocused ? 1 : brightness
    const finalScale = isFocused ? 1 : scale

    // Landscape rows (e.g. Continue Watching, category rows) get capped height
    const cardHeight = variant === 'landscape' ? 'min(50vh, 360px)' : '50vh'

    const containerStyle = {
      position: 'relative',
      flexShrink: 0,
      width: `${width}px`,
      height: cardHeight,
      borderRadius: '12px',
      overflow: 'hidden',
      cursor: 'pointer',
      border: '2px solid',
      borderColor: isFocused ? '#f43f5e' : 'transparent',
      boxShadow: isFocused
        ? '0 0 0 1px #f43f5e, 0 0 48px rgba(244,63,94,0.18), 0 20px 60px rgba(0,0,0,0.5)'
        : '0 4px 24px rgba(0,0,0,0.35)',
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

    const overlayStyle = {
      position: 'absolute',
      inset: 0,
      background: 'linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.55) 45%, transparent 100%)',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'flex-end',
      padding: '20px 16px 16px',
      opacity: isFocused ? 0 : 1,
      transition: `opacity 200ms ${EASE_OUT}`,
      pointerEvents: 'none',
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
      fontSize: '14px',
      fontWeight: 700,
      lineHeight: 1.3,
      // Two-line clamp
      display: '-webkit-box',
      WebkitLineClamp: 2,
      WebkitBoxOrient: 'vertical',
      overflow: 'hidden',
      marginBottom: '6px',
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

    return (
      <div ref={ref} style={containerStyle} onClick={onClick} role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.() } }}
        onMouseEnter={() => isFocused && setShowThumbs(true)}
        onMouseLeave={() => setShowThumbs(false)}>

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

        {/* Duration badge — top-right */}
        {item?.duration && (
          <div style={durationBadgeStyle}>{item.duration}</div>
        )}

        {/* Orientation badge — top-left, vertical only */}
        {orient === 'v' && (
          <div style={shortBadgeStyle}>Short</div>
        )}

        {/* Overlay gradient with title + meta */}
        <div style={overlayStyle}>
          {item?.title && (
            <div style={titleStyle}>{item.title}</div>
          )}
          <div style={metaStyle}>
            {item?.uploader && (
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>
                {item.uploader}
              </span>
            )}
            {item?.uploader && item?.views && <span style={metaDotStyle} />}
            {item?.views && <span style={{ flexShrink: 0 }}>{item.views}</span>}
          </div>
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

        {/* Thumbs rating overlay — focused card on hover only */}
        {isFocused && item?.url && (
          <ThumbsRating
            videoUrl={item.url}
            surfaceType="home_row"
            surfaceKey={surfaceKey}
            tags={item.tags || []}
            creator={item.uploader || ''}
            title={item.title || ''}
            thumbnail={item.thumbnail || ''}
            source={item.genre || ''}
            visible={showThumbs}
            onRated={onRated}
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
