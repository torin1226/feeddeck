import { useEffect, useRef, useState } from 'react'
import useHomeStore from '../../stores/homeStore'
import useHoverPreview from '../../hooks/useHoverPreview'

// ============================================================
// CategoryRow
// Horizontal scroll strip of video cards for a single category.
// Cards fade up with staggered delay via IntersectionObserver.
// ============================================================

export default function CategoryRow({ category }) {
  const { setHeroItem, setTheatreMode } = useHomeStore()
  const { startPreview, cancelPreview } = useHoverPreview()
  const rowRef = useRef(null)
  const previewVideoRef = useRef(null)
  const [expanded, setExpanded] = useState(false)

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
                // Position the shared preview video over this card's thumbnail
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
    </div>
  )
}
