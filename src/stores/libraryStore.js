import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import useModeStore from './modeStore'
import { safeStorage } from './safeStorage'
import { inferMode } from '../utils/mode'

// ============================================================
// Library Store
// Manages the video library — adding, removing, filtering.
// Persists to localStorage so library survives page refresh.
// Backend sync added later.
// ============================================================

const useLibraryStore = create(
  persist(
    (set) => ({
      // State
      videos: [],
      loading: false,
      error: null,

      // -----------------------------------------------------------
      // Add a video to the library (from URL submission).
      // Mode is derived from the URL via inferMode() so the firewall
      // can filter cross-mode entries on read.
      // -----------------------------------------------------------
      addVideo: (video) => {
        const url = video.url || ''
        set((state) => ({
          videos: [
            {
              id: video.id || crypto.randomUUID(),
              url,
              title: video.title || 'Untitled',
              thumbnail: video.thumbnail || '',
              duration: video.duration || 0,
              durationFormatted: video.durationFormatted || '0:00',
              tags: video.tags || [],
              source: video.source || 'unknown',
              mode: video.mode || inferMode(url || video.source),
              addedAt: new Date().toISOString(),
              lastWatched: null,
              watchCount: 0,
              rating: null,
              favorite: false,
              watchLater: false,
              views: video.views || '',
              channel: video.channel || '',
            },
            ...state.videos,
          ],
        }))
      },

      // -----------------------------------------------------------
      // Remove a video by ID
      // -----------------------------------------------------------
      removeVideo: (id) => {
        set((state) => ({
          videos: state.videos.filter((v) => v.id !== id),
        }))
      },

      // -----------------------------------------------------------
      // Toggle favorite (optimistic local + server sync)
      // -----------------------------------------------------------
      toggleFavorite: (id) => {
        set((state) => ({
          videos: state.videos.map((v) =>
            v.id === id ? { ...v, favorite: !v.favorite } : v
          ),
        }))
        fetch(`/api/videos/${id}/favorite`, { method: 'PUT' }).catch(() => {})
      },

      // -----------------------------------------------------------
      // Set rating (1-5) — optimistic local + server sync
      // -----------------------------------------------------------
      setRating: (id, rating) => {
        set((state) => ({
          videos: state.videos.map((v) =>
            v.id === id ? { ...v, rating } : v
          ),
        }))
        fetch(`/api/videos/${id}/rating`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rating }),
        }).catch(() => {})
      },

      // -----------------------------------------------------------
      // Toggle watch later — optimistic local + server sync
      // -----------------------------------------------------------
      toggleWatchLater: (id) => {
        set((state) => ({
          videos: state.videos.map((v) =>
            v.id === id ? { ...v, watchLater: !v.watchLater } : v
          ),
        }))
        fetch(`/api/videos/${id}/watch-later`, { method: 'PUT' }).catch(() => {})
      },

      // -----------------------------------------------------------
      // Mark as watched
      // -----------------------------------------------------------
      markWatched: (id) => {
        set((state) => ({
          videos: state.videos.map((v) =>
            v.id === id
              ? { ...v, lastWatched: new Date().toISOString(), watchCount: v.watchCount + 1 }
              : v
          ),
        }))
      },

      // -----------------------------------------------------------
      // Update watch progress (0-1 fraction) for resume support
      // -----------------------------------------------------------
      setWatchProgress: (id, progress) => {
        set((state) => ({
          videos: state.videos.map((v) =>
            v.id === id ? { ...v, watchProgress: progress } : v
          ),
        }))
      },

      // -----------------------------------------------------------
      // Load from server. Mode-scoped: only returns videos for the
      // currently active mode. Replacing videos with the server set
      // also discards stale cross-mode entries that might have been
      // persisted before the firewall existed.
      // -----------------------------------------------------------
      loadFromServer: async () => {
        set({ loading: true })
        try {
          const mode = useModeStore.getState().isSFW ? 'social' : 'nsfw'
          const res = await fetch(`/api/videos?mode=${mode}`)
          if (res.ok) {
            const data = await res.json()
            if (data.videos?.length) {
              // Tag each row with mode so render-time guards can confirm.
              const tagged = data.videos.map(v => ({ ...v, mode: v.mode || mode }))
              set({ videos: tagged })
            }
          }
        } catch {
          // Server not running yet — that's fine, use localStorage
        } finally {
          set({ loading: false })
        }
      },

      // -----------------------------------------------------------
      // Clear all library entries. Called by nuclearFlush on mode switch.
      // The persisted localStorage copy is overwritten with an empty list,
      // preventing pre-firewall (untagged) entries from re-appearing.
      // -----------------------------------------------------------
      clearLibrary: () => set({ videos: [] }),

      // -----------------------------------------------------------
      // Seed demo data (so the app isn't empty on first load)
      // -----------------------------------------------------------
      seedDemoData: () => {
        const demoVideos = Array.from({ length: 12 }, (_, i) => ({
          id: `demo-${i + 1}`,
          url: '',
          title: `Sample Video ${i + 1}`,
          thumbnail: '',
          duration: 60 + Math.floor(Math.random() * 300),
          durationFormatted: `${Math.floor((60 + i * 30) / 60)}:${String((60 + i * 30) % 60).padStart(2, '0')}`,
          tags: ['sample'],
          source: 'demo',
          addedAt: new Date(Date.now() - i * 86400000).toISOString(),
          lastWatched: null,
          watchCount: 0,
          rating: null,
          favorite: false,
          views: `${Math.floor(Math.random() * 900 + 100)}K views`,
          channel: 'Demo',
        }))
        set({ videos: demoVideos })
      },
    }),
    {
      name: 'fd-lib',
      storage: safeStorage,
    }
  )
)

export default useLibraryStore
