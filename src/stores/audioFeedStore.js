import { create } from 'zustand'

// ============================================================
// Audio Feed Store
// Backs the /audio page. Independent of feedStore because:
//   - different surface (audio, not video)
//   - different ordering (taste_score DESC, not fetched_at DESC)
//   - persistent across route changes (player keeps playing as
//     the user navigates around the app)
//
// See plan: generic-exploring-lampson.md.
// ============================================================

const useAudioFeedStore = create((set, get) => ({
  // Loaded queue of audio items (full /api/audio/feed payload)
  items: [],
  loading: false,
  error: null,

  // Currently active item + playback state
  currentIndex: -1,        // -1 = nothing playing
  isPlaying: false,
  position: 0,             // seconds, updated on timeupdate
  duration: 0,
  audioElementRef: null,   // set by AudioPlayer when it mounts

  // Filters (creator-scoped view of the same items)
  creatorFilter: null,
  sourceFilter: null,
  query: '',

  // Track which items the user has rated locally so the UI updates
  // before the server has refreshed the score.
  localRatings: new Map(), // id → 1 | -1

  // ---------------------------------------------------------
  // Data
  // ---------------------------------------------------------
  // Monotonic token so rapid filter changes (typed search, chip clicks)
  // don't race: a slower fetch landing after a newer one is dropped.
  // Same shape as the eporner polite-fetch race fixed 2026-05-02.
  _loadFeedToken: 0,

  loadFeed: async () => {
    const token = (get()._loadFeedToken || 0) + 1
    set({ loading: true, error: null, _loadFeedToken: token })
    try {
      const { creatorFilter, sourceFilter, query, currentIndex, items: oldItems } = get()
      // Track which track is playing so we can preserve its position
      // across a filter-driven items[] swap. Without this, currentIndex
      // would point at a different track in the new list and the audio
      // element jumps mid-listen.
      const playingId = currentIndex >= 0 ? oldItems[currentIndex]?.id : null

      const params = new URLSearchParams({ limit: '100' })
      if (creatorFilter) params.set('creator', creatorFilter)
      if (sourceFilter) params.set('source', sourceFilter)
      if (query && query.trim()) params.set('q', query.trim())
      const res = await fetch(`/api/audio/feed?${params}`)
      if (token !== get()._loadFeedToken) return
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      const data = await res.json()
      if (token !== get()._loadFeedToken) return

      const newItems = data.items || []
      // If the playing track is still in the filtered list, point at
      // its new index. If not, set to -1 — the player unmounts and
      // playback stops cleanly. (A future change could keep a separate
      // currentItem field so playback continues across filter changes,
      // but the minimum non-buggy behavior is to stop rather than jump.)
      let newCurrentIndex = -1
      if (playingId) {
        const idx = newItems.findIndex(i => i.id === playingId)
        if (idx >= 0) newCurrentIndex = idx
      }
      set({ items: newItems, currentIndex: newCurrentIndex, loading: false })
    } catch (err) {
      if (token === get()._loadFeedToken) {
        set({ error: err.message, loading: false })
      }
    }
  },

  setCreatorFilter: (creator) => {
    set({ creatorFilter: creator })
    get().loadFeed()
  },
  setSourceFilter: (source) => {
    set({ sourceFilter: source })
    get().loadFeed()
  },
  // Search: debounced by the caller (page) since typing into a textbox
  // shouldn't fire a fetch on every keystroke. Tag-pill clicks call this
  // directly with the tag value — no debounce needed for those.
  setQuery: (q) => {
    set({ query: q || '' })
    get().loadFeed()
  },
  clearFilters: () => {
    set({ query: '', creatorFilter: null, sourceFilter: null })
    get().loadFeed()
  },

  // ---------------------------------------------------------
  // Playback control
  // ---------------------------------------------------------
  setAudioElement: (el) => set({ audioElementRef: el }),

  playItem: (item) => {
    const { items } = get()
    const idx = items.findIndex(i => i.id === item.id)
    set({
      currentIndex: idx >= 0 ? idx : -1,
      isPlaying: true,
      position: 0,
    })
    // Mark played server-side (fire and forget)
    fetch(`/api/audio/${item.id}/play`, { method: 'POST' }).catch(() => {})
  },

  pause: () => set({ isPlaying: false }),
  resume: () => set({ isPlaying: true }),
  togglePlay: () => set(s => ({ isPlaying: !s.isPlaying })),

  next: () => {
    const { items, currentIndex } = get()
    if (currentIndex < 0 || currentIndex >= items.length - 1) {
      set({ isPlaying: false })
      return
    }
    set({
      currentIndex: currentIndex + 1,
      isPlaying: true,
      position: 0,
    })
    const nextItem = items[currentIndex + 1]
    if (nextItem) {
      fetch(`/api/audio/${nextItem.id}/play`, { method: 'POST' }).catch(() => {})
    }
  },

  prev: () => {
    const { currentIndex } = get()
    if (currentIndex <= 0) return
    set({
      currentIndex: currentIndex - 1,
      isPlaying: true,
      position: 0,
    })
  },

  setPosition: (t) => set({ position: t }),
  setDuration: (d) => set({ duration: d }),

  seek: (t) => {
    const { audioElementRef } = get()
    if (audioElementRef) {
      audioElementRef.currentTime = t
    }
    set({ position: t })
  },

  // ---------------------------------------------------------
  // Rating
  // ---------------------------------------------------------
  rateCurrent: async (rating) => {
    const { items, currentIndex, localRatings, next } = get()
    const item = items[currentIndex]
    if (!item) return
    const newLocal = new Map(localRatings)
    newLocal.set(item.id, rating === 'up' ? 1 : -1)
    set({ localRatings: newLocal })

    try {
      const res = await fetch(`/api/audio/${item.id}/rate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating }),
      })
      // Roll back on HTTP errors too, not just thrown errors. fetch()
      // resolves for 4xx/5xx — without this check, a 500 from the route
      // leaves the optimistic UI in place even though the server never
      // recorded the rating. Same shape as the 2026-05-09 stream wallclock
      // fix that distinguished "fetch resolved" from "fetch succeeded."
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    } catch (err) {
      const rolled = new Map(get().localRatings)
      rolled.delete(item.id)
      set({ localRatings: rolled, error: err.message })
      return
    }
    // Down-vote auto-advances to the next item; up-vote stays put so the
    // user can keep listening.
    if (rating === 'down') next()
  },

  // ---------------------------------------------------------
  // Lifecycle (called from AudioPlayer ended/error handlers)
  // ---------------------------------------------------------
  // Natural end-of-track: mark complete and advance. watched=1 sinks the
  // track in future feed orderings.
  onEnded: async () => {
    const { items, currentIndex, next } = get()
    const item = items[currentIndex]
    if (item) {
      try {
        await fetch(`/api/audio/${item.id}/complete`, { method: 'POST' })
      } catch {}
    }
    next()
  },

  // Playback error: advance to the next track WITHOUT marking complete.
  // Same asymmetric shape as the useHeroAutoplay 2026-05-16 fix
  // (`956c8de`): a track that failed to play (404, stale CDN URL,
  // network blip) should not be marked watched, because the track may
  // resolve fine on a future refresh. Marking watched would sink it
  // permanently from the feed even though nothing is genuinely wrong.
  onPlaybackError: () => {
    get().next()
  },
}))

export default useAudioFeedStore
