import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import PosterCard from './PosterCard'
import PosterInfoPanel from './PosterInfoPanel'
import PosterPeekRow from './PosterPeekRow'
import ProgressDots from './ProgressDots'
import CategoryDivider from './CategoryDivider'
import useHomeStore from '../../stores/homeStore'

// ============================================================
// PosterShelf
// Main carousel engine. Builds a flat pool from homeStore
// categories, manages keyboard/wheel/click navigation,
// virtualises the DOM, and renders sub-components.
// ============================================================

const GAP = 20
const DEBOUNCE_MS = 280
const WHEEL_THRESHOLD = 65
const WHEEL_COOLDOWN = 350
const VIRTUALIZATION_WINDOW = 6

const EASE_SPRING = 'cubic-bezier(0.34, 1.56, 0.64, 1)'
const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)'

// Card widths matching PosterCard
function getCardWidth(poolEntry, isFocused) {
  if (!poolEntry) return 0
  if (poolEntry._divider) return 32
  const orient = poolEntry.orient || 'h'
  if (orient === 'v') return isFocused ? 420 : 320
  return isFocused ? 600 : 420
}

// Inline hover style for arrow buttons
const ARROW_HOVER_CSS = `
.poster-arrow { pointer-events: auto; }
div:has(> .poster-arrow):hover .poster-arrow { opacity: 1 !important; }
.poster-arrow:hover { background: rgba(255,255,255,0.12) !important; }
@media (prefers-reduced-motion: reduce) {
  .poster-shelf-track { transition: none !important; }
}
`

export default function PosterShelf() {
  const categories = useHomeStore((s) => s.categories)

  // -- Pool state --
  const [pool, setPool] = useState([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [shelfLabel, setShelfLabel] = useState('')
  const [labelOpacity, setLabelOpacity] = useState(1)

  // Refs
  const trackWrapRef = useRef(null)
  const cardRefs = useRef({})
  const focusedCardRef = useRef(null)
  const poolRef = useRef(pool)
  poolRef.current = pool
  const goToTimer = useRef(null)
  const wheelAccum = useRef(0)
  const wheelCooldown = useRef(false)
  const wheelDecayTimer = useRef(null)
  const hydratedCatCount = useRef(0)
  const prevLabelRef = useRef('')

  // -------------------------------------------------------
  // Pool hydration
  // -------------------------------------------------------
  const hydrateCategory = useCallback((catIndex) => {
    if (!categories || categories.length === 0) return

    const wrappedIndex = catIndex % categories.length
    const cat = categories[wrappedIndex]
    if (!cat) return

    setPool((prev) => {
      const newEntries = []

      // Divider between categories (not before first)
      if (prev.length > 0) {
        newEntries.push({
          _divider: true,
          _catLabel: cat.label || '',
          _cat: wrappedIndex,
        })
      }

      // Items
      for (const item of cat.items || []) {
        newEntries.push({
          ...item,
          _cat: wrappedIndex,
          _catLabel: cat.label || '',
        })
      }

      return [...prev, ...newEntries]
    })

    hydratedCatCount.current = catIndex + 1
  }, [categories])

  // Initial hydration: first 2 categories on mount / when categories change
  useEffect(() => {
    if (!categories || categories.length === 0) return

    setPool([])
    setActiveIndex(0)
    hydratedCatCount.current = 0
    cardRefs.current = {}

    // Hydrate first 2
    const count = Math.min(2, categories.length)
    for (let i = 0; i < count; i++) {
      // Need to inline since hydrateCategory uses setPool in functional form
      const wrappedIndex = i % categories.length
      const cat = categories[wrappedIndex]
      if (!cat) continue

      setPool((prev) => {
        const newEntries = []
        if (prev.length > 0) {
          newEntries.push({
            _divider: true,
            _catLabel: cat.label || '',
            _cat: wrappedIndex,
          })
        }
        for (const item of cat.items || []) {
          newEntries.push({
            ...item,
            _cat: wrappedIndex,
            _catLabel: cat.label || '',
          })
        }
        return [...prev, ...newEntries]
      })
    }
    hydratedCatCount.current = count
  }, [categories]) // eslint-disable-line react-hooks/exhaustive-deps

  // Prefetch next category when approaching end
  useEffect(() => {
    if (pool.length === 0) return
    if (activeIndex >= pool.length - 3) {
      hydrateCategory(hydratedCatCount.current)
    }
  }, [activeIndex, pool.length, hydrateCategory])

  // -------------------------------------------------------
  // Shelf label cross-fade
  // -------------------------------------------------------
  useEffect(() => {
    const current = pool[activeIndex]
    if (!current) return
    const newLabel = current._catLabel || ''
    if (newLabel === prevLabelRef.current) return

    // Cross-fade: fade out, swap, fade in
    setLabelOpacity(0)
    const timer = setTimeout(() => {
      setShelfLabel(newLabel)
      prevLabelRef.current = newLabel
      setLabelOpacity(1)
    }, 250)

    return () => clearTimeout(timer)
  }, [activeIndex, pool])

  // Set initial label
  useEffect(() => {
    if (pool.length > 0 && !prevLabelRef.current) {
      const label = pool[0]?._catLabel || ''
      setShelfLabel(label)
      prevLabelRef.current = label
    }
  }, [pool])

  // -------------------------------------------------------
  // Navigation: goTo with debounce
  // -------------------------------------------------------
  const goTo = useCallback((index) => {
    clearTimeout(goToTimer.current)
    goToTimer.current = setTimeout(() => {
      const p = poolRef.current
      const target = Math.max(0, Math.min(index, p.length - 1))
      // Skip dividers — find nearest real card
      if (p[target]?._divider) {
        for (let d = 1; d < p.length; d++) {
          if (target + d < p.length && !p[target + d]?._divider) { setActiveIndex(target + d); return }
          if (target - d >= 0 && !p[target - d]?._divider) { setActiveIndex(target - d); return }
        }
      }
      setActiveIndex(target)
    }, DEBOUNCE_MS)
  }, [])

  // Immediate setter (no debounce) for click
  const goToImmediate = useCallback((index) => {
    clearTimeout(goToTimer.current)
    const p = poolRef.current
    const target = Math.max(0, Math.min(index, p.length - 1))
    if (!p[target]?._divider) {
      setActiveIndex(target)
    }
  }, [])

  // -------------------------------------------------------
  // Find next/prev real card (skip dividers)
  // -------------------------------------------------------
  const findNext = useCallback((from) => {
    const p = poolRef.current
    for (let i = from + 1; i < p.length; i++) {
      if (!p[i]._divider) return i
    }
    return from // stay
  }, [])

  const findPrev = useCallback((from) => {
    const p = poolRef.current
    for (let i = from - 1; i >= 0; i--) {
      if (!p[i]._divider) return i
    }
    return from // stay
  }, [])

  // -------------------------------------------------------
  // Keyboard navigation — goes through goTo()
  // -------------------------------------------------------
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        goTo(findNext(activeIndex))
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        goTo(findPrev(activeIndex))
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [findNext, findPrev, activeIndex, goTo])

  // -------------------------------------------------------
  // Scroll wheel navigation
  // -------------------------------------------------------
  useEffect(() => {
    const el = trackWrapRef.current
    if (!el) return

    function onWheel(e) {
      // Let vertical scroll pass through
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX) * 2 && Math.abs(e.deltaX) < 10) return

      e.preventDefault()

      if (wheelCooldown.current) return

      wheelAccum.current += e.deltaX || e.deltaY

      // Decay timer
      clearInterval(wheelDecayTimer.current)
      wheelDecayTimer.current = setInterval(() => {
        wheelAccum.current *= 0.85
        if (Math.abs(wheelAccum.current) < 1) {
          wheelAccum.current = 0
          clearInterval(wheelDecayTimer.current)
        }
      }, 100)

      if (Math.abs(wheelAccum.current) >= WHEEL_THRESHOLD) {
        const direction = wheelAccum.current > 0 ? 1 : -1
        wheelAccum.current = 0

        setActiveIndex((prev) => {
          const next = direction > 0 ? findNext(prev) : findPrev(prev)
          return next
        })

        wheelCooldown.current = true
        setTimeout(() => { wheelCooldown.current = false }, WHEEL_COOLDOWN)
      }
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [findNext, findPrev])

  // -------------------------------------------------------
  // Track centering transform
  // -------------------------------------------------------
  const trackTransform = useMemo(() => {
    if (pool.length === 0) return 'translateX(0)'

    let offset = 0
    for (let i = 0; i < activeIndex; i++) {
      offset += getCardWidth(pool[i], i === activeIndex) + GAP
    }
    const activeW = getCardWidth(pool[activeIndex], true)

    // Use a fallback viewWidth for SSR / first render
    const viewW = trackWrapRef.current?.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 1200)
    const tx = -(offset - (viewW / 2 - activeW / 2))

    return `translateX(${tx}px)`
  }, [activeIndex, pool])

  // Force recalc on resize
  const [, setResizeTick] = useState(0)
  useEffect(() => {
    function onResize() { setResizeTick((t) => t + 1) }
    window.addEventListener('resize', onResize, { passive: true })
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // -------------------------------------------------------
  // Derived: real card indices for ProgressDots
  // -------------------------------------------------------
  const realCardIndices = useMemo(() => {
    return pool.reduce((acc, entry, i) => {
      if (!entry._divider) acc.push(i)
      return acc
    }, [])
  }, [pool])

  // -------------------------------------------------------
  // PosterPeekRow: next unloaded category
  // -------------------------------------------------------
  const nextCategory = useMemo(() => {
    if (!categories || categories.length === 0) return null
    const nextIdx = hydratedCatCount.current % categories.length
    // If we've wrapped around all categories, still show the next one
    return categories[nextIdx] || null
  }, [categories, pool]) // pool dep to recalc when hydration happens

  const handlePeekActivate = useCallback(() => {
    const nextCatIdx = hydratedCatCount.current
    hydrateCategory(nextCatIdx)
    // Jump to the first card of the newly hydrated category after pool state settles
    setTimeout(() => {
      const currentPool = poolRef.current
      const wrappedIdx = nextCatIdx % categories.length
      for (let i = currentPool.length - 1; i >= 0; i--) {
        if (currentPool[i]._cat === wrappedIdx && !currentPool[i]._divider) {
          let first = i
          while (first > 0 && currentPool[first - 1]._cat === wrappedIdx && !currentPool[first - 1]._divider) {
            first--
          }
          setActiveIndex(first)
          break
        }
      }
    }, 50)
  }, [hydrateCategory, categories])

  // -------------------------------------------------------
  // Sync focused card ref for PosterInfoPanel
  // -------------------------------------------------------
  useEffect(() => {
    focusedCardRef.current = cardRefs.current[activeIndex] || null
  }, [activeIndex, pool])

  // -------------------------------------------------------
  // Render
  // -------------------------------------------------------
  if (!categories || categories.length === 0 || pool.length === 0) return null

  const focusedItem = pool[activeIndex]?._divider ? null : pool[activeIndex]

  return (
    <div
      role="region"
      aria-roledescription="carousel"
      aria-label="Poster shelf"
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <style>{ARROW_HOVER_CSS}</style>

      {/* Shelf label */}
      <div
        style={{
          padding: '20px 48px 8px',
          fontFamily: "'Space Grotesk', system-ui, sans-serif",
          fontSize: '11px',
          fontWeight: 600,
          letterSpacing: '1.5px',
          textTransform: 'uppercase',
          color: '#8a8a90',
          opacity: labelOpacity,
          transition: `opacity 250ms ${EASE_OUT}`,
          minHeight: '20px',
        }}
      >
        {shelfLabel}
      </div>

      {/* Track wrapper */}
      <div
        ref={trackWrapRef}
        style={{
          flex: 1,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {/* Track */}
        <div
          className="poster-shelf-track"
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'stretch',
            gap: `${GAP}px`,
            height: '100%',
            transform: trackTransform,
            transition: `transform 450ms ${EASE_SPRING}`,
            willChange: 'transform',
          }}
        >
          {pool.map((entry, i) => {
            const dist = Math.abs(i - activeIndex)
            const isVirtualized = dist > VIRTUALIZATION_WINDOW

            if (isVirtualized) {
              // Spacer with correct width
              const w = getCardWidth(entry, false)
              return (
                <div
                  key={entry.id || `spacer-${i}`}
                  style={{ width: `${w}px`, flexShrink: 0 }}
                />
              )
            }

            if (entry._divider) {
              return (
                <CategoryDivider
                  key={`divider-${entry._cat}-${i}`}
                  label={entry._catLabel}
                />
              )
            }

            const isFocused = i === activeIndex

            return (
              <PosterCard
                key={entry.id || `card-${i}`}
                ref={(el) => { cardRefs.current[i] = el }}
                item={entry}
                dist={dist}
                isFocused={isFocused}
                onClick={() => goToImmediate(i)}
                loading={dist <= 3 ? 'eager' : 'lazy'}
              />
            )
          })}
        </div>

        {/* Arrow buttons */}
        <button
          className="poster-arrow"
          aria-label="Previous card"
          onClick={() => goTo(findPrev(activeIndex))}
          style={{
            position: 'absolute',
            left: '12px',
            top: '50%',
            transform: 'translateY(-50%)',
            width: '52px',
            height: '52px',
            borderRadius: '16px',
            border: '1px solid var(--glass-border)',
            backgroundColor: 'var(--glass-bg-elevated)',
            boxShadow: 'var(--glass-shadow)',
            color: 'rgba(255,255,255,0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            zIndex: 15,
            opacity: 0,
            transition: `opacity 200ms ${EASE_OUT}, background-color 150ms ${EASE_OUT}`,
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        <button
          className="poster-arrow"
          aria-label="Next card"
          onClick={() => goTo(findNext(activeIndex))}
          style={{
            position: 'absolute',
            right: '12px',
            top: '50%',
            transform: 'translateY(-50%)',
            width: '52px',
            height: '52px',
            borderRadius: '16px',
            border: '1px solid var(--glass-border)',
            backgroundColor: 'var(--glass-bg-elevated)',
            boxShadow: 'var(--glass-shadow)',
            color: 'rgba(255,255,255,0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            zIndex: 15,
            opacity: 0,
            transition: `opacity 200ms ${EASE_OUT}, background-color 150ms ${EASE_OUT}`,
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>

        {/* Info panel */}
        <PosterInfoPanel
          item={focusedItem}
          cardRef={focusedCardRef}
          trackWrapRef={trackWrapRef}
        />
      </div>

      {/* Progress dots */}
      <ProgressDots
        realCardIndices={realCardIndices}
        activeIndex={activeIndex}
        onNavigate={goTo}
      />

      {/* Peek row */}
      <PosterPeekRow
        category={nextCategory}
        onActivate={handlePeekActivate}
      />

      {/* Keyboard hint */}
      <div
        style={{
          position: 'fixed',
          bottom: '16px',
          right: '20px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: '6px',
          opacity: 0.35,
          pointerEvents: 'none',
          zIndex: 5,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <KbdBox>←</KbdBox>
          <KbdBox>→</KbdBox>
          <span style={hintLabelStyle}>browse</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <KbdBox>Enter</KbdBox>
          <span style={hintLabelStyle}>play</span>
        </div>
      </div>
    </div>
  )
}

// -------------------------------------------------------
// Keyboard hint sub-components
// -------------------------------------------------------
const hintLabelStyle = {
  fontSize: '10px',
  color: '#8a8a90',
  fontFamily: "'Inter', system-ui, sans-serif",
}

function KbdBox({ children }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: '26px',
        height: '26px',
        borderRadius: '6px',
        border: '1px solid var(--glass-border)',
        backgroundColor: 'var(--glass-bg)',
        fontSize: '10px',
        fontWeight: 600,
        color: '#8a8a90',
        padding: '0 6px',
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      {children}
    </span>
  )
}
