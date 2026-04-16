import { useRef, useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import useHomeStore from '../../stores/homeStore'
import useFeedStore from '../../stores/feedStore'
import useLibraryStore from '../../stores/libraryStore'
import GalleryRow from './GalleryRow'
import Top10Row from './Top10Row'

// Fetch liked videos for "Your Likes" row (appears after 3+ likes)
function useLikedRow() {
  const [items, setItems] = useState([])
  useEffect(() => {
    fetch('/api/ratings/history?rating=up&limit=20')
      .then(r => r.ok ? r.json() : { ratings: [] })
      .then(data => {
        const mapped = (data.ratings || []).map(r => ({
          id: `liked-${r.id}`,
          title: r.title || (r.creator ? `From ${r.creator}` : 'Liked'),
          thumbnail: r.thumbnail || '',
          url: r.video_url,
          uploader: r.creator || '',
          tags: typeof r.tags === 'string' ? JSON.parse(r.tags || '[]') : (r.tags || []),
          duration: '',
          durationSec: 0,
          views: '',
          orient: 'h',
        }))
        setItems(mapped)
      })
      .catch(() => {})
  }, [])
  return items
}

// ============================================================
// BrowseSection
// Curated GalleryRow carousels with vertical parallax between rows.
// GalleryShelf renders the first 2 categories, so BrowseSection
// shows Continue Watching, Top 10, and remaining categories.
// When you reach the end of the last row, it seamlessly transitions
// into the Feed. Also has an explicit CTA as a fallback.
// ============================================================

const VERTICAL_PARALLAX_FACTOR = 0.08

export default function BrowseSection() {
  const { categories } = useHomeStore()
  const videos = useLibraryStore((s) => s.videos)
  const likedItems = useLikedRow()
  const navigate = useNavigate()
  const rowRefs = useRef([])
  const [feedTransition, setFeedTransition] = useState(false)
  const transitionTimer = useRef(null)

  // GalleryShelf already renders categories.slice(0, 2), show the rest here
  const displayCategories = categories.slice(2)

  // Continue Watching: in-progress videos sorted by most recently watched
  const continueWatching = videos
    .filter((v) => v.watchProgress > 0.05 && v.watchProgress < 0.95)
    .sort((a, b) => {
      const aTime = a.lastWatched ? new Date(a.lastWatched).getTime() : 0
      const bTime = b.lastWatched ? new Date(b.lastWatched).getTime() : 0
      return bTime - aTime
    })

  // Vertical parallax: rows shift slightly based on their scroll position
  useEffect(() => {
    let raf

    const onScroll = () => {
      if (raf) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const viewH = window.innerHeight
        rowRefs.current.forEach((row) => {
          if (!row) return
          const rect = row.getBoundingClientRect()
          const rowCenter = rect.top + rect.height / 2
          const progress = (rowCenter - viewH / 2) / viewH
          const offset = progress * VERTICAL_PARALLAX_FACTOR * 100
          row.style.transform = `translate3d(0, ${offset}px, 0)`
        })
      })
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    requestAnimationFrame(onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [displayCategories.length])

  // Seamless feed transition when reaching end of last row
  const handleLastRowEnd = useCallback(() => {
    if (feedTransition) return
    setFeedTransition(true)
    useFeedStore.getState().prefetch()
    transitionTimer.current = setTimeout(() => {
      navigate('/feed')
    }, 800)
  }, [feedTransition, navigate])

  useEffect(() => {
    return () => clearTimeout(transitionTimer.current)
  }, [])

  const goToFeed = () => {
    setFeedTransition(true)
    useFeedStore.getState().prefetch()
    setTimeout(() => navigate('/feed'), 400)
  }

  return (
    <div
      className={`relative z-content pt-4 pb-0 transition-all duration-700 ease-cinematic ${
        feedTransition ? 'opacity-0 -translate-y-5 scale-[0.98]' : ''
      }`}
    >
      {/* Continue Watching row */}
      {continueWatching.length > 0 && (
        <div
          ref={(el) => (rowRefs.current[0] = el)}
          className="will-change-transform"
        >
          <GalleryRow
            items={continueWatching}
            label="Continue Watching"
            showProgress
            variant="landscape"
          />
        </div>
      )}

      {/* Top 10 row */}
      <div className="px-10">
        <Top10Row />
      </div>

      {/* Your Likes row — appears after 3+ liked videos */}
      {likedItems.length >= 3 && (
        <div className="will-change-transform">
          <GalleryRow
            items={likedItems}
            label="Your Likes"
            surfaceKey="liked"
            variant="landscape"
          />
        </div>
      )}

      {displayCategories.map((cat, i) => (
        <div
          key={cat.label}
          ref={(el) => (rowRefs.current[i + (continueWatching.length > 0 ? 1 : 0)] = el)}
          className="will-change-transform"
        >
          <GalleryRow
            items={cat.items}
            label={cat.label}
            isLast={i === displayCategories.length - 1}
            onReachEnd={i === displayCategories.length - 1 ? handleLastRowEnd : undefined}
            variant="landscape"
          />
        </div>
      ))}

      {/* Feed CTA */}
      {!feedTransition && (
        <div className="flex flex-col items-center justify-center py-24 px-10">
          <div className="text-center max-w-md">
            <p className="text-body-sm text-text-muted uppercase tracking-wider font-semibold mb-3">
              Keep going
            </p>
            <h3 className="font-display text-headline font-bold tracking-tighter mb-3">
              Switch to Feed
            </h3>
            <p className="text-subhead text-text-secondary mb-8 leading-relaxed">
              Infinite scroll, personalized to your taste. No rows, no limits.
            </p>
            <button
              onClick={goToFeed}
              className="inline-flex items-center gap-2 px-8 py-3.5 rounded-full
                bg-accent text-white text-subhead font-bold
                hover:bg-accent-hover active:scale-95 transition-all duration-200"
            >
              Open Feed
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Feed transition indicator */}
      {feedTransition && (
        <div className="flex items-center justify-center py-16">
          <div className="text-sm text-text-secondary font-medium animate-pulse">
            Loading feed...
          </div>
        </div>
      )}
    </div>
  )
}