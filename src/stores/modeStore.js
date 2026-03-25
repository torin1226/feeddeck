import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// ============================================================
// Mode Store
// Controls SFW/NSFW display mode.
// - Always loads SFW first (safe default)
// - Escape key → always goes TO SFW (panic)
// - Persists preference for next session
//
// NUCLEAR SWITCH: On mode change, ALL content stores are flushed
// instantly. No NSFW content survives a switch to SFW.
// ============================================================

const SOCIAL_FAVICON = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📡</text></svg>"
const NEUTRAL_FAVICON = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>▶</text></svg>"

function setDocumentMeta(isSFW) {
  document.title = isSFW ? 'FeedDeck' : 'FD'

  let link = document.querySelector("link[rel~='icon']")
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  link.href = isSFW ? SOCIAL_FAVICON : NEUTRAL_FAVICON
}

/**
 * Nuclear flush: purge ALL content from every store that might
 * hold mode-specific data. Called on every mode switch.
 * Lazy-imports stores to avoid circular dependency.
 */
async function nuclearFlush() {
  // Destroy any active video elements immediately
  document.querySelectorAll('video').forEach(v => {
    v.pause()
    v.removeAttribute('src')
    v.load() // Force release of media resources
  })

  // Flush all content stores (lazy import to break circular deps)
  const [{ default: useFeedStore }, { default: useHomeStore }, { default: useQueueStore }, { default: usePlayerStore }] = await Promise.all([
    import('./feedStore'),
    import('./homeStore'),
    import('./queueStore'),
    import('./playerStore'),
  ])

  useFeedStore.getState().resetFeed()
  useHomeStore.getState().resetHome()
  useQueueStore.getState().clearQueue()
  usePlayerStore.getState().clear()
}

const useModeStore = create(
  persist(
    (set) => ({
      // State
      isSFW: true,  // Always default to SFW

      // Actions
      activateSFW: () => {
        setDocumentMeta(true)
        set({ isSFW: true })
        nuclearFlush()
      },

      activateNSFW: () => {
        setDocumentMeta(false)
        set({ isSFW: false })
        nuclearFlush()
      },

      toggleMode: () => {
        set((state) => {
          const next = !state.isSFW
          setDocumentMeta(next)
          return { isSFW: next }
        })
        nuclearFlush()
      },
    }),
    {
      name: 'fd-mode',
      // On hydration, always force SFW first, then restore after delay
      onRehydrateStorage: () => {
        // Set SFW immediately on page load
        setDocumentMeta(true)
        return () => {
          // After hydration, state has the persisted value
          // but we already set SFW visually — App.jsx handles the restore
        }
      },
    }
  )
)

export default useModeStore
