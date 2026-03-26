import { useRef, useEffect, useCallback } from 'react'
import useFeedStore from '../../stores/feedStore'
import ForYouSlot from './ForYouSlot'

export default function ForYouFeed() {
  const containerRef = useRef(null)
  const buffer = useFeedStore(s => s.buffer)
  const currentIndex = useFeedStore(s => s.currentIndex)
  const setCurrentIndex = useFeedStore(s => s.setCurrentIndex)
  const initFeed = useFeedStore(s => s.initFeed)
  const loading = useFeedStore(s => s.loading)
  const initialized = useFeedStore(s => s.initialized)
  const theatreMode = useFeedStore(s => s.theatreMode)

  // Init feed on mount
  useEffect(() => { initFeed() }, [initFeed])

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

  // Keyboard: left/right navigate (only when NOT in theatre mode — theatre handles its own keys)
  useEffect(() => {
    if (theatreMode) return
    const onKey = (e) => {
      const el = containerRef.current
      if (!el) return
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        const next = Math.min(currentIndex + 1, buffer.length - 1)
        el.children[next]?.scrollIntoView({ behavior: 'smooth', inline: 'start' })
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        const prev = Math.max(currentIndex - 1, 0)
        el.children[prev]?.scrollIntoView({ behavior: 'smooth', inline: 'start' })
      } else if (e.key === ' ') {
        e.preventDefault()
        // Play/pause handled by slot
      } else if (e.key === 't' || e.key === 'T') {
        useFeedStore.getState().setTheatreMode(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [theatreMode, currentIndex, buffer.length])

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
        />
      ))}
    </div>
  )
}
