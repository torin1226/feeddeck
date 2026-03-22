import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// ============================================================
// Theme Store
// Controls dark/light theme. Dark is default (Netflix aesthetic).
// Applies 'light' class to <html> for light mode.
// ============================================================

function applyTheme(theme) {
  const root = document.documentElement
  if (theme === 'light') {
    root.classList.add('light')
    root.classList.remove('dark')
  } else {
    root.classList.add('dark')
    root.classList.remove('light')
  }
}

const useThemeStore = create(
  persist(
    (set) => ({
      theme: 'dark', // 'dark' | 'light'

      setTheme: (theme) => {
        applyTheme(theme)
        set({ theme })
      },

      toggleTheme: () => {
        set((state) => {
          const next = state.theme === 'dark' ? 'light' : 'dark'
          applyTheme(next)
          return { theme: next }
        })
      },
    }),
    {
      name: 'fd-theme',
      onRehydrateStorage: () => {
        // Apply dark immediately to prevent flash
        applyTheme('dark')
        return (state) => {
          // After hydration, apply the persisted theme
          if (state?.theme) applyTheme(state.theme)
        }
      },
    }
  )
)

export default useThemeStore
