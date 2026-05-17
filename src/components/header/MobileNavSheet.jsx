import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import useViewTransitionNavigate from '../../hooks/useViewTransitionNavigate'
import useMobileNavStore from '../../stores/mobileNavStore'
import useModeStore from '../../stores/modeStore'
import useThemeStore from '../../stores/themeStore'
import useFocusTrap from '../../hooks/useFocusTrap'

// ============================================================
// MobileNavSheet
// Right-side slide-in navigation drawer for mobile (<md).
// Accessibility: role=dialog, focus trap, ESC, body scroll lock,
// Android hardware back button, route auto-close.
// ============================================================

const NAV_ITEMS = [
  { label: 'Home',    path: '/' },
  { label: 'Feed',    path: '/feed' },
  { label: 'Library', path: '/library' },
]
const NSFW_ITEMS = [
  { label: 'Audio', path: '/audio' },
]

export default function MobileNavSheet() {
  const { open, closeNav } = useMobileNavStore()
  const navigate = useViewTransitionNavigate()
  const location = useLocation()
  const { isSFW, activateNSFW, activateSFW } = useModeStore()
  const { theme, toggleTheme } = useThemeStore()
  const sheetRef = useFocusTrap(open)
  const titleId = 'mobile-nav-title'

  // Body scroll lock — prevent page scrolling while sheet is open.
  // Uses overscroll-behavior on the sheet + overflow:hidden on body so iOS
  // rubber-band doesn't bleed through.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  // ESC to close
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeNav() } }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [open, closeNav])

  // Android hardware back button: push a history sentinel on open,
  // listen for popstate to close instead of navigating away.
  const sentinelRef = useRef(false)
  useEffect(() => {
    if (open) {
      history.pushState({ mobileNav: true }, '')
      sentinelRef.current = true
      const onPop = (_e) => {
        if (sentinelRef.current) {
          sentinelRef.current = false
          closeNav()
        }
      }
      window.addEventListener('popstate', onPop)
      return () => window.removeEventListener('popstate', onPop)
    } else {
      // If we close programmatically (not via back button), pop the sentinel
      if (sentinelRef.current) {
        sentinelRef.current = false
        history.back()
      }
    }
  }, [open, closeNav])

  // Auto-close on route change
  useEffect(() => {
    closeNav()
  }, [location.pathname, closeNav])

  const handleNavClick = (path) => {
    closeNav()
    navigate(path)
  }

  const allItems = [...NAV_ITEMS, ...(isSFW ? [] : NSFW_ITEMS)]

  return (
    <>
      {/* Backdrop */}
      <div
        className={`md:hidden fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm
          transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        aria-hidden="true"
        onClick={closeNav}
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`md:hidden fixed top-0 right-0 bottom-0 z-[71]
          glass-elevated flex flex-col
          transition-transform duration-300 ease-out
          ${open ? 'translate-x-0' : 'translate-x-full'}`}
        style={{
          width: 'min(85vw, 360px)',
          paddingTop: 'max(env(safe-area-inset-top, 0px), 16px)',
          paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 16px)',
          paddingRight: 'max(env(safe-area-inset-right, 0px), 16px)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 mb-6">
          <span id={titleId} className="font-display font-bold text-text-primary text-lg">
            Navigation
          </span>
          <button
            onClick={closeNav}
            className="w-11 h-11 flex items-center justify-center rounded-lg
              text-text-secondary hover:text-text-primary hover:bg-surface-overlay transition-colors"
            aria-label="Close navigation menu"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <line x1="3" y1="3" x2="15" y2="15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <line x1="15" y1="3" x2="3" y2="15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Nav links */}
        <nav className="flex flex-col gap-1 px-3 flex-1">
          {allItems.map(item => {
            const isActive = location.pathname === item.path
            return (
              <button
                key={item.path}
                onClick={() => handleNavClick(item.path)}
                className={`flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-medium
                  transition-colors text-left w-full min-h-[44px]
                  ${isActive
                    ? 'bg-accent/15 text-accent'
                    : 'text-text-secondary hover:text-text-primary hover:bg-surface-overlay'}`}
              >
                {item.label}
                {isActive && (
                  <span className="ml-auto w-1.5 h-1.5 rounded-full bg-accent" aria-hidden="true" />
                )}
              </button>
            )
          })}
        </nav>

        {/* Divider */}
        <div className="mx-4 my-3 border-t border-surface-border" />

        {/* Bottom actions */}
        <div className="flex flex-col gap-1 px-3">
          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-medium
              text-text-secondary hover:text-text-primary hover:bg-surface-overlay
              transition-colors w-full min-h-[44px]"
          >
            <span aria-hidden="true">{theme === 'dark' ? '☀' : '🌙'}</span>
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>

          {/* Mode toggle */}
          <button
            onClick={() => isSFW ? activateNSFW() : activateSFW()}
            className="flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-medium
              text-text-secondary hover:text-text-primary hover:bg-surface-overlay
              transition-colors w-full min-h-[44px]"
          >
            <span aria-hidden="true">{isSFW ? '🔒' : '🔓'}</span>
            {isSFW ? 'Switch to NSFW' : 'Switch to SFW'}
          </button>
        </div>
      </div>
    </>
  )
}
