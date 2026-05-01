import { memo } from 'react'

// ============================================================
// CategoryDivider
// Vertical glass pill rendered between categories in the
// infinite carousel pool (5c.2b). Glass capsule with rotated
// label + arrow. Arrow keys / scroll skip past dividers.
// Width is intentionally narrow so it reads as separation,
// not as a card.
// ============================================================

const PILL_WIDTH = 56

const containerStyle = {
  flex: `0 0 ${PILL_WIDTH}px`,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  scrollSnapAlign: 'none', // Don't snap onto dividers
  pointerEvents: 'none', // Don't intercept clicks
}

const pillStyle = {
  width: `${PILL_WIDTH}px`,
  height: '70%',
  borderRadius: '999px',
  background: 'var(--glass-bg)',
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  border: '1px solid var(--glass-border)',
  boxShadow:
    '0 6px 20px rgba(0,0,0,0.3), inset 0 1px 0 var(--glass-highlight)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '14px 0',
  position: 'relative',
}

const labelStyle = {
  fontFamily: "'Space Grotesk', system-ui, sans-serif",
  fontSize: '10px',
  fontWeight: 700,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: 'var(--color-text-muted, #8a8a90)',
  writingMode: 'vertical-rl',
  transform: 'rotate(180deg)',
  whiteSpace: 'nowrap',
  maxHeight: '70%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

const arrowStyle = {
  color: 'var(--color-accent, #1e3a8a)',
  fontSize: '13px',
  lineHeight: 1,
  fontWeight: 700,
}

const CategoryDivider = memo(function CategoryDivider({ label }) {
  return (
    <div
      style={containerStyle}
      data-divider="true"
      aria-hidden="true"
    >
      <div style={pillStyle}>
        <span style={arrowStyle}>↓</span>
        <span style={labelStyle}>{label}</span>
        <span style={{ ...arrowStyle, opacity: 0 }}>↓</span>
      </div>
    </div>
  )
})

CategoryDivider.displayName = 'CategoryDivider'

export default CategoryDivider
