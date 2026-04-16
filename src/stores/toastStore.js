import { create } from 'zustand'

// ============================================================
// Toast Store (upgraded for 3.12 Taste Feedback)
//
// Two tiers:
//   Tier 1 — Passive: auto-dismiss 3s, no interaction, pointer-events-none
//   Tier 2 — Action: CTA button(s), 8s timeout, pointer-events-auto, rose accent border
//
// Toast fatigue:
//   1st action toast: shows normally
//   2nd action toast: adds "Pause for 1hr" secondary action
//   After pause: all rating toasts suppressed for 60min
// ============================================================

const useToastStore = create((set, get) => ({
  toast: null,

  // Tier 1 — passive toast (backwards compatible)
  showToast: (message, type = 'info') => set({
    toast: { id: Date.now(), message, type, tier: 'passive' },
  }),

  // Tier 2 — action toast with CTA buttons
  showActionToast: (message, { type = 'info', actions = [], timeout = 8000 } = {}) => set({
    toast: { id: Date.now(), message, type, tier: 'action', actions, timeout },
  }),

  clearToast: () => set({ toast: null }),
}))

export default useToastStore
