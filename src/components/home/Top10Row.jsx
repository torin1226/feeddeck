import { useCallback, useEffect, useRef, useState } from 'react'
import useHomeStore from '../../stores/homeStore'

// ============================================================
// Top10Row
// Netflix-style Top 10 row with large rank numbers beside cards.
// Ranked by view count. Only renders when top10 has items.
// ============================================================

export default function Top10Row() {
  const { top10, setHeroItem, setTheatreMode } = useHomeStore()
  const rowRef = useRef(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const updateScrollState = useCallback(() => {
    const el = rowRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 2)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2)
  }, [])

  useEffect(() => {
    const el = rowRef.current
    if (!el) return
    updateScrollState()
    el.addEventListener('scroll', updateScrollState, { passive: true })
    const ro = new ResizeObserver(updateScrollState)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', updateScrollState)
      ro.disconnect()
    }
  }, [updateScrollState, top10])

  const scrollBy = (direction) => {
    const el = rowRef.current
    if (!el) return
    el.scrollBy({ left: direction * el.clientWidth * 0.85, behavior: 'smooth' })
  }

  if (!top10 || top10.length === 0) return null

  const handleClick = (item) => {
    setHeroItem(item)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTheatreMode(true)
  }

  return (
    <div className="mb-9">
      <div className="flex items-center justify-between mb-3.5">
        <h3 className="font-display text-title font-bold tracking-[-0.3px]">
          Top 10 This Week
        </h3>
      </div>

      <div className="group/row relative">
        <div
          ref={rowRef}
          className="flex gap-1 overflow-x-auto pb-1.5 scrollbar-none"
          style={{
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            WebkitMaskImage: 'linear-gradient(to right, black 90%, transparent 100%)',
            maskImage: 'linear-gradient(to right, black 90%, transparent 100%)',
          }}
        >
          {top10.map((item) => (
            <div
              key={item.id}
              role="button"
              tabIndex={0}
              onClick={() => handleClick(item)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(item) } }}
              className="flex-none flex items-end cursor-pointer group/card
                transition-all duration-[220ms] ease-out
                hover:scale-[1.03] hover:-translate-y-0.5"
            >
              {/* Rank number */}
              <span
                className="text-[80px] font-display font-black leading-none text-transparent select-none shrink-0 -mr-3 relative z-10"
                style={{
                  WebkitTextStroke: '2px rgba(244,63,94,0.5)',
                }}
              >
                {item.rank}
              </span>

              {/* Card */}
              <div className="w-[130px] rounded-lg overflow-hidden bg-raised shadow-card-hover">
                <img
                  src={item.thumbnailSm || item.thumbnail}
                  alt={item.title}
                  loading="lazy"
                  className="w-full h-[185px] object-cover block bg-overlay"
                />
                <div className="p-2">
                  <div className="text-[11px] font-semibold leading-tight line-clamp-2">
                    {item.title}
                  </div>
                  <div className="text-[10px] text-text-muted mt-0.5">
                    {item.views} views
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Navigation arrows */}
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
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
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
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M7.5 15L12.5 10L7.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
      </div>
    </div>
  )
}
