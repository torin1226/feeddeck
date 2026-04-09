import { useCallback, useEffect, useRef, useState } from 'react'
import useHomeStore from '../../stores/homeStore'
import useHoverPreview from '../../hooks/useHoverPreview'

// ============================================================
// CategoryRow
// Horizontal scroll strip of video cards for a single category.
// Cards fade up with staggered delay via IntersectionObserver.
// Left/right nav arrows appear on hover (desktop pointer devices).
// ============================================================

export default function CategoryRow({ category }) {
  const { setHeroItem, setTheatreMode } = useHomeStore()
  const { startPreview, cancelPreview } = useHoverPreview()
  const rowRef = useRef(null)
  const previewVideoRef = useRef(null)
  const [expanded, setExpanded] = useState(false)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  // Check scroll position and update arrow visibility
  const updateScrollState = useCallback(() => {
    const el = rowRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 2)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2)
  }, [])

  // Attach scroll listener and initial check
  useEffect(() => {
    const el = rowRef.current
    if (!el || expanded) return
    updateScrollState()
    el.addEventListener('scroll', updateScrollState, { passive: true })
    // Also recheck on resize
    const ro = new ResizeObserver(updateScrollState)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', updateScrollState)
      ro.disconnect()
    }
  }, [expanded, updateScrollState, category.items])

  const scrollBy = (direction) => {
    const el = rowRef.current
    if (!el) return
    const scrollAmount = el.clientWidth * 0.85
    el.scrollBy({ left: direction * scrollAmount, behavior: 'smooth' })
  }

  // Staggered fade-up animation on scroll into view
  useEffect(() => {
    if (!rowRef.current) return
    const cards = rowRef.current.querySelectorAll('.cat-card')

    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.style.opacity = '1'
            entry.target.style.transform = 'translateY(0)'
            obs.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.08 }
    )

    cards.forEach((card, i) => {
      card.style.opacity = '0'
      card.style.transform = 'translateY(22px)'
      card.style.transition = `opacity 0.5s ease ${(i % 7) * 0.055}s, transform 0.5s ease ${(i % 7) * 0.055}s`
      obs.observe(card)
    })

    return () => obs.disconnect()
  }, [category.items])

  const handleCardClick = (item) => {
    setHeroItem(item)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    // Enter theatre mode so the clicked video actually plays
    setTheatreMode(true)
  }

  return (
    <div className="mb-9">
      {/* Header */}
      <div className="flex items-center justify-between mb-3.5">
        <h3 className="font-display text-title font-bold tracking-[-0.3px]">{category.label}</h3>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-caption font-semibold text-accent opacity-75 cursor-pointer uppercase tracking-wider hover:opacity-100 transition-opacity bg-transparent border-none"
        >
          {expanded ? 'Collapse \u2191' : 'See all \u2192'}
        </button>
      </div>

      {/* Scrollable row / expanded grid */}
      <div className="group/row relative">
        <div
          ref={rowRef}
          className={expanded
            ? 'flex flex-wrap gap-3 pb-1.5 relative'
            : 'flex gap-3 overflow-x-auto pb-1.5 scrollbar-none relative'}
          style={expanded ? {} : {
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            WebkitMaskImage: 'linear-gradient(to right, black 88%, transparent 100%)',
            maskImage: 'linear-gradient(to right, black 88%, transparent 100%)',
          }}
        >
          {category.items.map((item) => (
            <div
              key={item.id}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCardClick(item) } }}
              onClick={() => handleCardClick(item)}
              onMouseEnter={(e) => {
                const vid = previewVideoRef.current
                if (item.url && vid) {
                  const card = e.currentTarget
                  vid.style.position = 'absolute'
                  vid.style.top = `${card.offsetTop}px`
                  vid.style.left = `${card.offsetLeft}px`
                  vid.style.width = `${card.offsetWidth}px`
                  vid.style.height = '113px'
                  startPreview(item.url, vid)
                }
              }}
              onMouseLeave={() => {
                cancelPreview()
                const vid = previewVideoRef.current
                if (vid) vid.style.opacity = '0'
              }}
              className="cat-card flex-none w-card rounded-[10px] overflow-hidden bg-raised
                cursor-pointer relative transition-all duration-[220ms] ease-out
                hover:scale-[1.03] hover:-translate-y-0.5 hover:shadow-card-hover"
            >
              <img
                src={item.thumbnailSm || item.thumbnail}
                alt={item.title}
                loading="lazy"
                className="w-full h-[113px] object-cover block bg-overlay"
              />
              {/* Hover play overlay */}
              <div className="absolute top-0 left-0 right-0 h-[113px] bg-black/45 flex items-center justify-center text-headline text-white opacity-0 hover:opacity-100 transition-opacity z-content">
                &#9654;
              </div>
              {/* Duration badge */}
              <span className="absolute top-[90px] right-[7px] bg-black/80 text-micro font-semibold px-1.5 py-0.5 rounded z-content">
                {item.duration}
              </span>
              {/* Info */}
              <div className="p-2.5 pt-2">
                <div className="text-body-sm font-semibold leading-tight line-clamp-2 mb-0.5">
                  {item.title}
                </div>
                <div className="text-caption text-text-muted">
                  {item.uploader} &middot; {item.views} views &middot; {item.daysAgo}d ago
                </div>
              </div>
            </div>
          ))}
          {/* Single shared preview video element per row (instead of one per card) */}
          <video
            ref={previewVideoRef}
            className="object-cover z-content pointer-events-none transition-opacity duration-300 rounded-t-[10px]"
            style={{ opacity: 0, position: 'absolute', top: 0, left: 0 }}
            muted
            playsInline
            loop
          />
        </div>

        {/* Navigation arrows — only visible on pointer (non-touch) devices, on row hover */}
        {!expanded && (
          <>
            {/* Left arrow */}
            <button
              aria-label="Scroll left"
              onClick={() => scrollBy(-1)}
              className={`pointer-fine:flex hidden absolute left-0 top-1/2 -translate-y-1/2 z-overlay
                items-center justify-center w-10 h-20 rounded-r-lg
                bg-black/50 backdrop-blur-sm border border-white/10 border-l-0
                text-white/80 hover:text-white hover:bg-black/70
                transition-all duration-200 cursor-pointer
                ${canScrollLeft
                  ? 'opacity-0 group-hover/row:opacity-100'
                  : 'opacity-0 pointer-events-none'}`}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>

            {/* Right arrow */}
            <button
              aria-label="Scroll right"
              onClick={() => scrollBy(1)}
              className={`pointer-fine:flex hidden absolute right-0 top-1/2 -translate-y-1/2 z-overlay
                items-center justify-center w-10 h-20 rounded-l-lg
                bg-black/50 backdrop-blur-sm border border-white/10 border-r-0
                text-white/80 hover:text-white hover:bg-black/70
                transition-all duration-200 cursor-pointer
                ${canScrollRight
                  ? 'opacity-0 group-hover/row:opacity-100'
                  : 'opacity-0 pointer-events-none'}`}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M7.5 15L12.5 10L7.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </>
        )}
      </div>
    </div>
  )
}
