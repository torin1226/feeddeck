import { useRef, useEffect, useCallback, useState } from 'react'
import useFeedStore from '../../stores/feedStore'
import ForYouSlot from './ForYouSlot'
import TheatreOverlay from './TheatreOverlay'
import TheatreTimeline from './TheatreTimeline'
import NextUpDialog from './NextUpDialog'

export default function ForYouFeed() {
  const containerRef = useRef(null)
  const activeVideoRef = useRef(null)
  const [nextUpVisible, setNextUpVisible] = useState(false)

  const buffer = useFeedStore(s => s.buffer)
  const currentIndex = useFeedStore(s => s.currentIndex)
  const setCurrentIndex = useFeedStore(s => s.setCurrentIndex)
  const initFeed = useFeedStore(s => s.initFeed)
  const loading = useFeedStore(s => s.loading)
  const initialized = useFeedStore(s => s.initialized)
  const theatreMode = useFeedStore(s => s.theatreMode)

  const nextVideo = buffer[currentIndex + 1] || null

  // Init feed on mount
  useEffect(() => { initFeed() }, [initFeed])

  // Theatre mode — toggle body class so header can hide itself
  useEffect(() => {
    if (theatreMode) {
      document.body.classList.add('theatre-active')
    } else {
      document.body.classList.remove('theatre-active')
    }
    return () => document.body.classList.remove('theatre-active')
  }, [theatreMode])

  // Wheel → horizontal scroll (map deltaY to scrollLeft)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e) => {
      e.preventDefault()
      el.scrollLeft += e.deltaY + e.deltaX
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // IntersectionObserver for active slot detection
  useEffect(() => {
    const el = containerRef.current
    if (!el || buffer.length === 0) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
            const idx = Number(entry.target.dataset.slotIndex)
            if (!isNaN(idx)) setCurrentIndex(idx)
          }
        }
      },
      { root: el, threshold: 0.5 }
    )
    el.querySelectorAll('[data-slot-index]').forEach(slot => observer.observe(slot))
    return () => observer.disconnect()
  }, [buffer.length, setCurrentIndex])

  // Scroll to current index when it changes (keyboard/programmatic navigation)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.children[currentIndex]?.scrollIntoView({ behavior: 'smooth', inline: 'start' })
  }, [currentIndex])

  // Receive active video element from the active slot
  const handleVideoRef = useCallback((el) => {
    activeVideoRef.current = el
  }, [])

  // Advance to the next video slot (used by NextUpDialog)
  const advanceToNext = useCallback(() => {
    const { currentIndex: idx, buffer: buf } = useFeedStore.getState()
    if (idx < buf.length - 1) {
      const next = idx + 1
      containerRef.current?.children[next]?.scrollIntoView({ behavior: 'smooth', inline: 'start' })
    }
  }, [])

  if (!initialized && loading) {
    return (
      <div className="h-dvh w-full bg-black flex items-center justify-center">
        <div className="w-10 h-10 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" />
      </div>
    )
  }

  if (initialized && buffer.length === 0) {
    return (
      <div className="h-dvh w-full bg-black flex items-center justify-center">
        <div className="text-white/50 text-sm">No videos in feed</div>
      </div>
    )
  }

  return (
    <div className="relative h-dvh w-full">
      {/* Horizontal scroll container */}
      <div
        ref={containerRef}
        className="h-dvh w-full overflow-x-scroll snap-x snap-mandatory flex bg-black scrollbar-none"
      >
        {buffer.map((video, idx) => (
          <ForYouSlot
            key={`${video.id}-${idx}`}
            video={video}
            index={idx}
            isActive={idx === currentIndex}
            onVideoRef={idx === currentIndex ? handleVideoRef : undefined}
          />
        ))}
      </div>

      {/* Overlays — always rendered so hover controls, timeline, and NextUp work */}
      <TheatreOverlay videoRef={activeVideoRef} />
      <TheatreTimeline videoRef={activeVideoRef} nextUpVisible={nextUpVisible} />
      <NextUpDialog
        videoRef={activeVideoRef}
        nextVideo={nextVideo}
        onAdvance={advanceToNext}
      />
    </div>
  )
}
