import { create } from 'zustand'

// ============================================================
// Feed Store
// State for the vertical swipe feed (/feed route).
// Manages video buffer, current index, loading, and preferences.
// ============================================================

const BUFFER_THRESHOLD = 5 // fetch more when this many from end
const FETCH_COUNT = 10

const useFeedStore = create((set, get) => ({
  // Feed buffer — array of video objects
  buffer: [],
  // Current index in the buffer (which video is snapped/visible)
  currentIndex: 0,
  // Loading state
  loading: false,
  // Whether the feed has been initialized
  initialized: false,
  // Set of watched video IDs this session (prevent repeats)
  watchedIds: new Set(),
  // Whether we've exhausted the feed
  exhausted: false,

  // User preferences
  letterbox: false, // false = center-crop (cover), true = letterbox (contain)
  muted: true, // global mute state — persists across videos
  setMuted: (val) => set({ muted: val }),
  // Immersive mode: hides overlay/nav, tap to temporarily reveal
  immersive: false,
  overlayVisible: true, // temporarily shown during immersive mode
  toggleImmersive: () => set(s => ({
    immersive: !s.immersive,
    overlayVisible: !s.immersive ? false : true, // entering = hide, exiting = show
  })),
  flashOverlay: () => set({ overlayVisible: true }), // called on tap in immersive mode

  // Initialize the feed — fetch first batch (or use prefetched buffer)
  initFeed: async () => {
    const { initialized, loading, buffer } = get()
    if (initialized || loading) return
    // If prefetch already loaded videos, just mark as initialized
    if (buffer.length > 0) {
      set({ initialized: true })
      return
    }
    set({ loading: true })
    try {
      const videos = await fetchFeedBatch(get)
      set({ buffer: videos, initialized: true, loading: false })
      _warmStreamUrls(videos)
    } catch {
      set({ loading: false })
    }
  },

  // Set current index (called when scroll snaps to a video)
  setCurrentIndex: (idx) => {
    const { buffer, watchedIds } = get()
    const video = buffer[idx]
    if (video && !watchedIds.has(video.id)) {
      watchedIds.add(video.id)
      // Fire-and-forget: mark as watched on backend
      fetch(`/api/feed/watched?id=${encodeURIComponent(video.id)}`, { method: 'POST' }).catch(() => {})
    }
    set({ currentIndex: idx })

    // Check if we need to fetch more
    const remaining = buffer.length - idx
    if (remaining <= BUFFER_THRESHOLD) {
      get().fetchMore()
    }
  },

  // Fetch more videos and append to buffer
  fetchMore: async () => {
    const { loading, exhausted } = get()
    if (loading || exhausted) return
    set({ loading: true })
    try {
      const videos = await fetchFeedBatch(get)
      if (videos.length === 0) {
        set({ exhausted: true, loading: false })
      } else {
        set(s => ({ buffer: [...s.buffer, ...videos], loading: false }))
        // Eagerly warm stream URLs for newly fetched videos
        _warmStreamUrls(videos)
      }
    } catch {
      set({ loading: false })
    }
  },

  // Toggle letterbox preference
  toggleLetterbox: () => {
    set(s => {
      const next = !s.letterbox
      try { localStorage.setItem('fd-feed-letterbox', JSON.stringify(next)) } catch {}
      return { letterbox: next }
    })
  },

  // Prefetch: silently load the first batch into buffer so feed page loads instantly
  prefetch: async () => {
    const { initialized, loading, buffer } = get()
    if (initialized || loading || buffer.length > 0) return
    try {
      const videos = await fetchFeedBatch(get)
      if (videos.length > 0) {
        set({ buffer: videos })
        // Eagerly warm stream URLs for videos missing them
        _warmStreamUrls(videos)
      }
    } catch { /* silent — user hasn't navigated to feed yet */ }
  },

  // Reset feed (e.g. on mode change)
  resetFeed: () => {
    set({
      buffer: [],
      currentIndex: 0,
      initialized: false,
      exhausted: false,
      watchedIds: new Set(),
    })
  },
}))

// Load letterbox preference from localStorage
try {
  const stored = localStorage.getItem('fd-feed-letterbox')
  if (stored !== null) {
    useFeedStore.setState({ letterbox: JSON.parse(stored) })
  }
} catch {}

// Helper: fetch a batch of feed videos from backend
async function fetchFeedBatch(getState) {
  const { watchedIds, buffer } = getState()
  const bufferIds = new Set(buffer.map(v => v.id))
  const mode = (await import('./modeStore.js')).default.getState().isSFW ? 'social' : 'nsfw'
  const res = await fetch(`/api/feed/next?mode=${mode}&count=${FETCH_COUNT}`)
  if (!res.ok) throw new Error('Feed fetch failed')
  const data = await res.json()
  // Filter out already-watched and already-buffered videos
  return (data.videos || []).filter(v => !watchedIds.has(v.id) && !bufferIds.has(v.id))
}

// Eagerly resolve stream URLs for videos that don't have one yet.
// Fires requests in parallel (max 3) so they're cached server-side
// by the time the user scrolls to them.
function _warmStreamUrls(videos) {
  const needWarm = videos.filter(v => !v.streamUrl && v.url).slice(0, 5)
  if (needWarm.length === 0) return

  for (const v of needWarm) {
    fetch(`/api/stream-url?url=${encodeURIComponent(v.url)}`)
      .then(r => r.json())
      .then(data => {
        if (data.streamUrl) {
          // Update the video in the buffer so FeedVideo picks it up
          const state = useFeedStore.getState()
          const idx = state.buffer.findIndex(b => b.id === v.id)
          if (idx !== -1) {
            const updated = [...state.buffer]
            updated[idx] = { ...updated[idx], streamUrl: data.streamUrl }
            useFeedStore.setState({ buffer: updated })
          }
        }
      })
      .catch(() => {}) // silent — video will still resolve on-demand
  }
}

export default useFeedStore
