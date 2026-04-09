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
      _hydrated: false, // True once zustand persist has finished hydrating

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
      partialize: (state) => ({ isSFW: state.isSFW }), // Don't persist _hydrated
      // On hydration, always force SFW — no NSFW content before user explicitly toggles
      onRehydrateStorage: () => {
        setDocumentMeta(true)
        return (_state, error) => {
          if (error) {
            console.warn('[modeStore] Hydration error:', error)
          }
          // Use set from closure — useModeStore may not be assigned yet
          // during initial module evaluation (circular ref race condition).
          // Fall back to useModeStore.setState only if needed.
          try {
            useModeStore.setState({ isSFW: true, _hydrated: true })
          } catch {
            // If useModeStore isn't ready, retry on next microtask
            queueMicrotask(() => {
              useModeStore.setState({ isSFW: true, _hydrated: true })
            })
          }
          setDocumentMeta(true)
        }
      },
    }
  )
)

export default useModeStore
