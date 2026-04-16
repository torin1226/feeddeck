import { create } from 'zustand'

// ============================================================
// Ratings Store (3.12 Taste Feedback)
// Tracks: per-row consecutive-down counts, 30s window tracker,
// toast pause timer, and optimistic rating state.
// ============================================================

const useRatingsStore = create((set, get) => ({
  // Map of surfaceKey -> { consecutiveDowns, recentDownTimestamps[] }
  rowTrackers: {},

  // Toast fatigue: count of action toasts shown this session
  actionToastCount: 0,
  // Timestamp when toast pause was activated (null = not paused)
  toastPausedUntil: null,

  // Map of video URLs to rating value ('up'|'down') for UI state
  ratedUrls: {},

  // Record a rating and update trackers
  recordRating: (videoUrl, surfaceKey, rating) => {
    const state = get()
    const now = Date.now()

    // Update rated URLs map
    const ratedUrls = { ...state.ratedUrls, [videoUrl]: rating }

    // Update row tracker
    const trackers = { ...state.rowTrackers }
    if (!trackers[surfaceKey]) {
      trackers[surfaceKey] = { consecutiveDowns: 0, recentDownTimestamps: [] }
    }

    const tracker = { ...trackers[surfaceKey] }

    if (rating === 'down') {
      tracker.consecutiveDowns++
      tracker.recentDownTimestamps = [
        ...tracker.recentDownTimestamps.filter(t => now - t < 30_000),
        now,
      ]
    } else {
      // Thumbs-up resets consecutive downs
      tracker.consecutiveDowns = 0
    }

    trackers[surfaceKey] = tracker
    set({ ratedUrls, rowTrackers: trackers })
  },

  // Check if row needs a full refresh (4+ consecutive downs)
  shouldRefreshRow: (surfaceKey) => {
    const tracker = get().rowTrackers[surfaceKey]
    return tracker && tracker.consecutiveDowns >= 4
  },

  // Check if rapid-dislike toast should show (2+ downs in 30s)
  shouldShowRapidDislike: (surfaceKey) => {
    const tracker = get().rowTrackers[surfaceKey]
    if (!tracker) return false
    const now = Date.now()
    const recent = tracker.recentDownTimestamps.filter(t => now - t < 30_000)
    return recent.length >= 2
  },

  // Reset row tracker (after row refresh)
  resetRowTracker: (surfaceKey) => {
    const trackers = { ...get().rowTrackers }
    trackers[surfaceKey] = { consecutiveDowns: 0, recentDownTimestamps: [] }
    set({ rowTrackers: trackers })
  },

  // Toast fatigue
  incrementActionToast: () => set(s => ({ actionToastCount: s.actionToastCount + 1 })),
  pauseToasts: () => set({ toastPausedUntil: Date.now() + 60 * 60 * 1000 }),
  isToastPaused: () => {
    const until = get().toastPausedUntil
    return until && Date.now() < until
  },

  // Get rating for a video (for UI state)
  getRating: (videoUrl) => get().ratedUrls[videoUrl] || null,
}))

export default useRatingsStore
