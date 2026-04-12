import { memo, useMemo } from 'react'

// ============================================================
// ProgressDots
// Windowed dot indicator for the poster carousel.
// Shows ~15 dots centered on the active real card.
// Window: 7 before active + active + 7 after.
// Dividers are excluded via realCardIndices.
// ============================================================

const HALF_WINDOW = 7

function ProgressDots({ realCardIndices, activeIndex, onNavigate }) {
  const dots = useMemo(() => {
    if (!realCardIndices || realCardIndices.length === 0) return []

    // Find position of active index within real cards
    const activePos = realCardIndices.indexOf(activeIndex)
    const clampedPos = activePos === -1 ? 0 : activePos

    // Window slice: 7 before + active + 7 after
    const start = Math.max(0, clampedPos - HALF_WINDOW)
    const end = Math.min(realCardIndices.length - 1, clampedPos + HALF_WINDOW)

    return realCardIndices.slice(start, end + 1).map((poolIndex) => ({
      poolIndex,
      isActive: poolIndex === activeIndex,
    }))
  }, [realCardIndices, activeIndex])

  if (dots.length === 0) return null

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        gap: '5px',
        padding: '16px 0 0',
      }}
    >
      {dots.map(({ poolIndex, isActive }) => (
        <Dot
          key={poolIndex}
          poolIndex={poolIndex}
          isActive={isActive}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  )
}

// Individual dot — memoised so only active-state changes trigger re-renders
const Dot = memo(function Dot({ poolIndex, isActive, onNavigate }) {
  return (
    <button
      aria-label={`Go to card ${poolIndex}`}
      onClick={isActive ? undefined : () => onNavigate(poolIndex)}
      style={{
        display: 'block',
        flexShrink: 0,
        width: isActive ? '24px' : '6px',
        height: '6px',
        borderRadius: isActive ? '3px' : '50%',
        background: isActive ? '#f43f5e' : 'rgba(255,255,255,0.10)',
        border: 'none',
        padding: 0,
        cursor: isActive ? 'default' : 'pointer',
        transition: 'all 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)',
      }}
      onMouseEnter={
        isActive
          ? undefined
          : (e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.25)' }
      }
      onMouseLeave={
        isActive
          ? undefined
          : (e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.10)' }
      }
    />
  )
})

export default memo(ProgressDots)
