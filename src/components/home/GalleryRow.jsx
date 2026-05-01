import { useRef, useEffect, useCallback, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import useHomeStore from '../../stores/homeStore'
import PosterCard from './PosterCard'
import CategoryDivider from './CategoryDivider'

// ============================================================
// GalleryRow
// Unified horizontal gallery row. Snap-scroll + parallax +
// focus-scale. Operates on a flat "pool" — items can include
// divider markers ({ _isDivider: true, label }) which act as
// visual breaks between categories. Dividers are skipped during
// keyboard / arrow navigation and excluded from the dots row.
// ============================================================

const GAP = 10
const PARALLAX_FACTOR = 0.1
const ASPECT_RATIO = { h: 16 / 9, v: 9 / 16 }
const APPROACH_END_THRESHOLD = 3 // load next category when ≤3 cards from end
const DOT_WINDOW = 15 // windowed dots — show ~this many centered on active

// Arrow button hover CSS
const ARROW_HOVER_CSS = `
.gallery-row-arrows { pointer-events: auto; }
div:has(> .gallery-row-arrows):hover .gallery-row-arrows { opacity: 1 !important; }
.gallery-row-arrows:hover { background: rgba(255,255,255,0.12) !important; }
.gallery-header-fade {
  transition: opacity 250ms var(--ease-out, cubic-bezier(0.4,0,0.2,1));
}
`

function getCardHeight(variant) {
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  if (variant === 'landscape') return Math.min(vh * 0.5, 360)
  return vh * 0.5 // portrait/poster rows stay at 50vh
}

function getCardWidth(item, variant) {
  const baseH = getCardHeight(variant)
  const ar = (item?.width && item?.height)
    ? (item.width / item.height)
    : (ASPECT_RATIO[item?.orient || 'h'] ?? ASPECT_RATIO.h)
  return baseH * ar
}

export default function GalleryRow({
  items,
  label,
  showProgress,
  isLast,
  onReachEnd,
  onApproachEnd,
  jumpRef,
  variant = 'poster',
  surfaceKey,
  surface,
}) {
  const { setFocusedItem } = useHomeStore()
  const navigate = useNavigate()
  const scrollRef = useRef(null)
  const cardsRef = useRef([])
  const rafRef = useRef(null)
  const endFired = useRef(false)
  const approachFired = useRef(new Set()) // pool length values for which we already fired
  const [activeIndex, setActiveIndex] = useState(0)
  const activeIndexRef = useRef(0)
  // True once the user has interacted with this row (scrolled, clicked, or
  // focused a card). Until then we suppress focus broadcasts so multiple
  // rows on the page don't fight for `focusedItem` on initial mount —
  // hero claims focus by default.
  const interactedRef = useRef(false)
  // Tracks the input kind for the next focus broadcast triggered by the
  // activeIndex effect. Keyboard arrow nav sets this to 'keyboard'; mouse
  // hover and scroll-based focus changes leave it as the default 'mouse'.
  // Reset to 'mouse' after each consumption so a stray scroll later doesn't
  // accidentally claim 'keyboard' latency.
  const pendingInputKindRef = useRef('mouse')
  // Keep refs in sync with activeIndex
  useEffect(() => {
    activeIndexRef.current = activeIndex
  }, [activeIndex])

  // Build a list of adjacent (next + prev) {id, url} pairs around the
  // given index, skipping dividers and items lacking a URL. Used to
  // hint useFocusPreview to eager-prefetch the user's likely next step.
  const buildAdjacentItems = useCallback((centerIdx) => {
    if (!items || items.length === 0) return []
    const out = []
    for (const dir of [-1, 1]) {
      let scan = centerIdx + dir
      let collected = 0
      while (scan >= 0 && scan < items.length && collected < 1) {
        const it = items[scan]
        if (!it?._isDivider && it?.url && it?.id) {
          out.push({ id: it.id, url: it.url })
          collected++
        }
        scan += dir
      }
    }
    return out
  }, [items])

  // Broadcast focus to homeStore when activeIndex changes after user
  // interaction. The rowSurface name is stable across renders so the
  // store's setFocusedItem dedupe (item.id + surface) prevents redundant
  // writes during a steady scroll.
  const rowSurface = surface || (surfaceKey ? `browse-row:${surfaceKey}` : `browse-row:${label || 'row'}`)
  useEffect(() => {
    if (!interactedRef.current) return
    const item = items?.[activeIndex]
    if (!item || item._isDivider) return
    const inputKind = pendingInputKindRef.current
    setFocusedItem(item, rowSurface, {
      inputKind,
      adjacentItems: buildAdjacentItems(activeIndex),
    })
    // Reset for the next change so a stray scroll doesn't inherit the
    // keyboard-fast-path latency.
    pendingInputKindRef.current = 'mouse'
  }, [activeIndex, items, rowSurface, setFocusedItem, buildAdjacentItems])

  // Derived: card-only indices (skipping dividers) and the active card's
  // ordinal among cards. Used for dots + approach-end logic.
  const cardOrdinals = useMemo(() => {
    const map = new Map() // pool index -> card ordinal
    let n = 0
    items.forEach((it, i) => {
      if (!it?._isDivider) {
        map.set(i, n)
        n++
      }
    })
    return { map, total: n }
  }, [items])

  const activeCardOrdinal = cardOrdinals.map.get(activeIndex) ?? 0

  // The active item's category label drives the dynamic header.
  const activeCatLabel = items[activeIndex]?._catLabel || label

  // RAF-batched parallax + focus detection on scroll.
  // Skip dividers when finding the closest-to-center card.
  const updateParallax = useCallback(() => {
    const container = scrollRef.current
    if (!container) return

    const containerRect = container.getBoundingClientRect()
    const centerX = containerRect.left + containerRect.width / 2

    let closestIdx = 0
    let closestDist = Infinity

    cardsRef.current.forEach((card, i) => {
      if (!card) return
      const cardRect = card.getBoundingClientRect()
      const cardCenterX = cardRect.left + cardRect.width / 2
      const offsetFromCenter = cardCenterX - centerX
      const absDist = Math.abs(offsetFromCenter)

      // Track closest to center, but only among non-divider items.
      const it = items[i]
      if (!it?._isDivider && absDist < closestDist) {
        closestDist = absDist
        closestIdx = i
      }

      // Parallax: image shifts opposite to card's offset from center
      // (skip dividers — they have no parallax img)
      if (!it?._isDivider) {
        const img = card.querySelector('[data-parallax-img]')
        if (img) {
          const shift = -offsetFromCenter * PARALLAX_FACTOR
          img.style.transform = `translateX(${shift}px) scale(1.1)`
        }
      }
    })

    setActiveIndex(closestIdx)

    // End-of-row detection for feed transition (legacy onReachEnd)
    if (isLast && !endFired.current && onReachEnd) {
      const atEnd = container.scrollLeft + container.clientWidth >= container.scrollWidth - 30
      if (atEnd) { endFired.current = true; onReachEnd() }
    }

    // Approach-end detection — fire onApproachEnd when active card is
    // within APPROACH_END_THRESHOLD of the end. Use cardsRemaining keyed
    // on current pool length so we don't refire for the same pool.
    if (onApproachEnd) {
      const total = cardOrdinals.total
      const ord = cardOrdinals.map.get(closestIdx)
      if (ord != null && total - 1 - ord <= APPROACH_END_THRESHOLD) {
        // Key by current pool length so each new hydration round can fire once
        const key = items.length
        if (!approachFired.current.has(key)) {
          approachFired.current.add(key)
          onApproachEnd()
        }
      }
    }
  }, [isLast, onReachEnd, onApproachEnd, items, cardOrdinals])

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return

    const onScroll = () => {
      interactedRef.current = true
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(updateParallax)
    }

    container.addEventListener('scroll', onScroll, { passive: true })
    const ro = new ResizeObserver(onScroll)
    ro.observe(container)
    requestAnimationFrame(updateParallax)

    return () => {
      container.removeEventListener('scroll', onScroll)
      ro.disconnect()
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [updateParallax, items])

  const handleCardClick = useCallback((index) => {
    const item = items?.[index]
    if (!item || item._isDivider) return
    interactedRef.current = true
    setFocusedItem(item, rowSurface, {
      inputKind: 'mouse',
      adjacentItems: buildAdjacentItems(index),
    })
    if (index === activeIndexRef.current) {
      // Navigate to watch page
      navigate(`/watch/${item.id}`)
    } else {
      // Scroll the clicked card to center
      const card = cardsRef.current[index]
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
      }
    }
  }, [items, navigate, setFocusedItem, rowSurface, buildAdjacentItems])

  // Scroll by one card width — skips dividers so arrow nav advances to
  // the next non-divider neighbor.
  const scrollByCard = useCallback((direction) => {
    const container = scrollRef.current
    if (!container) return
    const currentIdx = activeIndexRef.current
    let targetIdx = currentIdx + direction
    while (
      targetIdx >= 0 &&
      targetIdx < items.length &&
      items[targetIdx]?._isDivider
    ) {
      targetIdx += direction
    }
    if (targetIdx < 0 || targetIdx >= items.length) {
      // Fallback: simple scroll-by-width if at boundary
      const cardWidth = getCardWidth(items?.[currentIdx], variant)
      container.scrollBy({ left: direction * (cardWidth + GAP), behavior: 'smooth' })
      return
    }
    const card = cardsRef.current[targetIdx]
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
    }
  }, [items, variant])

  // Imperative jump-to-id handle for parent-driven navigation
  // (peek-row hydrates a category and jumps to its first item).
  useEffect(() => {
    if (!jumpRef) return
    jumpRef.current = (id) => {
      const idx = items.findIndex((it) => it?.id === id)
      if (idx === -1) return false
      const card = cardsRef.current[idx]
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
        return true
      }
      return false
    }
    return () => {
      if (jumpRef) jumpRef.current = null
    }
  }, [items, jumpRef])

  // Compute distance from center for each card based on activeIndex
  const getCardDist = useCallback(
    (index) => Math.abs(index - activeIndex),
    [activeIndex]
  )

  const handleRowKeyDown = useCallback((e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      // Flag the next activeIndex broadcast as keyboard-driven so
      // useFocusPreview uses the 150ms keyboard window instead of
      // the 200ms mouse window. The flag is consumed and reset
      // inside the broadcast effect.
      pendingInputKindRef.current = 'keyboard'
      interactedRef.current = true
      scrollByCard(e.key === 'ArrowLeft' ? -1 : 1)
    }
  }, [scrollByCard])

  // Windowed dots — show DOT_WINDOW dots centered on active card.
  // Dot list is over CARDS only (dividers excluded). Far dots fade.
  const dotConfig = useMemo(() => {
    const total = cardOrdinals.total
    if (total === 0) return { start: 0, end: 0, total: 0 }
    const half = Math.floor(DOT_WINDOW / 2)
    let start = activeCardOrdinal - half
    let end = activeCardOrdinal + half
    if (start < 0) { end -= start; start = 0 }
    if (end >= total) { start -= (end - (total - 1)); end = total - 1 }
    if (start < 0) start = 0
    return { start, end, total }
  }, [activeCardOrdinal, cardOrdinals.total])

  if (!items?.length) return null

  return (
    <div
      className="mb-2 group/gallery relative"
      tabIndex={0}
      onKeyDown={handleRowKeyDown}
      style={{ outline: 'none' }}
    >
      <style>{ARROW_HOVER_CSS}</style>

      {/* Row header — label cross-fades when active card crosses a category boundary */}
      <div className="px-10 mb-4 flex items-baseline justify-between">
        <h3
          key={activeCatLabel /* remount triggers fade-in via animation */}
          className="font-display text-title font-bold tracking-[-0.3px] gallery-header-fade animate-fade-in"
        >
          {activeCatLabel}
        </h3>
        <span className="text-caption font-semibold text-accent uppercase tracking-wider cursor-pointer opacity-75 hover:opacity-100 transition-opacity">
          See all &rarr;
        </span>
      </div>

      {/* Carousel container */}
      <div className="relative">
        <div
          ref={scrollRef}
          className="flex overflow-x-auto overflow-y-hidden scrollbar-none snap-x snap-mandatory"
          style={{
            gap: `${GAP}px`,
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            paddingLeft: '35vw',
            paddingRight: '35vw',
            paddingTop: '24px',
            paddingBottom: '24px',
          }}
        >
          {items.map((item, i) => {
            // Divider rendering — visually distinct, never the focus target.
            if (item?._isDivider) {
              return (
                <div
                  key={item.id || `divider-${i}`}
                  ref={(el) => (cardsRef.current[i] = el)}
                  className="flex-none"
                  style={{ height: `${getCardHeight(variant)}px`, scrollSnapAlign: 'none' }}
                >
                  <CategoryDivider label={item.label} />
                </div>
              )
            }

            const dist = getCardDist(i)
            const isFocused = i === activeIndex

            return (
              <div
                key={item.id || `card-${i}`}
                ref={(el) => (cardsRef.current[i] = el)}
                className="flex-none snap-center animate-card-entrance"
                style={{ animationDelay: `${i * 40}ms` }}
                onMouseEnter={() => {
                  interactedRef.current = true
                  setFocusedItem(item, rowSurface, {
                    inputKind: 'mouse',
                    adjacentItems: buildAdjacentItems(i),
                  })
                }}
                onFocus={() => {
                  interactedRef.current = true
                  setFocusedItem(item, rowSurface, {
                    inputKind: 'mouse',
                    adjacentItems: buildAdjacentItems(i),
                  })
                }}
              >
                <PosterCard
                  item={item}
                  dist={dist}
                  isFocused={isFocused}
                  onClick={() => handleCardClick(i)}
                  loading={dist <= 3 ? 'eager' : 'lazy'}
                  variant={variant}
                  surfaceKey={surfaceKey || item._catKey || label}
                  progressPercent={showProgress && item.watchProgress != null
                    ? Math.round(item.watchProgress * 100)
                    : undefined}
                />
              </div>
            )
          })}
        </div>

        {/* Navigation arrows */}
        <button
          aria-label="Scroll left"
          onClick={() => scrollByCard(-1)}
          className="gallery-row-arrows pointer-fine:flex hidden absolute left-6 top-1/2 -translate-y-1/2 z-overlay
            items-center justify-center w-12 h-12 rounded-full
            bg-black/60 backdrop-blur-lg border border-white/[0.12]
            text-white/80 hover:text-white hover:bg-black/80 hover:scale-105
            transition-all duration-normal cursor-pointer
            opacity-0 group-hover/gallery:opacity-100"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <button
          aria-label="Scroll right"
          onClick={() => scrollByCard(1)}
          className="gallery-row-arrows pointer-fine:flex hidden absolute right-6 top-1/2 -translate-y-1/2 z-overlay
            items-center justify-center w-12 h-12 rounded-full
            bg-black/60 backdrop-blur-lg border border-white/[0.12]
            text-white/80 hover:text-white hover:bg-black/80 hover:scale-105
            transition-all duration-normal cursor-pointer
            opacity-0 group-hover/gallery:opacity-100"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M7.5 15L12.5 10L7.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

      </div>

      {/* Windowed progress dots — DOT_WINDOW centered on active card.
          Far edges fade and shrink to hint at off-window items. */}
      <div className="flex justify-center items-center gap-1.5 mt-3 px-10">
        {dotConfig.total === 0 ? null : (
          Array.from({ length: dotConfig.end - dotConfig.start + 1 }, (_, k) => {
            const ord = dotConfig.start + k
            const isActive = ord === activeCardOrdinal
            const distFromActive = Math.abs(ord - activeCardOrdinal)
            const half = Math.floor(DOT_WINDOW / 2)
            // Fade outermost ring; mid-distance dots get partial fade
            let opacity = 1
            let scale = 1
            if (!isActive) {
              if (distFromActive >= half - 1) { opacity = 0.35; scale = 0.7 }
              else if (distFromActive >= half - 3) { opacity = 0.6; scale = 0.85 }
            }
            return (
              <div
                key={ord}
                className={`h-[4px] rounded-full transition-all duration-300 ${
                  isActive ? 'w-5 bg-accent' : 'w-[4px] bg-white/15'
                }`}
                style={{ opacity, transform: `scale(${scale})` }}
              />
            )
          })
        )}
      </div>

    </div>
  )
}
