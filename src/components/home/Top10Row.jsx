import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useHomeStore from '../../stores/homeStore'
import { registerPreviewTarget, prefetchStreamUrl } from '../../hooks/useFocusPreview'

// ============================================================
// Top10Row
// Netflix-style Top 10 row with large rank numbers beside cards.
// Ranked by view count. Only renders when top10 has items.
// ============================================================

export default function Top10Row() {
  const { top10, setFocusedItem } = useHomeStore()
  const navigate = useNavigate()
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

  // Pre-compute neighbor lookup so each card can hand useFocusPreview a
  // pair of adjacent {id, url} pairs without re-scanning the array.
  // Computed before the early return so hook order stays stable.
  const adjacentByIndex = useMemo(() => {
    if (!top10 || top10.length === 0) return []
    const arr = []
    for (let i = 0; i < top10.length; i++) {
      const adj = []
      const prev = top10[i - 1]
      const next = top10[i + 1]
      if (prev?.id && prev?.url) adj.push({ id: prev.id, url: prev.url })
      if (next?.id && next?.url) adj.push({ id: next.id, url: next.url })
      arr.push(adj)
    }
    return arr
  }, [top10])

  if (!top10 || top10.length === 0) return null

  const handleClick = (item) => {
    navigate(`/watch/${item.id}`)
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
          {top10.map((item, i) => (
            <Top10Card
              key={item.id}
              item={item}
              adjacentItems={adjacentByIndex[i]}
              onClick={() => handleClick(item)}
              onFocus={() => setFocusedItem(item, 'top10', {
                inputKind: 'mouse',
                adjacentItems: adjacentByIndex[i],
              })}
            />
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

// Single Top 10 entry: rank number + thumbnail card + hidden preview video.
// Extracted so the per-card useRef + registerPreviewTarget can run without
// useRef inside a map callback.
function Top10Card({ item, onClick, onFocus }) {
  const previewVideoRef = useRef(null)

  useEffect(() => {
    const id = item?.id
    const el = previewVideoRef.current
    if (!id || !el) return undefined
    // Register video target AND kick off viewport-aware prefetch via the
    // video's parent (the card itself). See PosterCard for rationale.
    const cleanups = [registerPreviewTarget(id, el)]

    const url = item?.url
    const container = el.parentElement
    if (url && container && typeof IntersectionObserver !== 'undefined') {
      let prefetched = false
      const io = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting && !prefetched) {
              prefetched = true
              prefetchStreamUrl(id, url)
              io.disconnect()
              break
            }
          }
        },
        { rootMargin: '300px 1000px', threshold: 0.01 }
      )
      io.observe(container)
      cleanups.push(() => io.disconnect())
    }

    return () => cleanups.forEach((fn) => fn())
  }, [item?.id, item?.url])

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick?.()
        }
      }}
      onMouseEnter={onFocus}
      onFocus={onFocus}
      className="flex-none flex items-end cursor-pointer group/card
        transition-all duration-[220ms] ease-out
        hover:scale-[var(--hover-scale)] hover:-translate-y-0.5"
    >
      {/* Rank number */}
      <span
        className="text-[clamp(80px,17vh,180px)] font-display font-black leading-none text-transparent select-none shrink-0 -mr-3 relative z-10"
        style={{
          WebkitTextStroke: '2px rgba(30,58,138,0.6)',
        }}
      >
        {item.rank}
      </span>

      {/* Card */}
      <div className="w-[clamp(130px,27.4vh,295px)] rounded-lg overflow-hidden bg-raised shadow-card-hover relative">
        <div className="relative w-full h-[clamp(185px,39vh,420px)]">
          <img
            src={item.thumbnailSm || item.thumbnail}
            alt={item.title}
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover bg-overlay"
          />
          {/* Hover preview video — driven by useFocusPreview */}
          <video
            ref={previewVideoRef}
            muted
            playsInline
            loop
            preload="none"
            className="absolute inset-0 w-full h-full object-cover pointer-events-none transition-opacity duration-[250ms]"
            style={{ opacity: 0 }}
          />
        </div>
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
  )
}
