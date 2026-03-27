import { useEffect, useRef } from 'react'
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
    setTheatreMode(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="mb-9">
      {/* Header */}
      <div className="flex items-center justify-between mb-3.5">
        <h3 className="font-display text-[18px] font-bold tracking-[-0.3px]">{category.label}</h3>
        <span className="text-[11px] font-semibold text-accent opacity-75 cursor-pointer uppercase tracking-wider hover:opacity-100 transition-opacity">
          See all &rarr;
        </span>
      </div>

      {/* Scrollable row */}
      <div
        ref={rowRef}
        className="flex gap-3 overflow-x-auto pb-1.5 scrollbar-none"
        style={{
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          WebkitMaskImage: 'linear-gradient(to right, black 88%, transparent 100%)',
          maskImage: 'linear-gradient(to right, black 88%, transparent 100%)',
        }}
      >
        {category.items.map((item) => (
          <div
            key={item.id}
            onClick={() => handleCardClick(item)}
            onMouseEnter={(e) => {
              const vid = e.currentTarget.querySelector('video')
              if (item.url && vid) startPreview(item.url, vid)
            }}
            onMouseLeave={cancelPreview}
            className="cat-card flex-none w-[200px] rounded-[10px] overflow-hidden bg-raised
              cursor-pointer relative transition-all duration-[220ms] ease-out
              hover:scale-[1.03] hover:-translate-y-0.5 hover:shadow-[0_12px_32px_rgba(0,0,0,0.4)]"
          >
            <img
              src={item.thumbnailSm || item.thumbnail}
              alt={item.title}
              loading="lazy"
              className="w-full h-[113px] object-cover block bg-overlay"
            />
            {/* Hover play overlay — shows on hover, hidden when preview video plays */}
            <div className="absolute top-0 left-0 right-0 h-[113px] bg-black/45 flex items-center justify-center text-[28px] text-white opacity-0 hover:opacity-100 transition-opacity z-[1]">
              &#9654;
            </div>
            {/* Hover preview video — above overlay so it's visible when playing */}
            <video
              className="absolute top-0 left-0 w-full h-[113px] object-cover z-[2] pointer-events-none transition-opacity duration-300"
              style={{ opacity: 0 }}
              muted
              playsInline
              loop
            />
            {/* Duration badge */}
            <span className="absolute top-[90px] right-[7px] bg-black/80 text-[10px] font-semibold px-1.5 py-0.5 rounded z-[3]">
              {item.duration}
            </span>
            {/* Info */}
            <div className="p-2.5 pt-2">
              <div className="text-[13px] font-semibold leading-tight line-clamp-2 mb-0.5">
                {item.title}
              </div>
              <div className="text-[11px] text-text-muted">
                {item.uploader} &middot; {item.views} views &middot; {item.daysAgo}d ago
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
