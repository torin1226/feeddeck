import { useState } from 'react'
import ModeToggle from './ModeToggle'
import AddVideoModal from './AddVideoModal'
import useModeStore from '../stores/modeStore'

// ============================================================
// Header
// Top nav bar with search, mode toggle, and add button.
// In Social mode: shows FeedDeck branding.
// ============================================================

export default function Header({ onSearch, onSearchSubmit }) {
  const { isSFW } = useModeStore()
  const [showAdd, setShowAdd] = useState(false)
  const [query, setQuery] = useState('')

  const handleSearch = (e) => {
    e.preventDefault()
    if (query.trim()) onSearchSubmit?.(query.trim())
  }

  return (
    <>
      <header className="sticky top-0 z-40 bg-surface/90 backdrop-blur-md border-b border-surface-border">
        <div className="flex items-center gap-4 px-4 md:px-6 h-14">

          {/* Logo / Brand */}
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-lg">{isSFW ? '📡' : '▶'}</span>
            <span className="font-semibold text-text-primary hidden sm:block">
              FeedDeck
            </span>
          </div>

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
                  focus:outline-none focus:border-text-muted transition-colors"
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

            <ModeToggle />
          </div>
        </div>
      </header>

      {/* Add video modal */}
      {showAdd && <AddVideoModal onClose={() => setShowAdd(false)} />}
    </>
  )
}
