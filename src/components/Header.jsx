import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import useViewTransitionNavigate from '../hooks/useViewTransitionNavigate'
import ModeToggle from './ModeToggle'
import AddVideoModal from './AddVideoModal'
import useModeStore from '../stores/modeStore'
import useThemeStore from '../stores/themeStore'

// ============================================================
// Header
// Top nav bar with search, mode toggle, and add button.
// In Social mode: shows FeedDeck branding.
// ============================================================

const navItems = [
  { label: 'Home', path: '/' },
  { label: 'Feed', path: '/feed' },
  { label: 'Library', path: '/library' },
]

export default function Header({ onSearch, onSearchSubmit }) {
  const navigate = useViewTransitionNavigate()
  const location = useLocation()
  const { isSFW } = useModeStore()
  const { theme, toggleTheme } = useThemeStore()
  const [showAdd, setShowAdd] = useState(false)
  const [query, setQuery] = useState('')

  const handleSearch = (e) => {
    e.preventDefault()
    if (query.trim()) onSearchSubmit?.(query.trim())
  }

  return (
    <>
      <header className="sticky top-0 z-modal bg-surface/90 backdrop-blur-md border-b border-surface-border">
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
            {navItems.map(item => (
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

          {/* Search bar */}
          <form onSubmit={handleSearch} className="flex-1 max-w-xl">
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
                  focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[rgba(244,63,94,0.5)] focus-visible:outline-offset-2 focus:border-text-muted transition-colors"
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
                  bg-accent/90 text-white hover:bg-accent transition-colors font-medium"
              >
                <span>+</span>
                <span className="hidden sm:block">Add</span>
              </button>
            )}

            <button
              onClick={toggleTheme}
              className="w-11 h-11 flex items-center justify-center rounded-lg text-text-secondary hover:text-text-primary
                hover:bg-surface-overlay transition-colors"
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? '☀' : '🌙'}
            </button>

            <ModeToggle />
          </div>
        </div>
      </header>

      {/* Add video modal */}
      {showAdd && <AddVideoModal onClose={() => setShowAdd(false)} />}
    </>
  )
}
