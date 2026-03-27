import { useState, useEffect, useCallback, useMemo } from 'react'
import useFeedStore from '../../stores/feedStore'
import RemixHero from './RemixHero'
import RemixCarousel from './RemixCarousel'

// Stable shuffle using video ids as seed (deterministic per session, different from ForYou order)
function shuffled(arr) {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    // Simple hash from id for deterministic but different ordering
    const hash = (copy[i].id || '').split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0)
    const j = ((hash >>> 0) % (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

// Group videos into categories by source
function buildCategories(buffer) {
  const bySource = {}

  for (const video of buffer) {
    const src = video.source || 'Other'
    if (!bySource[src]) bySource[src] = []
    bySource[src].push(video)
  }

  // "All" category: shuffled so Remix order differs from ForYou sequential order
  const categories = [{ id: 'all', label: 'All', videos: shuffled(buffer).slice(0, 20) }]

  // Per-source categories
  for (const [source, videos] of Object.entries(bySource)) {
    if (videos.length >= 2) {
      categories.push({ id: source, label: source, videos: videos.slice(0, 15) })
    }
  }

  return categories
}

export default function RemixFeed() {
  const buffer = useFeedStore(s => s.buffer)
  const initFeed = useFeedStore(s => s.initFeed)
  const loading = useFeedStore(s => s.loading)
  const initialized = useFeedStore(s => s.initialized)

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

  if (initialized && buffer.length === 0) {
    return (
      <div className="h-dvh w-full bg-black flex items-center justify-center">
        <div className="text-white/50 text-sm">No videos in feed</div>
      </div>
    )
  }

  return (
    <div className="relative w-full bg-black overflow-hidden select-none" style={{ height: '100vh' }}>
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
