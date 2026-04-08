import { useState, useEffect, useCallback, useMemo } from 'react'
import useFeedStore from '../../stores/feedStore'
import RemixHero from './RemixHero'
import RemixCarousel from './RemixCarousel'

// Seeded shuffle (Fisher-Yates with simple hash seed for stability within session)
function seededShuffle(arr, seed = 0) {
  const a = [...arr]
  let s = seed
  const next = () => { s = (s * 1664525 + 1013904223) & 0x7fffffff; return s / 0x7fffffff }
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Session-stable seed (changes daily, not on every render)
const SESSION_SEED = Math.floor(Date.now() / 86400000)

// Build categories that feel distinct from ForYou's sequential order.
// Remix prioritizes discovery and variety over algorithmic ranking.
function buildCategories(buffer) {
  const bySource = {}

  for (const video of buffer) {
    const src = video.source || 'Other'
    if (!bySource[src]) bySource[src] = []
    bySource[src].push(video)
  }

  const categories = []

  // "Discovery" — videos from the back half of the buffer (lower-ranked by algorithm,
  // so these are things ForYou wouldn't surface prominently)
  const backHalf = buffer.slice(Math.floor(buffer.length / 2))
  if (backHalf.length > 0) {
    categories.push({ id: 'discovery', label: 'Discovery', videos: seededShuffle(backHalf, SESSION_SEED).slice(0, 20) })
  }

  // Per-source categories, seeded shuffle for variety
  const sourceEntries = Object.entries(bySource).sort((a, b) => b[1].length - a[1].length)
  for (const [source, videos] of sourceEntries) {
    if (videos.length >= 2) {
      categories.push({ id: source, label: source, videos: seededShuffle(videos, SESSION_SEED + source.length).slice(0, 15) })
    }
  }

  // "Mix" — reverse-order seeded shuffle of all content (opposite end from ForYou)
  const reversed = [...buffer].reverse()
  categories.push({ id: 'mix', label: 'Mix', videos: seededShuffle(reversed, SESSION_SEED + 42).slice(0, 20) })

  return categories
}

export default function RemixFeed() {
  const buffer = useFeedStore(s => s.buffer)
  const initFeed = useFeedStore(s => s.initFeed)
  const loading = useFeedStore(s => s.loading)
  const initialized = useFeedStore(s => s.initialized)
  const feedError = useFeedStore(s => s.error)

  const [activeVideo, setActiveVideo] = useState(null)
  const [activeCategoryIdx, setActiveCategoryIdx] = useState(0)

  useEffect(() => { initFeed() }, [initFeed])

  // Set initial active video when buffer loads
  useEffect(() => {
    if (buffer.length > 0 && !activeVideo) {
      setActiveVideo(buffer[0])
    }
  }, [buffer, activeVideo])

  const categories = useMemo(() => buildCategories(buffer), [buffer])

  const handleFocusVideo = useCallback((video) => {
    if (video.id !== activeVideo?.id) {
      setActiveVideo(video)
    }
  }, [activeVideo?.id])

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight') {
        const cat = categories[activeCategoryIdx]
        if (!cat) return
        const idx = cat.videos.findIndex(v => v.id === activeVideo?.id)
        if (idx < cat.videos.length - 1) handleFocusVideo(cat.videos[idx + 1])
      } else if (e.key === 'ArrowLeft') {
        const cat = categories[activeCategoryIdx]
        if (!cat) return
        const idx = cat.videos.findIndex(v => v.id === activeVideo?.id)
        if (idx > 0) handleFocusVideo(cat.videos[idx - 1])
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        const next = Math.min(activeCategoryIdx + 1, categories.length - 1)
        if (next !== activeCategoryIdx) {
          setActiveCategoryIdx(next)
          if (categories[next]?.videos[0]) handleFocusVideo(categories[next].videos[0])
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        const prev = Math.max(activeCategoryIdx - 1, 0)
        if (prev !== activeCategoryIdx) {
          setActiveCategoryIdx(prev)
          if (categories[prev]?.videos[0]) handleFocusVideo(categories[prev].videos[0])
        }
      } else if (e.key === ' ') {
        e.preventDefault()
        // play/pause handled by hero
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [categories, activeCategoryIdx, activeVideo?.id, handleFocusVideo])

  if (!initialized && loading) {
    return (
      <div className="h-dvh w-full bg-black flex items-center justify-center">
        <div className="w-10 h-10 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" />
      </div>
    )
  }

  if (initialized && feedError && buffer.length === 0) {
    return (
      <div className="h-dvh w-full bg-black flex flex-col items-center justify-center gap-3">
        <div className="text-2xl">⚠</div>
        <div className="text-white/50 text-sm">{feedError}</div>
        <button
          onClick={() => { useFeedStore.getState().resetFeed(); setTimeout(() => initFeed(), 100) }}
          className="mt-2 px-5 py-2 rounded-full bg-accent text-white text-sm font-medium active:scale-95 transition-transform"
        >
          Retry
        </button>
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
    <div className="relative w-full bg-black overflow-hidden select-none" style={{ height: '100dvh' }}>
      <RemixHero video={activeVideo} />
      <RemixCarousel
        categories={categories}
        activeCategoryIdx={activeCategoryIdx}
        setActiveCategoryIdx={setActiveCategoryIdx}
        focusedVideoId={activeVideo?.id}
        onFocusVideo={handleFocusVideo}
      />
    </div>
  )
}
