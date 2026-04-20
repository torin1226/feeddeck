import { useRef, useEffect, useCallback, useState } from 'react'
import useHomeStore from '../../stores/homeStore'
import PosterCard from './PosterCard'
import PosterInfoPanel from './PosterInfoPanel'

// ============================================================
// GalleryRow
// Unified horizontal gallery row. Merges TheatreRow's native
// scroll-snap + parallax with PosterShelf's focus-scale behavior.
// Replaces TheatreRow, PosterShelf, and ContinueWatchingRow.
// ============================================================

const GAP = 10
const PARALLAX_FACTOR = 0.1
const ASPECT_RATIO = { h: 16 / 9, v: 9 / 16 }

// Arrow button hover CSS
const ARROW_HOVER_CSS = `
.gallery-row-arrows { pointer-events: auto; }
div:has(> .gallery-row-arrows):hover .gallery-row-arrows { opacity: 1 !important; }
.gallery-row-arrows:hover { background: rgba(255,255,255,0.12) !important; }
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

export default function GalleryRow({ items, label, showProgress, isLast, onReachEnd, variant = 'poster', surfaceKey }) {
  const { setHeroItem, setTheatreMode } = useHomeStore()
  const scrollRef = useRef(null)
  const cardsRef = useRef([])
  const rafRef = useRef(null)
  const endFired = useRef(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const activeIndexRef = useRef(0)
  // Ref passed to PosterInfoPanel so it can compute panel position
  const focusedCardRef = useRef(null)
  // Outer row wrapper — PosterInfoPanel positions itself absolute within this
  const trackWrapRef = useRef(null)

  // Keep refs in sync with activeIndex
  useEffect(() => {
    activeIndexRef.current = activeIndex
    focusedCardRef.current = cardsRef.current[activeIndex] ?? null
  }, [activeIndex])

  // RAF-batched parallax + focus detection on scroll
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

      // Track closest to center
      if (absDist < closestDist) { closestDist = absDist; closestIdx = i }

      // Parallax: image shifts opposite to card's offset from center
      const img = card.querySelector('[data-parallax-img]')
      if (img) {
        const shift = -offsetFromCenter * PARALLAX_FACTOR
        img.style.transform = `translateX(${shift}px) scale(1.1)`
      }
    })

    setActiveIndex(closestIdx)

    // End-of-row detection for feed transition
    if (isLast && !endFired.current && onReachEnd) {
      const atEnd = container.scrollLeft + container.clientWidth >= container.scrollWidth - 30
      if (atEnd) { endFired.current = true; onReachEnd() }
    }
  }, [isLast, onReachEnd])

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return

    const onScroll = () => {
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
    if (!item) return
    if (index === activeIndexRef.current) {
      // Theatre mode: set hero + scroll to top
      setHeroItem(item)
      window.scrollTo({ top: 0, behavior: 'smooth' })
      setTheatreMode(true)
    } else {
      // Scroll the clicked card to center
      const card = cardsRef.current[index]
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
      }
    }
  }, [items, setHeroItem, setTheatreMode])

  // Scroll by one card width
  const scrollByCard = useCallback((direction) => {
    const container = scrollRef.current
    if (!container) return
    const cardWidth = getCardWidth(items?.[activeIndexRef.current], variant)
    container.scrollBy({ left: direction * (cardWidth + GAP), behavior: 'smooth' })
  }, [items, variant])

  // Compute distance from center for each card based on activeIndex
  const getCardDist = useCallback((index) => Math.abs(index - activeIndex), [activeIndex])

  const handleRowKeyDown = useCallback((e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); scrollByCard(-1) }
    else if (e.key === 'ArrowRight') { e.preventDefault(); scrollByCard(1) }
  }, [scrollByCard])

  // Vertical scroll wheel navigates card-by-card. Horizontal (trackpad swipe) scrolls natively.
  // Must be attached via useEffect with { passive: false } -- React's onWheel is passive by default
  // which makes preventDefault() a no-op for wheel events.
  const handleWheel = useCallback((e) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
    e.preventDefault()
    scrollByCard(e.deltaY > 0 ? 1 : -1)
  }, [scrollByCard])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  if (!items?.length) return null

  return (
    <div
      ref={trackWrapRef}
      className="mb-2 group/gallery relative"
      tabIndex={0}
      onKeyDown={handleRowKeyDown}
      style={{ outline: 'none' }}
    >
      <style>{ARROW_HOVER_CSS}</style>

      {/* Row header */}
      <div className="px-10 mb-4 flex items-baseline justify-between">
        <h3 className="font-display text-title font-bold tracking-[-0.3px]">
          {label}
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
            const dist = getCardDist(i)
            const isFocused = i === activeIndex

            return (
              <div
                key={item.id || `card-${i}`}
                ref={(el) => (cardsRef.current[i] = el)}
                className="flex-none snap-center animate-card-entrance"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <PosterCard
                  item={item}
                  dist={dist}
                  isFocused={isFocused}
                  onClick={() => handleCardClick(i)}
                  loading={dist <= 3 ? 'eager' : 'lazy'}
                  variant={variant}
                  surfaceKey={surfaceKey || label}
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

      {/* Dot indicators */}
      <div className="flex justify-center gap-1.5 mt-3 px-10">
        {items.slice(0, Math.min(items.length, 14)).map((_, i) => (
          <div
            key={i}
            className={`h-[4px] rounded-full transition-all duration-300 ${
              i === activeIndex
                ? 'w-5 bg-accent'
                : 'w-[4px] bg-white/15'
            }`}
          />
        ))}
        {items.length > 14 && (
          <span className="text-micro text-text-muted ml-1">+{items.length - 14}</span>
        )}
      </div>

      {/* Info panel — poster variant only, anchored to focused card */}
      {variant !== 'landscape' && (
        <PosterInfoPanel
          item={items[activeIndex]}
          cardRef={focusedCardRef}
          trackWrapRef={trackWrapRef}
        />
      )}
    </div>
  )
}
