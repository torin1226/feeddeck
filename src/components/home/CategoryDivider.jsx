import { memo } from 'react'

// ============================================================
// CategoryDivider
// Vertical glass pill rendered between categories in the
// infinite carousel pool (5c.2b). Glass capsule with rotated
// label + arrow. Arrow keys / scroll skip past dividers.
//
// Pinned rows (subscriptions, liked, top performers) get a
// wider pill with accent glow + pin icon — visual landmarks
// so the user can spot "their" sections while scrolling.
// ============================================================

const PILL_WIDTH = 56
const PINNED_PILL_WIDTH = 72

const makeContainerStyle = (pinned) => ({
  flex: `0 0 ${pinned ? PINNED_PILL_WIDTH : PILL_WIDTH}px`,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  scrollSnapAlign: 'none',
  pointerEvents: 'none',
})

const basePillStyle = {
  height: '70%',
  borderRadius: '999px',
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '14px 0',
  position: 'relative',
}

const defaultPillStyle = {
  ...basePillStyle,
  width: `${PILL_WIDTH}px`,
  background: 'var(--glass-bg)',
  border: '1px solid var(--glass-border)',
  boxShadow:
    '0 6px 20px rgba(0,0,0,0.3), inset 0 1px 0 var(--glass-highlight)',
}

const pinnedPillStyle = {
  ...basePillStyle,
  width: `${PINNED_PILL_WIDTH}px`,
  background: 'linear-gradient(180deg, var(--glass-accent-bg) 0%, var(--glass-bg) 100%)',
  border: '1px solid var(--glass-accent-border)',
  boxShadow:
    'var(--glass-glow-accent), 0 6px 20px rgba(0,0,0,0.3), inset 0 1px 0 var(--glass-highlight)',
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

const pinnedLabelStyle = {
  ...labelStyle,
  color: 'var(--color-accent, #3b82f6)',
  fontSize: '11px',
  letterSpacing: '0.14em',
}

const arrowStyle = {
  color: 'var(--color-accent, #3b82f6)',
  fontSize: '13px',
  lineHeight: 1,
  fontWeight: 700,
}

// Pin icon for pinned rows — small filled circle with a vertical line
const pinIconStyle = {
  width: '16px',
  height: '16px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  opacity: 0.9,
}

function PinIcon() {
  return (
    <svg
      style={pinIconStyle}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="8" cy="6" r="4" fill="var(--color-accent, #3b82f6)" opacity="0.6" />
      <line x1="8" y1="10" x2="8" y2="15" stroke="var(--color-accent, #3b82f6)" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
    </svg>
  )
}

const CategoryDivider = memo(function CategoryDivider({ label, pinned }) {
  const pill = pinned ? pinnedPillStyle : defaultPillStyle
  const lbl = pinned ? pinnedLabelStyle : labelStyle

  return (
    <div
      style={makeContainerStyle(pinned)}
      data-divider="true"
      data-pinned={pinned ? 'true' : undefined}
      aria-hidden="true"
    >
      <div style={pill}>
        {pinned ? <PinIcon /> : <span style={arrowStyle}>↓</span>}
        <span style={lbl}>{label}</span>
        <span style={{ ...arrowStyle, opacity: 0 }}>↓</span>
      </div>
    </div>
  )
})

CategoryDivider.displayName = 'CategoryDivider'

export default CategoryDivider
