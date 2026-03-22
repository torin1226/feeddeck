import { create } from 'zustand'

// ============================================================
// Queue Store (Server-Backed)
// Manages the play-next queue. All mutations hit the API first,
// then update local state from the server response. Polling
// (useQueueSync hook) keeps multiple clients in sync.
// ============================================================

const API = '/api'

// Normalize server queue items to include `url` (alias of `video_url`)
// and `durationFormatted` (alias of `duration_formatted`) for backwards compat
function normalizeItem(item) {
  return { ...item, url: item.video_url || item.url, durationFormatted: item.duration_formatted || item.durationFormatted }
}
function normalizeQueue(items) {
  return (items || []).map(normalizeItem)
}

const useQueueStore = create((set, get) => ({
  // State
  queue: [],          // Array of { id, position, video_url, title, thumbnail, duration, duration_formatted }
  currentIndex: -1,   // Which queue item is playing (-1 = none)
  online: true,       // Server reachable?
  lastSynced: null,   // Timestamp of last successful sync

  // -----------------------------------------------------------
  // Fetch queue from server (used by polling hook and on init)
  // -----------------------------------------------------------
  fetchQueue: async () => {
    try {
      const res = await fetch(`${API}/queue`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const serverQueue = normalizeQueue(data.queue)

      set((state) => {
        // Preserve currentIndex if the queue item still exists
        let newIndex = state.currentIndex
        if (newIndex >= 0 && newIndex < state.queue.length) {
          const currentId = state.queue[newIndex]?.id
          const newPos = serverQueue.findIndex(item => item.id === currentId)
          newIndex = newPos >= 0 ? newPos : -1
        }
        return {
          queue: serverQueue,
          currentIndex: newIndex >= serverQueue.length ? -1 : newIndex,
          online: true,
          lastSynced: Date.now(),
        }
      })
      return true
    } catch {
      set({ online: false })
      return false
    }
  },

  // -----------------------------------------------------------
  // Add a video to the end of the queue
  // -----------------------------------------------------------
  addToQueue: async (video) => {
    try {
      const res = await fetch(`${API}/queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_url: video.url || video.video_url,
          title: video.title,
          thumbnail: video.thumbnail,
          duration: video.duration,
          duration_formatted: video.durationFormatted || video.duration_formatted || '0:00',
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      set({ queue: normalizeQueue(data.queue), online: true, lastSynced: Date.now() })
    } catch {
      set({ online: false })
    }
  },

  // -----------------------------------------------------------
  // Insert a video right after the currently playing item
  // -----------------------------------------------------------
  insertNext: async (video) => {
    const { currentIndex } = get()
    const insertPos = currentIndex + 1

    try {
      const res = await fetch(`${API}/queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_url: video.url || video.video_url,
          title: video.title,
          thumbnail: video.thumbnail,
          duration: video.duration,
          duration_formatted: video.durationFormatted || video.duration_formatted || '0:00',
          position: insertPos,
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      set({ queue: normalizeQueue(data.queue), online: true, lastSynced: Date.now() })
    } catch {
      set({ online: false })
    }
  },

  // -----------------------------------------------------------
  // Remove by queue item ID
  // -----------------------------------------------------------
  removeFromQueue: async (id) => {
    // Also accept queueId for backwards compat
    const { queue, currentIndex } = get()
    const item = queue.find(q => q.id === id || q.queueId === id)
    const removeId = item?.id || id

    try {
      const res = await fetch(`${API}/queue/${removeId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const newQueue = normalizeQueue(data.queue)

      set((state) => {
        const removeIdx = state.queue.findIndex(q => q.id === removeId)
        let newIndex = state.currentIndex
        if (state.currentIndex >= 0) {
          if (removeIdx < state.currentIndex) {
            newIndex = state.currentIndex - 1
          } else if (removeIdx === state.currentIndex) {
            newIndex = -1
          }
        }
        if (newIndex >= newQueue.length) newIndex = -1
        return { queue: newQueue, currentIndex: newIndex, online: true, lastSynced: Date.now() }
      })
    } catch {
      set({ online: false })
    }
  },

  // -----------------------------------------------------------
  // Drag reorder: move item from fromIdx to toIdx
  // -----------------------------------------------------------
  reorder: async (fromIdx, toIdx) => {
    const { queue, currentIndex } = get()
    if (fromIdx < 0 || fromIdx >= queue.length || toIdx < 0 || toIdx >= queue.length) return

    // Optimistic local reorder
    const next = [...queue]
    const [moved] = next.splice(fromIdx, 1)
    next.splice(toIdx, 0, moved)

    let newIndex = currentIndex
    if (currentIndex >= 0) {
      if (fromIdx === currentIndex) newIndex = toIdx
      else if (fromIdx < currentIndex && toIdx >= currentIndex) newIndex = currentIndex - 1
      else if (fromIdx > currentIndex && toIdx <= currentIndex) newIndex = currentIndex + 1
    }

    set({ queue: next, currentIndex: newIndex })

    // Send reorder to server
    try {
      const res = await fetch(`${API}/queue`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: next.map(item => item.id) }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      set({ queue: normalizeQueue(data.queue) || next, online: true, lastSynced: Date.now() })
    } catch {
      set({ online: false })
    }
  },

  // -----------------------------------------------------------
  // Advance to next item in queue (auto-advance on video end)
  // -----------------------------------------------------------
  advance: () => {
    const { queue, currentIndex } = get()
    if (currentIndex < queue.length - 1) {
      const nextIndex = currentIndex + 1
      set({ currentIndex: nextIndex })
      return queue[nextIndex]
    }
    return null
  },

  // -----------------------------------------------------------
  // Clear entire queue
  // -----------------------------------------------------------
  clearQueue: async () => {
    try {
      const res = await fetch(`${API}/queue`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      set({ queue: [], currentIndex: -1, online: true, lastSynced: Date.now() })
    } catch {
      set({ online: false })
    }
  },

  // -----------------------------------------------------------
  // Set currently playing index directly (local only)
  // -----------------------------------------------------------
  setCurrentIndex: (index) => set({ currentIndex: index }),
}))

export default useQueueStore
