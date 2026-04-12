import { useRef, useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import useHomeStore from '../../stores/homeStore'
import useFeedStore from '../../stores/feedStore'
import TheatreRow from './TheatreRow'
import ContinueWatchingRow from './ContinueWatchingRow'
import Top10Row from './Top10Row'

// ============================================================
// BrowseSection
// Three curated TheatreRow carousels (Live Music, My Subscriptions,
// Trending) with vertical parallax between rows.
// When you reach the end of the last row, it seamlessly transitions
// into the Feed. Also has an explicit CTA as a fallback.
// ============================================================

const VERTICAL_PARALLAX_FACTOR = 0.08

// The 3 rows we keep (matched case-insensitively)
const TARGET_LABELS = ['Live Music', 'My Subscriptions', 'Trending']

export default function BrowseSection() {
  const { categories } = useHomeStore()
  const navigate = useNavigate()
  const rowRefs = useRef([])
  const [feedTransition, setFeedTransition] = useState(false)
  const transitionTimer = useRef(null)

  // Match target labels to available categories. Fallback to first 3 if no matches.
  // Use originalLabel (pre-personalization) so dynamic renaming doesn't break matching.
  const matchedCategories = TARGET_LABELS
    .map((target) =>
      categories.find((c) =>
        (c.originalLabel || c.label).toLowerCase().includes(target.toLowerCase())
      )
    )
    .filter(Boolean)

  const displayCategories =
    matchedCategories.length > 0 ? matchedCategories : categories.slice(0, 3)

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
    // Ensure feed buffer is ready
    useFeedStore.getState().prefetch()
    // Visual transition, then navigate
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

  if (displayCategories.length === 0) return null

  return (
    <div
      className={`relative z-content pt-4 pb-0 transition-all duration-700 ease-cinematic ${
        feedTransition ? 'opacity-0 -translate-y-5 scale-[0.98]' : ''
      }`}
    >
      {/* Continue Watching row — positioned first like Netflix (row 1-2) */}
      <div className="px-10">
        <ContinueWatchingRow />
      </div>

      {/* Top 10 row — Netflix-style with rank numbers */}
      <div className="px-10">
        <Top10Row />
      </div>

      {displayCategories.map((cat, i) => (
        <div
          key={cat.label}
          ref={(el) => (rowRefs.current[i] = el)}
          className="will-change-transform"
        >
          <TheatreRow
            category={cat}
            isLast={i === displayCategories.length - 1}
            onReachEnd={i === displayCategories.length - 1 ? handleLastRowEnd : undefined}
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
