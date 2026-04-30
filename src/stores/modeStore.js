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
 *
 * Mode firewall: this function MUST clear every persisted store
 * that can hold a video reference. The persisted-store list:
 *   - feedStore (memory only, but warm-fetch buffers persist briefly)
 *   - homeStore (memory only)
 *   - queueStore (PERSISTED in localStorage as fd-queue)
 *   - libraryStore (PERSISTED in localStorage as fd-lib)
 *   - playerStore (memory only)
 *   - ratingsStore (memory only)
 */
async function nuclearFlush() {
  // Destroy any active video elements immediately
  document.querySelectorAll('video').forEach(v => {
    v.pause()
    v.removeAttribute('src')
    v.load() // Force release of media resources
  })

  // Flush all content stores (lazy import to break circular deps)
  const [
    { default: useFeedStore },
    { default: useHomeStore },
    { default: useQueueStore },
    { default: usePlayerStore },
    { default: useLibraryStore },
    { default: useRatingsStore },
  ] = await Promise.all([
    import('./feedStore'),
    import('./homeStore'),
    import('./queueStore'),
    import('./playerStore'),
    import('./libraryStore'),
    import('./ratingsStore'),
  ])

  useFeedStore.getState().resetFeed()
  useHomeStore.getState().resetHome()
  useQueueStore.getState().clearQueue()
  usePlayerStore.getState().clear()
  // Clear library so the previous mode's videos don't bleed into
  // Continue Watching, Liked, Favorites, etc. The next mount
  // calls loadFromServer() which fetches the correct mode's set.
  useLibraryStore.getState().clearLibrary()
  useRatingsStore.getState().reset()
}

const useModeStore = create(
  persist(
    (set) => ({
      // State
      isSFW: true,  // Always default to SFW
      _hydrated: false, // True once zustand persist has finished hydrating

      // Actions
      // Order matters: flush BEFORE setting the new mode so stores are
      // empty by the time UI re-renders with the new mode. Without the
      // await, cross-mode content briefly remains visible during the
      // race window between set() and the async clears.
      activateSFW: async () => {
        await nuclearFlush()
        setDocumentMeta(true)
        set({ isSFW: true })
      },

      activateNSFW: async () => {
        await nuclearFlush()
        setDocumentMeta(false)
        set({ isSFW: false })
      },

      toggleMode: async () => {
        const next = !useModeStore.getState().isSFW
        await nuclearFlush()
        setDocumentMeta(next)
        set({ isSFW: next })
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
