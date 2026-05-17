import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import useViewTransitionNavigate from '../hooks/useViewTransitionNavigate'
import ModeToggle from './ModeToggle'
import AddVideoModal from './AddVideoModal'
import useModeStore from '../stores/modeStore'
import useThemeStore from '../stores/themeStore'
import useHomeStore from '../stores/homeStore'
import HamburgerButton from './header/HamburgerButton'
import MobileNavSheet from './header/MobileNavSheet'

// ============================================================
// Header
// Top nav bar with search, mode toggle, and add button.
// In Social mode: shows FeedDeck branding.
// ============================================================

// Nav items shown in all modes. Audio is NSFW-only; rendered separately
// in the nav so it only appears when isSFW=false.
const navItems = [
  { label: 'Home', path: '/' },
  { label: 'Feed', path: '/feed' },
  { label: 'Library', path: '/library' },
]
const NSFW_NAV_ITEMS = [
  { label: 'Audio', path: '/audio' },
]

export default function Header({ onSearch, onSearchSubmit }) {
  const navigate = useViewTransitionNavigate()
  const location = useLocation()
  const { isSFW } = useModeStore()
  const { theme, toggleTheme } = useThemeStore()
  const shuffleHome = useHomeStore(s => s.shuffleHome)
  const shuffling = useHomeStore(s => s.shuffling)
  const refreshing = useHomeStore(s => s.refreshing)
  const [showAdd, setShowAdd] = useState(false)
  const [query, setQuery] = useState('')

  const handleSearch = (e) => {
    e.preventDefault()
    if (query.trim()) onSearchSubmit?.(query.trim())
  }

  return (
    <>
      <header
        className="sticky top-0 z-modal bg-surface/90 backdrop-blur-md border-b border-surface-border"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <div className="flex items-center gap-4 px-4 md:px-6 h-14">

          {/* Logo / Brand */}
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-lg">{isSFW ? '📡' : '▶'}</span>
            <span className="font-display font-bold text-text-primary hidden sm:block tracking-tight">
              FeedDeck
            </span>
          </div>

          {/* Nav links */}
          <nav className="hidden md:flex gap-5 shrink-0">
            {[...navItems, ...(isSFW ? [] : NSFW_NAV_ITEMS)].map(item => (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={`text-sm font-medium transition-colors cursor-pointer relative pb-0.5 ${
                  location.pathname === item.path
                    ? 'text-text-primary'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                {item.label}
                {location.pathname === item.path && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-full" />
                )}
              </button>
            ))}
          </nav>

          {/* Search bar — hidden on mobile (accessible via search button or sheet) */}
          <form onSubmit={handleSearch} className="hidden md:block flex-1 max-w-xl">
            <div className="relative">
              <input
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  onSearch?.(e.target.value)
                }}
                placeholder="Search videos..."
                className="w-full bg-surface-overlay border border-surface-border rounded-lg
                  px-4 py-2 text-sm text-text-primary placeholder:text-text-muted
                  focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent/60 focus-visible:outline-offset-2 focus:border-text-muted transition-colors"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => { setQuery(''); onSearch?.(''); onSearchSubmit?.('') }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                >
                  ✕
                </button>
              )}
            </div>
          </form>

          {/* Right side actions */}
          <div className="flex items-center gap-3 shrink-0">
            {/* Add video button (hidden in SFW) */}
            {!isSFW && (
              <button
                onClick={() => setShowAdd(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm
                  bg-accent text-white hover:bg-accent-hover transition-colors font-medium"
              >
                <span>+</span>
                <span className="hidden sm:block">Add</span>
              </button>
            )}

            {/* Shuffle — desktop only (in mobile sheet) */}
            <button
              onClick={() => shuffleHome(isSFW ? 'social' : 'nsfw')}
              disabled={shuffling || refreshing}
              className="hidden md:flex w-11 h-11 items-center justify-center rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface-overlay transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Shuffle homepage"
              aria-label="Shuffle homepage"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={shuffling ? 'animate-spin' : ''}>
                <polyline points="16 3 21 3 21 8" />
                <line x1="4" y1="20" x2="21" y2="3" />
                <polyline points="21 16 21 21 16 21" />
                <line x1="15" y1="15" x2="21" y2="21" />
                <line x1="4" y1="4" x2="9" y2="9" />
              </svg>
            </button>

            {/* Theme — desktop only (in mobile sheet) */}
            <button
              onClick={toggleTheme}
              className="hidden md:flex w-11 h-11 items-center justify-center rounded-lg text-text-secondary hover:text-text-primary
                hover:bg-surface-overlay transition-colors"
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? '☀' : '🌙'}
            </button>

            <ModeToggle />

            {/* Hamburger — mobile only */}
            <HamburgerButton />
          </div>
        </div>
      </header>

      {/* Add video modal */}
      {showAdd && <AddVideoModal onClose={() => setShowAdd(false)} />}

      {/* Mobile nav sheet */}
      <MobileNavSheet />
    </>
  )
}
