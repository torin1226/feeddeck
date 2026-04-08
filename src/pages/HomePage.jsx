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
  const { fetchHomepage, heroItem, theatreMode } = useHomeStore()
  const isSFW = useModeStore((s) => s.isSFW)

  // Fetch homepage data on mount and when mode changes
  useEffect(() => {
    fetchHomepage(isSFW ? 'social' : 'nsfw')
  }, [isSFW, fetchHomepage])

  // Pre-warm feed buffer so /feed loads instantly when navigated to
  useEffect(() => {
    const hasIdleCallback = typeof window.requestIdleCallback === 'function'
    const id = hasIdleCallback
      ? window.requestIdleCallback(() => useFeedStore.getState().prefetch())
      : setTimeout(() => useFeedStore.getState().prefetch(), 200)
    return () => {
      if (hasIdleCallback) window.cancelIdleCallback(id)
      else clearTimeout(id)
    }
  }, [])

  const loading = !heroItem

  return (
    <div className="min-h-screen bg-surface text-text-primary font-sans">
      <HomeHeader />

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
            <div className="relative z-10">
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
