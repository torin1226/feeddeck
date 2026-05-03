import { useEffect } from 'react'
import useHomeStore from '../stores/homeStore'
import useModeStore from '../stores/modeStore'
import useFeedStore from '../stores/feedStore'
import useFocusPreview from '../hooks/useFocusPreview'
import HomeHeader from '../components/home/HomeHeader'
import HeroSection from '../components/home/HeroSection'
import HeroCarousel from '../components/home/HeroCarousel'
import GalleryShelf from '../components/home/GalleryShelf'
import BrowseSection from '../components/home/BrowseSection'
import TheatreControls from '../components/home/TheatreControls'
import { SkeletonHero, SkeletonGalleryShelf } from '../components/Skeletons'

// ============================================================
// HomePage
// Main landing page with hero (100vh) and three curated browse
// rows using theatre-size cards with parallax scrolling.
// In theatre mode, BrowseSection is hidden.
// ============================================================

export default function HomePage() {
  const { fetchHomepage, heroItem, theatreMode, fetchError, upNextHidden } = useHomeStore()
  const isSFW = useModeStore((s) => s.isSFW)

  // App-level singleton: subscribe to homeStore.focusedItem and drive
  // the hover-preview lifecycle for the currently-focused card.
  useFocusPreview()

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
          <span>&#9888;</span>
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
          <SkeletonGalleryShelf />
        </>
      ) : (
        <>
          <HeroSection />
          {!theatreMode && (
            <>
              <div className="relative z-content pb-24">
                {upNextHidden && (
                  <div className="pt-6 pb-2">
                    <HeroCarousel />
                  </div>
                )}
                <GalleryShelf />
                <BrowseSection />
              </div>
            </>
          )}
          <TheatreControls />
        </>
      )}
    </div>
  )
}
