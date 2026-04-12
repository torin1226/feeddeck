import { useEffect, useRef } from 'react'
import useLibraryStore from '../../stores/libraryStore'
import useHomeStore from '../../stores/homeStore'

// ============================================================
// ContinueWatchingRow (Homepage)
// Shows videos the user started but didn't finish (5%–95%).
// Positioned as the first row before category rows.
// Matches CategoryRow visual style with added progress bars.
// ============================================================

export default function ContinueWatchingRow() {
  const videos = useLibraryStore((s) => s.videos)
  const { setHeroItem, setTheatreMode } = useHomeStore()
  const rowRef = useRef(null)

  // Filter to in-progress videos, sorted by most recently watched
  const continueWatching = videos
    .filter((v) => v.watchProgress > 0.05 && v.watchProgress < 0.95)
    .sort((a, b) => {
      const aTime = a.lastWatched ? new Date(a.lastWatched).getTime() : 0
      const bTime = b.lastWatched ? new Date(b.lastWatched).getTime() : 0
      return bTime - aTime
    })

  // Staggered fade-up animation on scroll into view
  useEffect(() => {
    if (!rowRef.current) return
    const cards = rowRef.current.querySelectorAll('.cw-card')

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
  }, [continueWatching.length])

  // Don't render if nothing to continue
  if (continueWatching.length === 0) return null

  const handleCardClick = (item) => {
    // Map library video shape to homepage hero shape
    const heroItem = {
      id: item.id,
      title: item.title || 'Untitled',
      thumbnail: item.thumbnail || '',
      thumbnailSm: item.thumbnail || '',
      duration: item.durationFormatted || '0:00',
      durationSec: item.duration || 0,
      views: item.views || '',
      uploader: item.channel || item.source || 'Unknown',
      daysAgo: item.addedAt
        ? Math.max(1, Math.floor((Date.now() - new Date(item.addedAt).getTime()) / 86400000))
        : 1,
      desc: item.title || '',
      genre: item.source || 'Video',
      url: item.url,
      tags: item.tags || [],
    }
    setHeroItem(heroItem)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTheatreMode(true)
  }

  return (
    <div className="mb-9">
      {/* Header */}
      <div className="flex items-center justify-between mb-3.5">
        <h3 className="font-display text-title font-bold tracking-[-0.3px]">
          Continue Watching
        </h3>
        <span className="text-caption font-semibold text-text-muted opacity-75 uppercase tracking-wider">
          {continueWatching.length} {continueWatching.length === 1 ? 'video' : 'videos'}
        </span>
      </div>

      {/* Scrollable row */}
      <div
        ref={rowRef}
        className="flex gap-3 overflow-x-auto pb-1.5 scrollbar-none relative"
        style={{
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          WebkitMaskImage: 'linear-gradient(to right, black 88%, transparent 100%)',
          maskImage: 'linear-gradient(to right, black 88%, transparent 100%)',
        }}
      >
        {continueWatching.map((item) => {
          const progress = Math.round((item.watchProgress || 0) * 100)

          return (
            <div
              key={item.id}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  handleCardClick(item)
                }
              }}
              onClick={() => handleCardClick(item)}
              className="cw-card flex-none w-card rounded-[10px] overflow-hidden bg-raised
                cursor-pointer relative transition-all duration-[220ms] ease-out
                hover:scale-[1.03] hover:-translate-y-0.5 hover:shadow-card-hover"
            >
              {/* Thumbnail */}
              <div className="relative">
                <img
                  src={item.thumbnail}
                  alt={item.title}
                  loading="lazy"
                  className="w-full h-[113px] object-cover block bg-overlay"
                />
                {/* Resume play overlay */}
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                  <div className="w-11 h-11 rounded-full bg-white/90 flex items-center justify-center text-black text-lg shadow-float">
                    &#9654;
                  </div>
                </div>
                {/* Duration badge */}
                <span className="absolute top-[90px] right-[7px] bg-black/80 text-micro font-semibold px-1.5 py-0.5 rounded z-content">
                  {item.durationFormatted || '0:00'}
                </span>
                {/* Progress bar (Netflix-style thin bar at bottom of thumbnail) */}
                <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-white/10">
                  <div
                    className="h-full bg-accent rounded-r-sm transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>

              {/* Info */}
              <div className="p-2.5 pt-2">
                <div className="text-body-sm font-semibold leading-tight line-clamp-2 mb-0.5">
                  {item.title}
                </div>
                <div className="text-caption text-text-muted">
                  {item.channel || item.source} &middot; {progress}% watched
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
