import { useRef, useEffect, useCallback, useState } from 'react'
import useHomeStore from '../../stores/homeStore'

// ============================================================
// TheatreRow
// Cinematic horizontal carousel with large 16:9 cards.
// Horizontal scroll-snap with subtle parallax: card images
// shift opposite to scroll direction, creating depth.
// Cards scale/fade based on distance from viewport center.
// Last row can fire onReachEnd when scrolled to the end.
// ============================================================

const PARALLAX_FACTOR = 0.1 // Image shift relative to card offset from center

export default function TheatreRow({ category, isLast, onReachEnd }) {
  const { setHeroItem, setTheatreMode } = useHomeStore()
  const scrollRef = useRef(null)
  const cardsRef = useRef([])
  const rafRef = useRef(null)
  const endFired = useRef(false)
  const [activeIndex, setActiveIndex] = useState(0)

  // RAF-batched parallax on horizontal scroll
  const updateParallax = useCallback(() => {
    const container = scrollRef.current
    if (!container) return

    const containerRect = container.getBoundingClientRect()
    const centerX = containerRect.left + containerRect.width / 2

    cardsRef.current.forEach((card) => {
      if (!card) return
      const cardRect = card.getBoundingClientRect()
      const cardCenterX = cardRect.left + cardRect.width / 2
      const offsetFromCenter = cardCenterX - centerX

      // Parallax: image shifts opposite to card's offset from center
      const img = card.querySelector('[data-parallax-img]')
      if (img) {
        const shift = -offsetFromCenter * PARALLAX_FACTOR
        img.style.transform = `translateX(${shift}px) scale(1.1)`
      }

      // Scale + opacity based on distance from center
      const normalizedDist = Math.abs(offsetFromCenter) / containerRect.width
      const scale = Math.max(0.92, 1 - normalizedDist * 0.08)
      const opacity = Math.max(0.5, 1 - normalizedDist * 0.4)
      card.style.transform = `scale(${scale})`
      card.style.opacity = opacity
    })

    // Track active (closest to center) card index
    let closestIdx = 0
    let closestDist = Infinity
    cardsRef.current.forEach((card, i) => {
      if (!card) return
      const rect = card.getBoundingClientRect()
      const dist = Math.abs(rect.left + rect.width / 2 - centerX)
      if (dist < closestDist) { closestDist = dist; closestIdx = i }
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
    // Also recompute on resize
    const ro = new ResizeObserver(onScroll)
    ro.observe(container)
    // Initial pass
    requestAnimationFrame(updateParallax)

    return () => {
      container.removeEventListener('scroll', onScroll)
      ro.disconnect()
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [updateParallax, category.items])

  const handleCardClick = (item) => {
    setHeroItem(item)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTheatreMode(true)
  }

  // Scroll by one card width
  const scrollByCard = (direction) => {
    const container = scrollRef.current
    if (!container) return
    const cardWidth = container.querySelector('[data-theatre-card]')?.offsetWidth || 0
    container.scrollBy({ left: direction * (cardWidth + 16), behavior: 'smooth' })
  }

  if (!category?.items?.length) return null

  return (
    <div className="mb-2 group/theatre">
      {/* Row header */}
      <div className="px-10 mb-4 flex items-baseline justify-between">
        <h3 className="font-display text-title font-bold tracking-[-0.3px]">
          {category.label}
        </h3>
        <span className="text-caption font-semibold text-accent uppercase tracking-wider cursor-pointer opacity-75 hover:opacity-100 transition-opacity">
          See all &rarr;
        </span>
      </div>

      {/* Carousel container */}
      <div className="relative">
        <div
          ref={scrollRef}
          className="flex gap-4 overflow-x-auto scrollbar-none snap-x snap-mandatory"
          style={{
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            paddingLeft: '20vw',
            paddingRight: '20vw',
            paddingTop: '8px',
            paddingBottom: '8px',
          }}
        >
          {category.items.map((item, i) => (
            <div
              key={item.id}
              ref={(el) => (cardsRef.current[i] = el)}
              data-theatre-card
              onClick={() => handleCardClick(item)}
              className="flex-none cursor-pointer overflow-hidden rounded-card-lg snap-center
                transition-[transform,opacity] duration-300 ease-cinematic will-change-transform"
              style={{ width: '60vw' }}
            >
              {/* 16:9 image container */}
              <div className="relative overflow-hidden" style={{ aspectRatio: '16 / 9' }}>
                <img
                  data-parallax-img
                  src={item.thumbnail}
                  alt={item.title}
                  loading="lazy"
                  className="absolute inset-0 w-full h-full object-cover will-change-transform"
                  style={{ transform: 'scale(1.1)' }}
                  draggable="false"
                />

                {/* Bottom gradient for text legibility */}
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    background:
                      'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 35%, transparent 65%)',
                  }}
                />

                {/* Card metadata overlay */}
                <div className="absolute bottom-0 left-0 right-0 p-6 z-content">
                  <div className="text-micro font-bold uppercase tracking-[1.4px] text-accent mb-1.5">
                    {item.genre || category.label}
                  </div>
                  <div className="font-display text-display font-bold tracking-[-0.5px] leading-tight mb-1.5 line-clamp-2 drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]">
                    {item.title}
                  </div>
                  <div className="text-body-sm text-white/60 mb-4">
                    {item.uploader} &middot; {item.views} views &middot; {item.daysAgo}d ago
                  </div>
                  <div className="flex items-center gap-2.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleCardClick(item)
                      }}
                      className="inline-flex items-center gap-2 px-5 py-2.5 bg-text-primary text-surface
                        rounded-full text-body-sm font-bold hover:opacity-90 hover:scale-[1.02]
                        transition-all duration-fast"
                    >
                      &#9654; &nbsp;Stream now
                    </button>
                    <button
                      onClick={(e) => e.stopPropagation()}
                      className="w-9 h-9 rounded-full bg-white/10 border border-white/20 text-white text-lg
                        flex items-center justify-center hover:bg-white/20 transition-colors duration-fast"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Navigation arrows */}
        <button
          aria-label="Scroll left"
          onClick={() => scrollByCard(-1)}
          className="pointer-fine:flex hidden absolute left-6 top-1/2 -translate-y-1/2 z-overlay
            items-center justify-center w-12 h-12 rounded-full
            bg-black/60 backdrop-blur-lg border border-white/[0.12]
            text-white/80 hover:text-white hover:bg-black/80 hover:scale-105
            transition-all duration-normal cursor-pointer
            opacity-0 group-hover/theatre:opacity-100"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <button
          aria-label="Scroll right"
          onClick={() => scrollByCard(1)}
          className="pointer-fine:flex hidden absolute right-6 top-1/2 -translate-y-1/2 z-overlay
            items-center justify-center w-12 h-12 rounded-full
            bg-black/60 backdrop-blur-lg border border-white/[0.12]
            text-white/80 hover:text-white hover:bg-black/80 hover:scale-105
            transition-all duration-normal cursor-pointer
            opacity-0 group-hover/theatre:opacity-100"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M7.5 15L12.5 10L7.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>

      {/* Dot indicators */}
      <div className="flex justify-center gap-1.5 mt-3 px-10">
        {category.items.slice(0, Math.min(category.items.length, 14)).map((_, i) => (
          <div
            key={i}
            className={`h-[4px] rounded-full transition-all duration-300 ${
              i === activeIndex
                ? 'w-5 bg-accent'
                : 'w-[4px] bg-white/15'
            }`}
          />
        ))}
        {category.items.length > 14 && (
          <span className="text-micro text-text-muted ml-1">+{category.items.length - 14}</span>
        )}
      </div>
    </div>
  )
}
