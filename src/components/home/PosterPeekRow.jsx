import { memo } from 'react'

// ============================================================
// PosterPeekRow
// Preview strip rendered below the poster carousel progress dots.
// Shows up to 8 thumbnails from the next unloaded category.
// Clicking anywhere on the row calls onActivate() which hydrates
// that category into the carousel pool and jumps to it.
// ============================================================

const MAX_THUMBS = 8

const rowStyle = {
  padding: '16px 48px 20px',
  cursor: 'pointer',
  userSelect: 'none',
}

const labelStyle = {
  fontFamily: "'Space Grotesk', system-ui, sans-serif",
  fontSize: '10px',
  fontWeight: 600,
  letterSpacing: '1.5px',
  textTransform: 'uppercase',
  color: '#8a8a90',
  opacity: 0.45,
  marginBottom: '10px',
}

const trackWrapStyle = {
  height: '72px',
  overflow: 'hidden',
  maskImage: 'linear-gradient(to right, black 65%, transparent 100%)',
  WebkitMaskImage: 'linear-gradient(to right, black 65%, transparent 100%)',
}

const trackStyle = {
  display: 'flex',
  flexDirection: 'row',
  gap: '12px',
  height: '72px',
}

function thumbWidth(orient) {
  return orient === 'v' ? 48 : 96
}

const thumbContainerBase = {
  flexShrink: 0,
  height: '72px',
  borderRadius: '10px',
  overflow: 'hidden',
  transition: 'opacity 200ms ease',
}

const imgStyle = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
}

// Individual thumbnail — handles hover opacity
const Thumb = memo(function Thumb({ item }) {
  const orient = item?.orient || 'h'
  const width = thumbWidth(orient)

  const containerStyle = {
    ...thumbContainerBase,
    width: `${width}px`,
    opacity: 0.3,
  }

  function handleMouseEnter(e) {
    e.currentTarget.style.opacity = '0.6'
  }

  function handleMouseLeave(e) {
    e.currentTarget.style.opacity = '0.3'
  }

  return (
    <div
      style={containerStyle}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {item?.thumbnail ? (
        <img
          src={item.thumbnail}
          alt={item.title || ''}
          loading="lazy"
          draggable={false}
          style={imgStyle}
        />
      ) : (
        <div style={{ ...imgStyle, backgroundColor: 'rgba(255,255,255,0.06)' }} />
      )}
    </div>
  )
})

const PosterPeekRow = memo(function PosterPeekRow({ category, onActivate }) {
  if (!category) return null

  const thumbs = (category.items || []).slice(0, MAX_THUMBS)
  const label = category.label || category.originalLabel || ''

  return (
    <div style={rowStyle} onClick={onActivate} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate?.() } }}
    >
      {label ? <div style={labelStyle}>{label}</div> : null}

      <div style={trackWrapStyle}>
        <div style={trackStyle}>
          {thumbs.map((item, i) => (
            <Thumb key={item?.id ?? item?.url ?? i} item={item} />
          ))}
        </div>
      </div>
    </div>
  )
})

PosterPeekRow.displayName = 'PosterPeekRow'

export default PosterPeekRow
