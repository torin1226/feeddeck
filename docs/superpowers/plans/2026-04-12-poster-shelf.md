# Poster Shelf Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 3-TheatreRow homepage with a full-viewport poster carousel featuring focus expansion, card-anchored info panel, infinite category hydration, and windowed progress dots.

**Architecture:** PosterShelf is the main container that builds a flat `pool[]` from homeStore categories, manages `activeIndex`, and renders PosterCards with CSS-driven focus states via `--dist` variable. Info panel tracks the focused card via ref + getBoundingClientRect. DOM virtualization limits rendered cards to ±6 of active.

**Tech Stack:** React + Zustand (homeStore), Tailwind + CSS custom properties (glass tokens), vanilla JS for wheel/keyboard handlers.

**Spec:** `docs/superpowers/specs/2026-04-12-poster-shelf-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/stores/homeStore.js` | Modify | Add `orient` field to `mapVideo` and `makeItem` |
| `src/components/home/PosterCard.jsx` | Create | Individual card with focus expansion, badges, overlay |
| `src/components/home/CategoryDivider.jsx` | Create | Vertical pill between category sections |
| `src/components/home/ProgressDots.jsx` | Create | Windowed dot indicator |
| `src/components/home/PosterInfoPanel.jsx` | Create | Card-anchored glass metadata panel |
| `src/components/home/PosterPeekRow.jsx` | Create | Next-category preview thumbnails |
| `src/components/home/PosterShelf.jsx` | Create | Carousel engine — pool, navigation, hydration, layout |
| `src/components/Skeletons.jsx` | Modify | Add `SkeletonPosterShelf` |
| `src/pages/HomePage.jsx` | Modify | Swap BrowseSection for PosterShelf |

---

### Task 1: Add `orient` Field to homeStore

**Files:**
- Modify: `src/stores/homeStore.js:78-94` (makeItem) and `:169-184` (mapVideo)

- [ ] **Step 1: Add `orient` to `makeItem` (placeholder generator)**

In `src/stores/homeStore.js`, inside the `makeItem()` function (around line 93), add before the closing brace:

```js
orient: Math.random() > 0.6 ? 'v' : 'h',
```

- [ ] **Step 2: Add `orient` to `mapVideo` (API data mapper)**

In `src/stores/homeStore.js`, inside the `mapVideo()` function (around line 183), add before the closing brace:

```js
orient: (v.height && v.width && v.height > v.width) ? 'v' : 'h',
```

- [ ] **Step 3: Verify build still passes**

Run: `cd feeddeck && npm run build 2>&1 | tail -5`
Expected: `✓ built in` with no errors

- [ ] **Step 4: Commit**

```bash
git add src/stores/homeStore.js
git commit -m "feat(homeStore): add orient field for poster shelf card sizing"
```

---

### Task 2: PosterCard Component

**Files:**
- Create: `src/components/home/PosterCard.jsx`

- [ ] **Step 1: Create PosterCard.jsx**

```jsx
import { forwardRef, memo } from 'react'

const CARD_WIDTHS = {
  h: { default: 420, focused: 600 },
  v: { default: 320, focused: 420 },
}

const PosterCard = forwardRef(function PosterCard({ item, dist, isFocused, onClick, loading }, ref) {
  const orient = item.orient || 'h'
  const widths = CARD_WIDTHS[orient]
  const width = isFocused ? widths.focused : widths.default

  return (
    <div
      ref={ref}
      className="poster-card"
      style={{
        '--dist': dist,
        width: `${width}px`,
        flexShrink: 0,
        height: 'calc(100vh - 200px)',
        borderRadius: '20px',
        overflow: 'hidden',
        position: 'relative',
        cursor: 'pointer',
        background: 'var(--glass-bg)',
        borderTop: '1px solid var(--glass-highlight)',
        border: isFocused ? '2px solid var(--color-accent)' : '2px solid transparent',
        boxShadow: isFocused
          ? '0 0 0 1px var(--color-accent), 0 0 48px rgba(244,63,94,0.18), 0 20px 60px rgba(0,0,0,0.5)'
          : 'none',
        zIndex: isFocused ? 10 : 0,
        opacity: `clamp(0.15, calc(1 - ${dist} * 0.18), 1)`,
        filter: `brightness(clamp(0.4, calc(1 - ${dist} * 0.18), 1))`,
        transform: `scale(clamp(0.94, calc(1 - ${dist} * 0.015), 1))`,
        transition: 'width 0.45s var(--ease-spring), opacity 0.4s var(--ease-out), filter 0.4s var(--ease-out), transform 0.4s var(--ease-spring), border-color 0.3s ease, box-shadow 0.3s ease',
        willChange: 'width, transform',
      }}
      onClick={onClick}
    >
      <img
        src={item.thumbnail}
        alt={item.title}
        loading={loading}
        style={{
          height: '100%',
          width: '100%',
          objectFit: 'cover',
          objectPosition: 'center',
          display: 'block',
          transition: 'transform 0.4s var(--ease-out)',
        }}
      />

      {/* Duration badge — top right */}
      <span style={{
        position: 'absolute', top: 16, right: 16,
        fontSize: '12px', fontWeight: 600, color: 'white',
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)',
        padding: '4px 10px', borderRadius: '8px',
      }}>
        {item.duration}
      </span>

      {/* Orientation badge — top left, vertical only */}
      {orient === 'v' && (
        <span style={{
          position: 'absolute', top: 16, left: 16,
          fontSize: '10px', fontWeight: 700, letterSpacing: '0.5px',
          textTransform: 'uppercase', color: 'var(--color-text-primary)',
          background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)',
          padding: '4px 10px', borderRadius: '8px',
        }}>
          Short
        </span>
      )}

      {/* Overlay gradient — hidden when focused (info panel takes over) */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        padding: '24px',
        background: 'linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.55) 45%, transparent 100%)',
        opacity: isFocused ? 0 : 1,
        transition: 'opacity 0.3s var(--ease-out)',
      }}>
        <div style={{
          fontFamily: 'var(--font-display)',
          fontSize: isFocused ? '22px' : '16px',
          fontWeight: 600,
          color: 'white',
          whiteSpace: isFocused ? 'normal' : 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          lineHeight: isFocused ? 1.2 : 'normal',
          transition: 'font-size 0.4s var(--ease-spring)',
        }}>
          {item.title}
        </div>
        <div style={{
          fontSize: '12px', color: 'rgba(255,255,255,0.55)',
          marginTop: '6px', display: 'flex', gap: '8px',
        }}>
          <span>{item.uploader}</span>
          <span>&middot;</span>
          <span>{item.views}</span>
        </div>
      </div>
    </div>
  )
})

export default memo(PosterCard, (prev, next) => {
  return prev.dist === next.dist && prev.item === next.item && prev.isFocused === next.isFocused
})
```

- [ ] **Step 2: Verify build passes**

Run: `cd feeddeck && npm run build 2>&1 | tail -5`
Expected: `✓ built in` (PosterCard not imported yet, but should have no syntax errors)

- [ ] **Step 3: Commit**

```bash
git add src/components/home/PosterCard.jsx
git commit -m "feat: add PosterCard component with focus expansion and glass styling"
```

---

### Task 3: CategoryDivider Component

**Files:**
- Create: `src/components/home/CategoryDivider.jsx`

- [ ] **Step 1: Create CategoryDivider.jsx**

```jsx
export default function CategoryDivider({ label }) {
  return (
    <div style={{
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      writingMode: 'vertical-lr',
      textOrientation: 'mixed',
      transform: 'rotate(180deg)',
      fontFamily: 'var(--font-display)',
      fontSize: '10px',
      fontWeight: 700,
      letterSpacing: '2px',
      textTransform: 'uppercase',
      color: 'var(--color-text-muted)',
      opacity: 0.3,
      width: '32px',
      height: '100%',
      position: 'relative',
    }}>
      {label}
      <div style={{
        content: "''",
        position: 'absolute',
        top: '15%',
        bottom: '15%',
        left: '50%',
        width: '1px',
        background: 'linear-gradient(to bottom, transparent, var(--glass-border), transparent)',
        zIndex: -1,
      }} />
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/home/CategoryDivider.jsx
git commit -m "feat: add CategoryDivider component for poster shelf sections"
```

---

### Task 4: ProgressDots Component

**Files:**
- Create: `src/components/home/ProgressDots.jsx`

- [ ] **Step 1: Create ProgressDots.jsx**

```jsx
import { memo } from 'react'

function ProgressDots({ realCardIndices, activeIndex, onNavigate }) {
  // Find active card's position in the real-cards-only list
  const activeReal = realCardIndices.indexOf(activeIndex)
  if (activeReal === -1) return null

  // Windowed: show 7 before + active + 7 after
  const windowStart = Math.max(0, activeReal - 7)
  const windowEnd = Math.min(realCardIndices.length - 1, activeReal + 7)

  const dots = []
  for (let ri = windowStart; ri <= windowEnd; ri++) {
    const poolIdx = realCardIndices[ri]
    const isActive = ri === activeReal
    dots.push(
      <div
        key={poolIdx}
        onClick={() => onNavigate(poolIdx)}
        style={{
          width: isActive ? '24px' : '6px',
          height: '6px',
          borderRadius: isActive ? '3px' : '50%',
          background: isActive ? 'var(--color-accent)' : 'rgba(255,255,255,0.10)',
          transition: 'all 0.35s var(--ease-spring)',
          cursor: 'pointer',
        }}
        onMouseEnter={(e) => {
          if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.25)'
        }}
        onMouseLeave={(e) => {
          if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.10)'
        }}
      />
    )
  }

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      gap: '5px',
      padding: '16px 0 0',
    }}>
      {dots}
    </div>
  )
}

export default memo(ProgressDots)
```

- [ ] **Step 2: Commit**

```bash
git add src/components/home/ProgressDots.jsx
git commit -m "feat: add ProgressDots component with windowed display"
```

---

### Task 5: PosterInfoPanel Component

**Files:**
- Create: `src/components/home/PosterInfoPanel.jsx`

- [ ] **Step 1: Create PosterInfoPanel.jsx**

```jsx
import { useEffect, useState, useRef } from 'react'
import useHomeStore from '../../stores/homeStore'
import useQueueStore from '../../stores/queueStore'

export default function PosterInfoPanel({ item, cardRef, trackWrapRef }) {
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState({ left: 0, bottom: 0 })
  const panelRef = useRef(null)
  const { setHeroItem, setTheatreMode, markViewed } = useHomeStore()
  const { addToQueue } = useQueueStore()

  // Position panel relative to the focused card
  useEffect(() => {
    if (!item || !cardRef?.current || !trackWrapRef?.current) {
      setVisible(false)
      return
    }

    const updatePosition = () => {
      const cardRect = cardRef.current.getBoundingClientRect()
      const wrapRect = trackWrapRef.current.getBoundingClientRect()
      setPos({
        left: cardRect.left - wrapRect.left + cardRect.width / 2,
        bottom: wrapRect.bottom - cardRect.bottom + 24,
      })
    }

    // Small delay for the card width transition to settle
    const timer = setTimeout(() => {
      updatePosition()
      setVisible(true)
    }, 100)

    // Reposition on resize
    const ro = new ResizeObserver(updatePosition)
    ro.observe(trackWrapRef.current)

    return () => {
      clearTimeout(timer)
      ro.disconnect()
      setVisible(false)
    }
  }, [item, cardRef, trackWrapRef])

  if (!item) return null

  const handlePlay = () => {
    setHeroItem(item)
    setTheatreMode(true)
    markViewed(item.id)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleQueue = () => addToQueue(item)

  // Staggered entrance delays
  const stagger = (delay) => ({
    opacity: visible ? 1 : 0,
    transform: visible ? 'translateY(0)' : 'translateY(8px)',
    transition: `opacity 0.3s var(--ease-out) ${delay}ms, transform 0.3s var(--ease-out) ${delay}ms`,
  })

  return (
    <div
      ref={panelRef}
      style={{
        position: 'absolute',
        left: `${pos.left}px`,
        bottom: `${pos.bottom}px`,
        transform: `translateX(-50%) translateY(${visible ? '-24px' : '20px'})`,
        opacity: visible ? 1 : 0,
        transition: 'transform 0.35s var(--ease-out), opacity 0.35s var(--ease-out)',
        maxWidth: '420px',
        width: '100%',
        background: 'linear-gradient(135deg, rgba(255,255,255,0.02) 0%, transparent 50%, rgba(244,63,94,0.015) 100%), rgba(10,10,12,0.50)',
        backdropFilter: 'blur(24px)',
        border: '1px solid var(--glass-border)',
        borderTop: '1px solid var(--glass-highlight)',
        borderRadius: '16px',
        padding: '24px 28px',
        pointerEvents: visible ? 'auto' : 'none',
        zIndex: 20,
      }}
    >
      {/* Tags */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', ...stagger(0) }}>
        {[item.genre, item.duration].filter(Boolean).map((tag, i) => (
          <span key={i} style={{
            fontSize: '10px', fontWeight: 500, color: 'var(--color-text-muted)',
            padding: '2px 9px', borderRadius: '999px',
            background: 'rgba(255,255,255,0.06)',
          }}>
            {tag}
          </span>
        ))}
      </div>

      {/* Title */}
      <h2 style={{
        fontFamily: 'var(--font-display)',
        fontSize: 'clamp(20px, 2.2vw, 30px)',
        fontWeight: 700, letterSpacing: '-0.8px', lineHeight: 1.12,
        marginBottom: '8px',
        ...stagger(60),
      }}>
        {item.title}
      </h2>

      {/* Meta */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        fontSize: '11.5px', color: 'var(--color-text-secondary)', marginBottom: '5px',
        ...stagger(120),
      }}>
        {item.rating && (
          <>
            <span style={{ color: 'var(--color-accent)', fontWeight: 600 }}>&#9733; {item.rating}/10</span>
            <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--color-text-muted)' }} />
          </>
        )}
        <span>{item.views} views</span>
        <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--color-text-muted)' }} />
        <span>{item.uploader}</span>
      </div>

      {/* Description */}
      <p style={{
        fontSize: '12px', lineHeight: 1.5, color: 'var(--color-text-secondary)',
        marginBottom: '16px',
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        ...stagger(180),
      }}>
        {item.desc}
      </p>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '8px', ...stagger(240) }}>
        <button
          onClick={handlePlay}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '8px 18px', borderRadius: '10px', border: 'none',
            fontFamily: 'var(--font-body)', fontSize: '12.5px', fontWeight: 600,
            background: 'var(--color-accent)', color: 'white', cursor: 'pointer',
            boxShadow: '0 0 20px rgba(244,63,94,0.3)',
            transition: 'all 0.2s var(--ease-out)',
          }}
        >
          &#9654; Play
        </button>
        <button
          onClick={handleQueue}
          style={{
            display: 'flex', alignItems: 'center', gap: '5px',
            padding: '8px 14px', borderRadius: '10px',
            fontFamily: 'var(--font-body)', fontSize: '12.5px', fontWeight: 500,
            background: 'var(--glass-bg)', border: '1px solid var(--glass-border)',
            color: 'var(--color-text-primary)', cursor: 'pointer',
            transition: 'all 0.2s var(--ease-out)',
          }}
        >
          + Queue
        </button>
        <button
          onClick={() => {
            fetch(`/api/library/favorite?id=${item.id}`, { method: 'POST' })
          }}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '8px 14px', borderRadius: '10px',
            background: 'var(--glass-bg)', border: '1px solid var(--glass-border)',
            color: 'var(--color-text-primary)', cursor: 'pointer',
            transition: 'all 0.2s var(--ease-out)',
          }}
          aria-label="Favorite"
        >
          &#9825;
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/home/PosterInfoPanel.jsx
git commit -m "feat: add PosterInfoPanel with card-anchored positioning and staggered entrance"
```

---

### Task 6: PosterPeekRow Component

**Files:**
- Create: `src/components/home/PosterPeekRow.jsx`

- [ ] **Step 1: Create PosterPeekRow.jsx**

```jsx
import { memo } from 'react'

function PosterPeekRow({ category, onActivate }) {
  if (!category) return null

  return (
    <div style={{ padding: '16px 48px 20px' }}>
      <div style={{
        fontFamily: 'var(--font-display)',
        fontSize: '10px', fontWeight: 600,
        letterSpacing: '1.5px', textTransform: 'uppercase',
        color: 'var(--color-text-muted)', opacity: 0.45,
        marginBottom: '10px',
      }}>
        {category.label || category.originalLabel}
      </div>
      <div
        style={{
          display: 'flex', gap: '12px', overflow: 'hidden',
          height: '72px',
          maskImage: 'linear-gradient(to right, black 65%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to right, black 65%, transparent 100%)',
        }}
      >
        {category.items.slice(0, 8).map((item, i) => (
          <div
            key={item.id || i}
            onClick={onActivate}
            style={{
              flexShrink: 0,
              height: '72px',
              width: (item.orient || 'h') === 'v' ? '48px' : '96px',
              borderRadius: '10px',
              overflow: 'hidden',
              opacity: 0.3,
              cursor: 'pointer',
              transition: 'opacity 0.2s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.6' }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.3' }}
          >
            <img
              src={item.thumbnail || item.thumbnailSm}
              alt={item.title}
              loading="lazy"
              style={{ height: '100%', width: '100%', objectFit: 'cover' }}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

export default memo(PosterPeekRow)
```

- [ ] **Step 2: Commit**

```bash
git add src/components/home/PosterPeekRow.jsx
git commit -m "feat: add PosterPeekRow component for next-category preview"
```

---

### Task 7: PosterShelf — Carousel Engine

**Files:**
- Create: `src/components/home/PosterShelf.jsx`

This is the largest component. It owns the pool, navigation, hydration, and renders all sub-components.

- [ ] **Step 1: Create PosterShelf.jsx**

```jsx
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import useHomeStore from '../../stores/homeStore'
import PosterCard from './PosterCard'
import PosterInfoPanel from './PosterInfoPanel'
import PosterPeekRow from './PosterPeekRow'
import ProgressDots from './ProgressDots'
import CategoryDivider from './CategoryDivider'

const GAP = 20
const CARD_WIDTHS = {
  h: { default: 420, focused: 600 },
  v: { default: 320, focused: 420 },
  divider: 32,
}
const VIRTUALIZATION_WINDOW = 6
const WHEEL_THRESHOLD = 65

function getCardWidth(poolItem, isFocused) {
  if (poolItem._divider) return CARD_WIDTHS.divider
  const orient = poolItem.orient || 'h'
  return isFocused ? CARD_WIDTHS[orient].focused : CARD_WIDTHS[orient].default
}

export default function PosterShelf() {
  const categories = useHomeStore((s) => s.categories)
  const [pool, setPool] = useState([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [shelfLabel, setShelfLabel] = useState('')
  const [labelSwitching, setLabelSwitching] = useState(false)
  const trackRef = useRef(null)
  const trackWrapRef = useRef(null)
  const cardRefs = useRef({})
  const debounceRef = useRef(false)
  const wheelAccumRef = useRef(0)
  const wheelCooldownRef = useRef(false)
  const nextCatRef = useRef(0)
  const loadedCatsRef = useRef(new Set())
  const currentLabelRef = useRef('')

  // --- Pool hydration ---
  const hydrateCategory = useCallback((catIndex) => {
    if (categories.length === 0) return
    const realIndex = catIndex % categories.length
    // Allow re-hydration after first pass through all categories
    if (loadedCatsRef.current.has(realIndex) && loadedCatsRef.current.size < categories.length) return

    const cat = categories[realIndex]
    setPool((prev) => {
      const newEntries = []
      // Add divider if not the first category
      if (prev.length > 0) {
        newEntries.push({ _divider: true, _catLabel: cat.label || cat.originalLabel, _cat: realIndex })
      }
      cat.items.forEach((item) => {
        newEntries.push({ ...item, _cat: realIndex, _catLabel: cat.label || cat.originalLabel })
      })
      return [...prev, ...newEntries]
    })

    loadedCatsRef.current.add(realIndex)
    nextCatRef.current = catIndex + 1
  }, [categories])

  // Initial hydration: first 2 categories
  useEffect(() => {
    if (categories.length === 0) return
    setPool([])
    loadedCatsRef.current.clear()
    nextCatRef.current = 0
    hydrateCategory(0)
    hydrateCategory(1)
    setActiveIndex(0)
  }, [categories, hydrateCategory])

  // --- Navigation helpers ---
  const findNextReal = useCallback((from, dir) => {
    let i = from + dir
    while (i >= 0 && i < pool.length && pool[i]._divider) i += dir
    return i >= 0 && i < pool.length ? i : from
  }, [pool])

  const goTo = useCallback((index) => {
    if (debounceRef.current) return
    if (index < 0 || index >= pool.length) return
    // Skip dividers
    if (pool[index]._divider) {
      const dir = index > activeIndex ? 1 : -1
      index += dir
      if (index < 0 || index >= pool.length || pool[index]._divider) return
    }

    // Hydration check: if near the end, load more
    if (index >= pool.length - 3) {
      hydrateCategory(nextCatRef.current)
    }

    debounceRef.current = true
    setTimeout(() => { debounceRef.current = false }, 280)

    setActiveIndex(index)

    // Update shelf label if category changed
    const newLabel = pool[index]._catLabel
    if (newLabel && newLabel !== currentLabelRef.current) {
      currentLabelRef.current = newLabel
      setLabelSwitching(true)
      setTimeout(() => {
        setShelfLabel(newLabel)
        setLabelSwitching(false)
      }, 250)
    }
  }, [pool, activeIndex, hydrateCategory])

  // Set initial label
  useEffect(() => {
    if (pool.length > 0 && pool[0]._catLabel) {
      setShelfLabel(pool[0]._catLabel)
      currentLabelRef.current = pool[0]._catLabel
    }
  }, [pool])

  // --- Keyboard navigation ---
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); goTo(findNextReal(activeIndex, 1)) }
      if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(findNextReal(activeIndex, -1)) }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [goTo, findNextReal, activeIndex])

  // --- Wheel navigation ---
  useEffect(() => {
    const wrap = trackWrapRef.current
    if (!wrap) return

    const handleWheel = (e) => {
      // Only capture horizontal-dominant gestures; let vertical scroll pass through
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX) * 2 && Math.abs(e.deltaX) < 10) return
      e.preventDefault()
      if (wheelCooldownRef.current) return

      const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX
      wheelAccumRef.current += delta

      if (Math.abs(wheelAccumRef.current) >= WHEEL_THRESHOLD) {
        const dir = wheelAccumRef.current > 0 ? 1 : -1
        wheelAccumRef.current = 0
        wheelCooldownRef.current = true
        setTimeout(() => { wheelCooldownRef.current = false }, 350)
        goTo(findNextReal(activeIndex, dir))
      }
    }

    wrap.addEventListener('wheel', handleWheel, { passive: false })
    return () => wrap.removeEventListener('wheel', handleWheel)
  }, [goTo, findNextReal, activeIndex])

  // Decay accumulated scroll
  useEffect(() => {
    const interval = setInterval(() => {
      wheelAccumRef.current *= 0.85
      if (Math.abs(wheelAccumRef.current) < 2) wheelAccumRef.current = 0
    }, 100)
    return () => clearInterval(interval)
  }, [])

  // --- Track transform ---
  const translateX = useMemo(() => {
    if (pool.length === 0) return 0
    let offset = 0
    for (let i = 0; i < activeIndex; i++) {
      offset += getCardWidth(pool[i], i === activeIndex) + GAP
    }
    const activeW = getCardWidth(pool[activeIndex], true)
    const viewW = trackWrapRef.current?.clientWidth || window.innerWidth
    return -(offset - (viewW / 2 - activeW / 2))
  }, [pool, activeIndex])

  // --- Real card indices (for dots) ---
  const realCardIndices = useMemo(() => {
    return pool.reduce((arr, p, i) => { if (!p._divider) arr.push(i); return arr }, [])
  }, [pool])

  // --- Next category for peek row ---
  const nextCategory = useMemo(() => {
    if (categories.length === 0) return null
    return categories[nextCatRef.current % categories.length]
  }, [categories, pool]) // pool dependency triggers re-eval when hydration changes nextCatRef

  // --- Virtualization window ---
  const renderWindow = useMemo(() => {
    const start = Math.max(0, activeIndex - VIRTUALIZATION_WINDOW)
    const end = Math.min(pool.length - 1, activeIndex + VIRTUALIZATION_WINDOW)
    return { start, end }
  }, [activeIndex, pool.length])

  // --- Ref setter for cards ---
  const setCardRef = useCallback((index, el) => {
    cardRefs.current[index] = el
  }, [])

  const focusedItem = pool[activeIndex] && !pool[activeIndex]._divider ? pool[activeIndex] : null

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', overflow: 'hidden', position: 'relative' }}
      role="region" aria-roledescription="carousel"
    >
      {/* Shelf label */}
      <div style={{
        fontFamily: 'var(--font-display)',
        fontSize: '11px', fontWeight: 600,
        letterSpacing: '1.5px', textTransform: 'uppercase',
        color: 'var(--color-text-muted)',
        padding: '0 48px', marginBottom: '20px',
        opacity: labelSwitching ? 0 : 1,
        transition: 'opacity 0.25s var(--ease-out)',
      }}>
        {shelfLabel}
      </div>

      {/* Track wrapper */}
      <div ref={trackWrapRef} style={{
        position: 'relative',
        height: 'calc(100vh - 200px)',
        overflow: 'visible',
      }}>
        {/* Arrow buttons */}
        <button
          onClick={() => goTo(findNextReal(activeIndex, -1))}
          aria-label="Previous"
          className="poster-arrow poster-arrow-left"
          style={{
            position: 'absolute', top: '50%', transform: 'translateY(-50%)',
            left: '12px', zIndex: 30,
            width: '52px', height: '52px', borderRadius: '16px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--glass-bg-elevated)', backdropFilter: 'blur(24px)',
            border: '1px solid var(--glass-border-hover)',
            boxShadow: 'var(--glass-shadow)',
            color: 'var(--color-text-primary)', cursor: 'pointer',
            opacity: 0, transition: 'all 0.2s var(--ease-out)',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
        </button>

        {/* Track */}
        <div ref={trackRef} style={{
          display: 'flex', alignItems: 'center', gap: `${GAP}px`,
          height: '100%', padding: 0,
          transform: `translateX(${translateX}px)`,
          transition: 'transform 0.45s var(--ease-spring)',
          willChange: 'transform',
        }}>
          {pool.map((entry, i) => {
            // Spacer for virtualized-out items
            if (i < renderWindow.start || i > renderWindow.end) {
              const w = getCardWidth(entry, i === activeIndex)
              return <div key={i} style={{ width: `${w}px`, flexShrink: 0, height: '100%' }} />
            }

            if (entry._divider) {
              return <CategoryDivider key={`div-${i}`} label={entry._catLabel} />
            }

            const dist = Math.abs(i - activeIndex)
            const isFocused = i === activeIndex
            const imgLoading = dist <= 3 ? 'eager' : 'lazy'

            return (
              <PosterCard
                key={entry.id || i}
                ref={(el) => setCardRef(i, el)}
                item={entry}
                dist={dist}
                isFocused={isFocused}
                onClick={() => goTo(i)}
                loading={imgLoading}
              />
            )
          })}
        </div>

        {/* Arrow right */}
        <button
          onClick={() => goTo(findNextReal(activeIndex, 1))}
          aria-label="Next"
          className="poster-arrow poster-arrow-right"
          style={{
            position: 'absolute', top: '50%', transform: 'translateY(-50%)',
            right: '12px', zIndex: 30,
            width: '52px', height: '52px', borderRadius: '16px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--glass-bg-elevated)', backdropFilter: 'blur(24px)',
            border: '1px solid var(--glass-border-hover)',
            boxShadow: 'var(--glass-shadow)',
            color: 'var(--color-text-primary)', cursor: 'pointer',
            opacity: 0, transition: 'all 0.2s var(--ease-out)',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
        </button>

        {/* Info panel */}
        <PosterInfoPanel
          item={focusedItem}
          cardRef={{ current: cardRefs.current[activeIndex] }}
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
        onActivate={() => {
          hydrateCategory(nextCatRef.current)
          const target = pool.length // first item of newly hydrated category (after divider)
          setTimeout(() => goTo(target + 1), 50)
        }}
      />

      {/* Keyboard hint */}
      <div style={{
        position: 'absolute', bottom: '16px', right: '48px',
        display: 'flex', alignItems: 'center', gap: '10px',
        fontSize: '10px', color: 'var(--color-text-muted)', opacity: 0.35,
      }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: '26px', height: '26px', borderRadius: '6px',
          background: 'var(--glass-bg)', border: '1px solid var(--glass-border)',
          fontSize: '12px', color: 'var(--color-text-secondary)',
        }}>&larr;</span>
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: '26px', height: '26px', borderRadius: '6px',
          background: 'var(--glass-bg)', border: '1px solid var(--glass-border)',
          fontSize: '12px', color: 'var(--color-text-secondary)',
        }}>&rarr;</span>
        browse
        <span style={{ marginLeft: '8px', fontSize: '10px' }}>Enter</span>
        <span> play</span>
      </div>

      {/* CSS for arrow hover (track wrapper hover shows arrows) */}
      <style>{`
        .poster-arrow { pointer-events: auto; }
        div:has(> .poster-arrow):hover .poster-arrow { opacity: 1 !important; }
        .poster-arrow:hover { background: rgba(255,255,255,0.12) !important; transform: translateY(-50%) scale(1.06) !important; }
        .poster-arrow:active { transform: translateY(-50%) scale(0.94) !important; }
        @media (prefers-reduced-motion: reduce) {
          .poster-card, .poster-card img, .poster-arrow, [style*="transition"] {
            transition-duration: 0.01ms !important;
            animation-duration: 0.01ms !important;
          }
        }
      `}</style>
    </div>
  )
}
```

- [ ] **Step 2: Verify build passes**

Run: `cd feeddeck && npm run build 2>&1 | tail -5`
Expected: `✓ built in` (PosterShelf not imported into app yet)

- [ ] **Step 3: Commit**

```bash
git add src/components/home/PosterShelf.jsx
git commit -m "feat: add PosterShelf carousel engine with pool hydration, virtualization, and navigation"
```

---

### Task 8: SkeletonPosterShelf Loading State

**Files:**
- Modify: `src/components/Skeletons.jsx`

- [ ] **Step 1: Add SkeletonPosterShelf to Skeletons.jsx**

Add after the existing `SkeletonHero` export:

```jsx
export function SkeletonPosterShelf() {
  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      overflow: 'hidden',
      padding: '0 48px',
    }}>
      {/* Shelf label skeleton */}
      <div className="w-24 h-3 rounded bg-surface-raised animate-shimmer mb-5" />
      {/* Cards skeleton */}
      <div style={{
        display: 'flex',
        gap: '20px',
        alignItems: 'center',
        justifyContent: 'center',
        height: 'calc(100vh - 200px)',
      }}>
        <div className="rounded-card-lg bg-surface-raised animate-shimmer" style={{ width: '320px', height: '100%', flexShrink: 0, opacity: 0.4 }} />
        <div className="rounded-card-lg bg-surface-raised animate-shimmer" style={{ width: '420px', height: '100%', flexShrink: 0, opacity: 0.6 }} />
        <div className="rounded-card-lg bg-surface-raised animate-shimmer" style={{ width: '600px', height: '100%', flexShrink: 0, opacity: 1 }} />
        <div className="rounded-card-lg bg-surface-raised animate-shimmer" style={{ width: '420px', height: '100%', flexShrink: 0, opacity: 0.6 }} />
        <div className="rounded-card-lg bg-surface-raised animate-shimmer" style={{ width: '320px', height: '100%', flexShrink: 0, opacity: 0.4 }} />
      </div>
      {/* Dots skeleton */}
      <div className="flex justify-center gap-1.5 pt-4">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className={`rounded-full bg-surface-raised animate-shimmer ${i === 3 ? 'w-6 h-1.5' : 'w-1.5 h-1.5'}`} />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Skeletons.jsx
git commit -m "feat: add SkeletonPosterShelf loading state"
```

---

### Task 9: Wire PosterShelf into HomePage

**Files:**
- Modify: `src/pages/HomePage.jsx`

- [ ] **Step 1: Update HomePage imports**

In `src/pages/HomePage.jsx`, replace the BrowseSection import:

```js
// Remove this line:
import BrowseSection from '../components/home/BrowseSection'

// Add these:
import PosterShelf from '../components/home/PosterShelf'
import { SkeletonPosterShelf } from '../components/Skeletons'
```

Note: Also add `SkeletonPosterShelf` to the existing Skeletons import if `SkeletonHero` and `SkeletonCategoryRow` are already imported from there.

- [ ] **Step 2: Replace BrowseSection render with PosterShelf**

In the JSX return, replace:

```jsx
{!theatreMode && (
  <div className="relative z-content">
    <BrowseSection />
  </div>
)}
```

With:

```jsx
{!theatreMode && (
  <div className="relative z-content">
    <PosterShelf />
  </div>
)}
```

- [ ] **Step 3: Update loading skeleton**

Replace:

```jsx
<SkeletonHero />
<SkeletonCategoryRow />
```

With:

```jsx
<SkeletonHero />
<SkeletonPosterShelf />
```

- [ ] **Step 4: Verify build passes**

Run: `cd feeddeck && npm run build 2>&1 | tail -5`
Expected: `✓ built in` with no errors

- [ ] **Step 5: Verify lint passes**

Run: `cd feeddeck && npx eslint src/pages/HomePage.jsx src/components/home/PosterShelf.jsx --quiet`
Expected: No output (clean)

- [ ] **Step 6: Commit**

```bash
git add src/pages/HomePage.jsx
git commit -m "feat: wire PosterShelf into HomePage, replacing BrowseSection"
```

---

### Task 10: Visual Verification & Polish

**Files:**
- May modify: any of the above files for tweaks

- [ ] **Step 1: Start dev server**

Run: `cd feeddeck && npm run dev`

- [ ] **Step 2: Open homepage in browser and verify**

Check:
- Poster cards render at correct sizes (tall, viewport-filling)
- Focused card has accent border + glow
- Neighbors are dimmed progressively
- Arrow keys navigate between cards
- Scroll wheel advances one card at a time
- Info panel appears anchored to focused card
- Progress dots show windowed subset
- Shelf label cross-fades on category change
- Peek row shows next category thumbnails
- Clicking peek row hydrates and jumps

- [ ] **Step 3: Fix any visual issues found**

Address layout problems, timing mismatches, or z-index conflicts discovered during verification.

- [ ] **Step 4: Verify arrow buttons appear on hover**

The CSS `:has()` selector for showing arrows on track hover may need adjustment. If it doesn't work, fall back to a `mouseEnter`/`mouseLeave` state on the track wrapper.

- [ ] **Step 5: Test loading state**

Temporarily delay the `fetchHomepage` call or disconnect the server to verify `SkeletonPosterShelf` renders correctly.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "fix: poster shelf visual polish from manual verification"
```
