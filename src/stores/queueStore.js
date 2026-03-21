import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// ============================================================
// Queue Store
// Manages the play-next queue with full video objects.
// Each item gets a unique queueId so the same video can appear
// multiple times. Persists so queue survives page refresh.
// ============================================================

const useQueueStore = create(
  persist(
    (set, get) => ({
      // State
      queue: [],          // Array of { queueId, id, url, title, thumbnail, duration, durationFormatted }
      currentIndex: -1,   // Which queue item is playing (-1 = none)

      // -----------------------------------------------------------
      // Add a video object to the end of the queue.
      // Generates a unique queueId so duplicates are allowed.
      // -----------------------------------------------------------
      addToQueue: (video) => {
        const item = {
          queueId: crypto.randomUUID(),
          id: video.id,
          url: video.url,
          title: video.title,
          thumbnail: video.thumbnail,
          duration: video.duration,
          durationFormatted: video.durationFormatted || '0:00',
        }
        set((state) => ({
          queue: [...state.queue, item],
        }))
      },

      // -----------------------------------------------------------
      // Insert a video right after the currently playing item.
      // If nothing is playing (currentIndex is -1), inserts at the start.
      // -----------------------------------------------------------
      insertNext: (video) => {
        const item = {
          queueId: crypto.randomUUID(),
          id: video.id,
          url: video.url,
          title: video.title,
          thumbnail: video.thumbnail,
          duration: video.duration,
          durationFormatted: video.durationFormatted || '0:00',
        }
        set((state) => {
          const insertAt = state.currentIndex + 1
          const next = [...state.queue]
          next.splice(insertAt, 0, item)
          return { queue: next }
        })
      },

      // -----------------------------------------------------------
      // Remove by queueId (unique per queue entry).
      // Adjusts currentIndex so it still points to the same video.
      // -----------------------------------------------------------
      removeFromQueue: (queueId) => {
        set((state) => {
          const removeIdx = state.queue.findIndex((item) => item.queueId === queueId)
          if (removeIdx === -1) return state

          const next = state.queue.filter((item) => item.queueId !== queueId)

          let newIndex = state.currentIndex
          if (state.currentIndex >= 0) {
            if (removeIdx < state.currentIndex) {
              // Removed item was before current — shift index back
              newIndex = state.currentIndex - 1
            } else if (removeIdx === state.currentIndex) {
              // Removed the currently playing item — reset
              newIndex = -1
            }
          }

          return { queue: next, currentIndex: newIndex }
        })
      },

      // -----------------------------------------------------------
      // Drag reorder: move item from fromIdx to toIdx.
      // Recalculates currentIndex so it still points to the same video.
      // -----------------------------------------------------------
      reorder: (fromIdx, toIdx) => {
        set((state) => {
          const next = [...state.queue]
          const [moved] = next.splice(fromIdx, 1)
          next.splice(toIdx, 0, moved)

          // Figure out where currentIndex ends up after the move
          let newIndex = state.currentIndex
          if (state.currentIndex >= 0) {
            if (fromIdx === state.currentIndex) {
              // We moved the currently playing item
              newIndex = toIdx
            } else if (fromIdx < state.currentIndex && toIdx >= state.currentIndex) {
              // Moved an item from before current to after — current shifts back
              newIndex = state.currentIndex - 1
            } else if (fromIdx > state.currentIndex && toIdx <= state.currentIndex) {
              // Moved an item from after current to before — current shifts forward
              newIndex = state.currentIndex + 1
            }
          }

          return { queue: next, currentIndex: newIndex }
        })
      },

      // -----------------------------------------------------------
      // Advance to the next item in the queue (auto-advance).
      // Returns the next queue item object, or null if at the end.
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
      // Clear entire queue and reset index
      // -----------------------------------------------------------
      clearQueue: () => set({ queue: [], currentIndex: -1 }),

      // -----------------------------------------------------------
      // Set currently playing index directly
      // -----------------------------------------------------------
      setCurrentIndex: (index) => set({ currentIndex: index }),
    }),
    {
      name: 'fd-queue',
      // Version 1: migrated from ID-based queue to object-based queue.
      // If old data had plain string IDs, clear it out so we start fresh.
      version: 1,
      migrate: (persisted, version) => {
        if (version === 0 || !version) {
          // Old store had queue as array of strings — not compatible
          return { queue: [], currentIndex: -1 }
        }
        return persisted
      },
    }
  )
)

export default useQueueStore
