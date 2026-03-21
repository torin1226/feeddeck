import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// ============================================================
// Mode Store
// Controls SFW/NSFW display mode.
// - Always loads SFW first (safe default)
// - Escape key → always goes TO SFW (panic)
// - Persists preference for next session
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

const useModeStore = create(
  persist(
    (set) => ({
      // State
      isSFW: true,  // Always default to SFW

      // Actions
      activateSFW: () => {
        setDocumentMeta(true)
        set({ isSFW: true })
      },

      activateNSFW: () => {
        setDocumentMeta(false)
        set({ isSFW: false })
      },

      toggleMode: () => {
        set((state) => {
          const next = !state.isSFW
          setDocumentMeta(next)
          return { isSFW: next }
        })
      },
    }),
    {
      name: 'fd-mode',
      // On hydration, always force SFW first, then restore after delay
      onRehydrateStorage: () => {
        // Set SFW immediately on page load
        setDocumentMeta(true)
        return (state) => {
          // After hydration, state has the persisted value
          // but we already set SFW visually — App.jsx handles the restore
        }
      },
    }
  )
)

export default useModeStore
