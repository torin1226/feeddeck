import { useEffect } from 'react'
import useHomeStore from '../stores/homeStore'
import useModeStore from '../stores/modeStore'
import useFeedStore from '../stores/feedStore'
import HomeHeader from '../components/home/HomeHeader'
import HeroSection from '../components/home/HeroSection'
import FeaturedSection from '../components/home/FeaturedSection'
import CategoryRows from '../components/home/CategoryRows'
import TheatreControls from '../components/home/TheatreControls'
import { SkeletonHero, SkeletonFeatured, SkeletonCategoryRow } from '../components/Skeletons'

// ============================================================
// HomePage
// Main landing page with hero, featured carousel, and category
// rows. Fetches real data from backend on mount, falls back to
// placeholders if the cache is empty.
// In theatre mode, FeaturedSection and CategoryRows are hidden.
// ============================================================

export default function HomePage() {
  const { fetchHomepage, heroItem, theatreMode, fetchError } = useHomeStore()
  const isSFW = useModeStore((s) => s.isSFW)

  // Fetch homepage data on mount and when mode changes.
  // Small delay ensures nuclearFlush (async) completes before re-fetching,
  // preventing a race where flush clears data after fetch succeeds.
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchHomepage(isSFW ? 'social' : 'nsfw')
    }, 50)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSFW])

  // Pre-warm feed buffer so /feed loads instantly when navigated to
  useEffect(() => {
    const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 200))
    idle(() => useFeedStore.getState().prefetch())
  }, [])

  const loading = !heroItem

  return (
    <div className="min-h-screen bg-surface text-text-primary font-sans">
      <HomeHeader />

      {/* Server-unreachable banner */}
      {fetchError && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-modal px-4 py-2 rounded-full bg-amber-900/80 backdrop-blur text-amber-200 text-xs font-medium flex items-center gap-2">
          <span>⚠</span>
          <span>{fetchError}</span>
          <button
            onClick={() => fetchHomepage(isSFW ? 'social' : 'nsfw')}
            className="ml-1 underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <>
          <SkeletonHero />
          <SkeletonFeatured />
          <SkeletonCategoryRow />
          <SkeletonCategoryRow />
        </>
      ) : (
        <>
          <HeroSection />
          {!theatreMode && (
            <div className="relative z-content">
              <FeaturedSection />
              <CategoryRows />
            </div>
          )}
          <TheatreControls />
        </>
      )}
    </div>
  )
}
