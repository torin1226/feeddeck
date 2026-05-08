import { create } from 'zustand'
import useModeStore from './modeStore'
import useHomeStore from './homeStore'

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

  // Initialize the feed — fetch first batch (or use prefetched buffer).
  //
  // We deliberately do NOT call any cross-session "watched IDs" endpoint:
  // /api/feed/next already filters server-side via `WHERE watched = 0`,
  // so the returned batch is already deduplicated. A previous version of
  // this method awaited /api/feed/watched-ids (which never existed) and
  // hung the entire init for ~30s before any video could play.
  initFeed: async () => {
    const { initialized, loading } = get()
    if (initialized || loading) return
    // If prefetch already loaded videos, just mark as initialized
    if (get().buffer.length > 0) {
      set({ initialized: true })
      // Buffer was populated by prefetch() which already kicked off
      // _warmStreamUrls — no need to re-warm.
      return
    }
    set({ loading: true, error: null })
    try {
      const videos = await fetchFeedBatch(get)
      set({ buffer: videos, initialized: true, loading: false, error: null })
      _warmStreamUrls(videos)
      _prefetchVideoBytes(videos)
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

  // Exclude homepage-exposed IDs so feed never duplicates what the user
  // already saw on the homepage this session.
  const exposedIds = useHomeStore.getState().exposedItemIds
  if (exposedIds?.size > 0) params.set('excludeIds', [...exposedIds].join(','))

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

// Module-level URL-resolve promise cache. Both _warmStreamUrls and
// FeedVideo's on-demand fetch dedupe through this so a video URL is
// resolved exactly once per "needs URL" event, regardless of how many
// callers want it. Without this, the active slot's eager fetch races
// the warmer and the browser ends up with two parallel /api/stream-url
// requests waiting on the same yt-dlp call.
const _streamUrlPromises = new Map()

// Public: shared resolver. Returns the streamUrl or null on failure.
// Survives focus changes — never aborts in-flight on reset() either,
// because the cached result helps the next mount.
export function resolveStreamUrl(sourceUrl) {
  if (!sourceUrl) return Promise.resolve(null)
  const cached = _streamUrlPromises.get(sourceUrl)
  if (cached) return cached
  const p = fetch(`/api/stream-url?url=${encodeURIComponent(sourceUrl)}`)
    .then(r => r.ok ? r.json() : null)
    .then(data => data?.streamUrl || null)
    .catch(() => null)
    .finally(() => {
      // Hold the resolved entry briefly so a re-mount within ~5s reuses
      // it; drop it after to avoid serving stale CDN URLs that 2-hour
      // server-side feed_cache will refresh anyway.
      setTimeout(() => _streamUrlPromises.delete(sourceUrl), 5000)
    })
  _streamUrlPromises.set(sourceUrl, p)
  return p
}

// Eagerly resolve stream URLs for videos that don't have one yet, then
// kick off a small Range prefetch on each so the first ~512KB of bytes
// land in the browser HTTP cache before the video element ever asks for
// them. The combination is what lets the active slot start playback
// in <500ms instead of the 8-30s the cold path takes.
function _warmStreamUrls(videos) {
  const needWarm = videos.filter(v => !v.streamUrl && v.url).slice(0, 5)
  if (needWarm.length === 0) return

  for (const v of needWarm) {
    resolveStreamUrl(v.url).then(streamUrl => {
      if (!streamUrl) return
      // Patch the buffer so FeedVideo can pick it up via prop change.
      const state = useFeedStore.getState()
      const idx = state.buffer.findIndex(b => b.id === v.id)
      if (idx !== -1) {
        const updated = [...state.buffer]
        updated[idx] = { ...updated[idx], streamUrl }
        useFeedStore.setState({ buffer: updated })
      }
      _prefetchOneVideoBytes(streamUrl)
    })
  }
}

// Module-level set tracking which streamUrls already had bytes warmed.
// Bounded so a long session doesn't grow this without limit.
const _bytesWarmed = new Set()
const _BYTES_WARMED_CAP = 50

// Range-prefetch the first ~512KB of bytes for a single resolved
// streamUrl. The browser caches the 206 response keyed by URL+Range,
// so when the <video> element later issues its own initial Range
// request the bytes are already local. HLS manifests are tiny — we
// just fetch them whole. Aborts if already prefetched or the URL
// is missing.
function _prefetchOneVideoBytes(streamUrl) {
  if (!streamUrl) return
  if (_bytesWarmed.has(streamUrl)) return
  _bytesWarmed.add(streamUrl)
  while (_bytesWarmed.size > _BYTES_WARMED_CAP) {
    _bytesWarmed.delete(_bytesWarmed.values().next().value)
  }
  const signal = _warmAbortController.signal
  const isHls = streamUrl.includes('.m3u8')
  const target = isHls
    ? `/api/hls-proxy?url=${encodeURIComponent(streamUrl)}`
    : `/api/proxy-stream?url=${encodeURIComponent(streamUrl)}`
  const headers = isHls ? {} : { Range: 'bytes=0-524287' }
  // Fire-and-forget — we only care that the bytes hit the cache.
  fetch(target, { signal, headers }).then(r => {
    if (!isHls && r.body) {
      // Drain the response so the browser actually caches it.
      const reader = r.body.getReader()
      const pump = () => reader.read().then(({ done }) => {
        if (!done) return pump()
      }).catch(() => {})
      pump()
    }
  }).catch(() => {})
}

// Iterate over a freshly-fetched batch and bytes-prefetch any video
// that already arrived with a server-resolved streamUrl. Videos that
// still need URL resolution will get their bytes prefetched after
// _warmStreamUrls finishes (see _warmStreamUrls's per-item callback).
function _prefetchVideoBytes(videos) {
  for (const v of videos.slice(0, 3)) {
    if (v.streamUrl) _prefetchOneVideoBytes(v.streamUrl)
  }
}

// Test helper — clears the URL promise cache and bytes set so unit
// tests can assert behavior without prior-test pollution.
export function _resetForTests() {
  _streamUrlPromises.clear()
  _bytesWarmed.clear()
}

export default useFeedStore
