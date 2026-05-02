import { create } from 'zustand'
import useModeStore from './modeStore'

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
  // Error message from last failed fetch (null = no error)
  error: null,
  // Whether the feed has been initialized
  initialized: false,
  // Set of watched video IDs this session (prevent repeats)
  watchedIds: new Set(),
  // Whether we've exhausted the feed
  exhausted: false,

  // Feed filters (sources, tags, search)
  filters: { sources: [], tags: [], searchQuery: '' },
  setFilters: (filters) => set({ filters }),

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

  // Desktop feed view preference: 'foryou' | 'remix'
  feedView: 'foryou',
  setFeedView: (view) => {
    set({ feedView: view })
    try { localStorage.setItem('fd-feed-view', view) } catch {}
  },

  // Theatre mode (not persisted — resets each session)
  theatreMode: false,
  setTheatreMode: (val) => set({ theatreMode: val }),
  toggleTheatreMode: () => set(s => ({ theatreMode: !s.theatreMode })),

  // Initialize the feed — fetch first batch (or use prefetched buffer)
  initFeed: async () => {
    const { initialized, loading } = get()
    if (initialized || loading) return
    // Load server-side watched IDs to deduplicate across sessions
    try {
      const watchRes = await fetch('/api/feed/watched-ids')
      if (watchRes.ok) {
        const { ids } = await watchRes.json()
        if (ids?.length > 0) {
          const { watchedIds } = get()
          for (const id of ids) watchedIds.add(id)
        }
      }
    } catch { /* non-fatal — proceed with local watchedIds only */ }
    // If prefetch already loaded videos, just mark as initialized
    if (get().buffer.length > 0) {
      set({ initialized: true })
      return
    }
    set({ loading: true, error: null })
    try {
      const videos = await fetchFeedBatch(get)
      set({ buffer: videos, initialized: true, loading: false, error: null })
      _warmStreamUrls(videos)
    } catch {
      set({ loading: false, initialized: true, error: 'Server unreachable — check that the backend is running' })
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
    // Evict oldest watchedIds to prevent unbounded memory growth
    // (server-side is the persistent source of truth)
    if (watchedIds.size > 5000) {
      const arr = [...watchedIds]
      const keep = arr.slice(arr.length - 2000)
      watchedIds.clear()
      for (const id of keep) watchedIds.add(id)
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
        set(s => {
          const MAX_BUFFER = 200
          const newBuffer = [...s.buffer, ...videos]
          // Evict oldest items if buffer grows too large
          if (newBuffer.length > MAX_BUFFER) {
            const trimCount = newBuffer.length - MAX_BUFFER
            if (trimCount > 0) {
              const newBuf = newBuffer.slice(trimCount)
              return {
                buffer: newBuf,
                currentIndex: Math.max(0, s.currentIndex - trimCount),
                loading: false,
                error: null,
              }
            }
          }
          return { buffer: newBuffer, loading: false, error: null }
        })
        // Eagerly warm stream URLs for newly fetched videos
        _warmStreamUrls(videos)
      }
    } catch {
      set({ loading: false, error: 'Failed to load more videos' })
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
    // Abort any in-flight warm requests
    if (_warmAbortController) _warmAbortController.abort()
    _warmAbortController = new AbortController()
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

// Load feed view preference from localStorage
try {
  const storedView = localStorage.getItem('fd-feed-view')
  if (storedView === 'foryou' || storedView === 'remix') {
    useFeedStore.setState({ feedView: storedView })
  }
} catch {}

// Helper: fetch a batch of feed videos from backend.
// On the FIRST batch (initial buffer empty), interleave a few
// recommendation_trail entries at the top of the feed (~30% cap)
// so videos similar to what the user just watched lead the feed.
// Trail entries are mode-scoped + watched-filtered server-side.
async function fetchFeedBatch(getState) {
  const { watchedIds, buffer, filters } = getState()
  const bufferIds = new Set(buffer.map(v => v.id))
  const mode = useModeStore.getState().isSFW ? 'social' : 'nsfw'

  const params = new URLSearchParams({ mode, count: FETCH_COUNT })
  if (filters.sources?.length > 0) params.set('sources', filters.sources.join(','))
  if (filters.tags?.length > 0) params.set('tags', filters.tags.join(','))

  const res = await fetch(`/api/feed/next?${params}`)
  if (!res.ok) throw new Error('Feed fetch failed')
  const data = await res.json()
  let videos = (data.videos || []).filter(v => !watchedIds.has(v.id) && !bufferIds.has(v.id))

  // Trail injection only fires on the first batch (buffer empty), not
  // on every subsequent fetchMore (those should pull pure feed content).
  if (buffer.length === 0) {
    try {
      const trailRes = await fetch(`/api/recommendations/trail?limit=6&mode=${mode}`)
      if (trailRes.ok) {
        const trailData = await trailRes.json()
        const trail = (trailData?.items || [])
          .filter((t) => t?.url && !bufferIds.has(t.id) && !watchedIds.has(t.id))
          .map((t) => ({
            id: t.id,
            url: t.url,
            title: t.title || '',
            thumbnail: t.thumbnail || '',
            duration: t.duration || 0,
            durationFormatted: t.durationFormatted || '',
            uploader: t.uploader || '',
            tags: t.tags || [],
            _fromTrail: true,
          }))
        if (trail.length > 0) {
          const cap = Math.max(1, Math.floor((videos.length + trail.length) * 0.3))
          const trailToUse = trail.slice(0, cap)
          videos = [...trailToUse, ...videos]
        }
      }
    } catch { /* non-fatal — feed works without trail */ }
  }

  return videos
}

// AbortController for cancelling in-flight warm requests on reset
let _warmAbortController = new AbortController()

// Eagerly resolve stream URLs for videos that don't have one yet.
// Fires requests in parallel (max 3) so they're cached server-side
// by the time the user scrolls to them.
function _warmStreamUrls(videos) {
  const needWarm = videos.filter(v => !v.streamUrl && v.url).slice(0, 5)
  if (needWarm.length === 0) return

  const signal = _warmAbortController.signal
  for (const v of needWarm) {
    fetch(`/api/stream-url?url=${encodeURIComponent(v.url)}`, { signal })
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
