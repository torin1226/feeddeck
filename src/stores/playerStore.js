import { create } from 'zustand'

// ============================================================
// Player Store
// Shared active video state across hero, carousel, and queue.
// Bridges homeStore (what's displayed) with actual playback.
// ============================================================

const usePlayerStore = create((set, get) => ({
  // Currently playing/selected video
  activeVideo: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,

  // Stream URL resolved from backend
  streamUrl: null,
  streamLoading: false,
  streamError: null,

  // Actions
  setActiveVideo: (video) => set({
    activeVideo: video,
    streamUrl: null,
    streamError: null,
    currentTime: 0,
    isPlaying: false,
  }),

  setPlaying: (playing) => set({ isPlaying: playing }),
  setCurrentTime: (t) => set({ currentTime: t }),
  setDuration: (d) => set({ duration: d }),

  // Resolve a stream URL for the active video via the backend
  // retryCount tracks auto-refresh attempts for stale URLs
  resolveStream: async (videoUrl, retryCount = 0) => {
    if (!videoUrl) return
    set({ streamLoading: true, streamError: null })
    try {
      const res = await fetch(`/api/stream-url?url=${encodeURIComponent(videoUrl)}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const msg = body.error || `${res.status} ${res.statusText}`
        throw new Error(msg)
      }
      const data = await res.json()
      set({ streamUrl: data.streamUrl, streamLoading: false })
    } catch (err) {
      set({ streamError: err.message, streamLoading: false })
    }
  },

  // Called when the video element fires an error (e.g. stale/expired CDN URL)
  // Auto-retries once by re-resolving the stream URL
  handleStreamError: () => {
    const { activeVideo, streamUrl } = get()
    if (!activeVideo?.url || !streamUrl) return
    // Only retry once to avoid infinite loops
    set({ streamUrl: null, streamError: null })
    get().resolveStream(activeVideo.url)
  },

  clear: () => set({
    activeVideo: null,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    streamUrl: null,
    streamLoading: false,
    streamError: null,
  }),
}))

export default usePlayerStore
