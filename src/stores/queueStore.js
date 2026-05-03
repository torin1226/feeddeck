import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { safeStorage } from './safeStorage'
import useModeStore from './modeStore'
import { modeFromIsSFW, isVideoForMode } from '../utils/mode'

// ============================================================
// Queue Store (Server-Backed with Offline Persistence)
// Manages the play-next queue. All mutations hit the API first,
// then update local state from the server response. Polling
// (useQueueSync hook) keeps multiple clients in sync.
// Queue persists to localStorage for survival across server
// restarts — server state wins on reconnect.
// ============================================================

const API = '/api'

/** Resolve current mode from modeStore, format for API. */
function currentMode() {
  return modeFromIsSFW(useModeStore.getState().isSFW)
}

/** Build a URL with the current mode appended. */
function modeUrl(path) {
  const sep = path.includes('?') ? '&' : '?'
  return `${API}${path}${sep}mode=${currentMode()}`
}

// Debounce reorder server sync to prevent race conditions from rapid drags.
// Optimistic changes apply instantly; server sync fires after 300ms of no new drags.
let _reorderTimer = null
let _lastConfirmedQueue = null  // Last server-confirmed queue state for rollback
let _lastConfirmedIndex = -1

// Normalize server queue items to include `url` (alias of `video_url`)
// and `durationFormatted` (alias of `duration_formatted`) for backwards compat
function normalizeItem(item) {
  return { ...item, url: item.video_url || item.url, durationFormatted: item.duration_formatted || item.durationFormatted }
}
function normalizeQueue(items) {
  return (items || []).map(normalizeItem)
}

const useQueueStore = create(persist((set, get) => ({
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
      const mode = currentMode()
      const res = await fetch(modeUrl('/queue'))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      // Belt-and-suspenders: server already filters by mode, but apply
      // the client guard too in case the server response is stale.
      const serverQueue = normalizeQueue(data.queue).filter(it => isVideoForMode(it, mode))

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
      const mode = currentMode()
      const res = await fetch(modeUrl('/queue'), {
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
      set({ queue: normalizeQueue(data.queue).filter(it => isVideoForMode(it, mode)), online: true, lastSynced: Date.now() })
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
      const mode = currentMode()
      const res = await fetch(modeUrl('/queue'), {
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
      set({ queue: normalizeQueue(data.queue).filter(it => isVideoForMode(it, mode)), online: true, lastSynced: Date.now() })
    } catch {
      set({ online: false })
    }
  },

  // -----------------------------------------------------------
  // Remove by queue item ID
  // -----------------------------------------------------------
  removeFromQueue: async (id) => {
    // Also accept queueId for backwards compat
    const { queue } = get()
    const item = queue.find(q => q.id === id || q.queueId === id)
    const removeId = item?.id || id

    try {
      const mode = currentMode()
      const res = await fetch(modeUrl(`/queue/${removeId}`), { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const newQueue = normalizeQueue(data.queue).filter(it => isVideoForMode(it, mode))

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
  // Optimistic local reorder applies instantly. Server sync is
  // debounced (300ms) so rapid drags only send the final order.
  // On failure, rolls back to last server-confirmed state.
  // -----------------------------------------------------------
  reorder: (fromIdx, toIdx) => {
    const { queue, currentIndex } = get()
    if (fromIdx < 0 || fromIdx >= queue.length || toIdx < 0 || toIdx >= queue.length) return

    // Capture server-confirmed state on first drag of a burst
    if (!_reorderTimer) {
      _lastConfirmedQueue = queue
      _lastConfirmedIndex = currentIndex
    }

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

    // Debounce server sync — only fires after 300ms of no new reorders
    clearTimeout(_reorderTimer)
    _reorderTimer = setTimeout(async () => {
      _reorderTimer = null
      const { queue: finalQueue } = get()
      try {
        const mode = currentMode()
        const res = await fetch(modeUrl('/queue'), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order: finalQueue.map(item => item.id) }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        _lastConfirmedQueue = normalizeQueue(data.queue).filter(it => isVideoForMode(it, mode))
        _lastConfirmedIndex = get().currentIndex
        set({ queue: _lastConfirmedQueue, online: true, lastSynced: Date.now() })
      } catch {
        // Rollback to last server-confirmed state
        set({ queue: _lastConfirmedQueue, currentIndex: _lastConfirmedIndex, online: false })
      }
    }, 300)
  },

  // -----------------------------------------------------------
  // Advance to next item in queue (auto-advance on video end)
  // Uses local queue first, then syncs with server in background
  // to handle server restarts where queue may have been lost.
  // -----------------------------------------------------------
  advance: () => {
    const { queue, currentIndex } = get()
    if (currentIndex < queue.length - 1) {
      const nextIndex = currentIndex + 1
      const nextItem = queue[nextIndex]
      // Validate item has a URL before advancing
      if (!nextItem?.url && !nextItem?.video_url) return null
      set({ currentIndex: nextIndex })
      // Background sync: re-fetch queue from server to catch restarts.
      // If the server queue differs (e.g. empty after restart), the next
      // polling cycle from useQueueSync will reconcile. This is a
      // best-effort early check.
      get().fetchQueue().catch(() => {})
      return nextItem
    }
    return null
  },

  // -----------------------------------------------------------
  // Clear entire queue
  // -----------------------------------------------------------
  clearQueue: async () => {
    try {
      const res = await fetch(modeUrl('/queue'), { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      set({ queue: [], currentIndex: -1, online: true, lastSynced: Date.now() })
    } catch {
      // Server unreachable -- still clear local state for the firewall.
      // Next reconnect will sync.
      set({ queue: [], currentIndex: -1, online: false })
    }
  },

  // -----------------------------------------------------------
  // Set currently playing index directly (local only)
  // -----------------------------------------------------------
  setCurrentIndex: (index) => set({ currentIndex: index }),
}), {
  name: 'fd-queue',
  // Wrap safeStorage with createJSONStorage so the persist middleware
  // serializes to a string before hitting localStorage. Without this,
  // setItem received the raw {state, version} object and localStorage
  // coerced it to "[object Object]". (Zustand v4 contract.)
  storage: createJSONStorage(() => safeStorage),
  partialize: (state) => ({
    queue: state.queue,
    currentIndex: state.currentIndex,
  }),
}))

export default useQueueStore
