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
  const fetchHomepage = useHomeStore(s => s.fetchHomepage)
  const heroItem = useHomeStore(s => s.heroItem)
  const theatreMode = useHomeStore(s => s.theatreMode)
  const isSFW = useModeStore((s) => s.isSFW)

  // Fetch homepage data on mount and when mode changes.
  // Don't reset before fetching — keep showing current content until new data arrives.
  // This prevents the jarring flash-to-skeletons on mode switch.
  useEffect(() => {
    const mode = isSFW ? 'social' : 'nsfw'
    fetchHomepage(mode)
  }, [isSFW, fetchHomepage])

  // Pre-warm feed buffer so /feed loads instantly when navigated to
  useEffect(() => {
    const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 200))
    idle(() => useFeedStore.getState().prefetch())
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
