import { useState, useRef, useCallback, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import useViewTransitionNavigate from '../../hooks/useViewTransitionNavigate'
import useHomeStore from '../../stores/homeStore'
import useModeStore from '../../stores/modeStore'
import useThemeStore from '../../stores/themeStore'

// ============================================================
// HomeHeader
// Fixed transparent header for the homepage. Nav links, logo,
// search, and mode pill. Gradient background that fades to
// transparent.
// ============================================================

export default function HomeHeader() {
  const navigate = useViewTransitionNavigate()
  const location = useLocation()
  const { setHeroItem, toggleTheatre } = useHomeStore()
  const { isSFW, toggleMode } = useModeStore()
  const { theme, toggleTheme } = useThemeStore()

  // --- Search state ---
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const [noResults, setNoResults] = useState(false)

  const inputRef = useRef(null)
  const searchTimer = useRef(null)
  const containerRef = useRef(null)

  // Focus input when search opens
  useEffect(() => {
    if (searchOpen && inputRef.current) {
      inputRef.current.focus()
    }
  }, [searchOpen])

  // Click-outside to close
  useEffect(() => {
    if (!searchOpen) return
    function handleClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        closeSearch()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchOpen])

  // Keyboard shortcut: Ctrl/Cmd+K to open search
  useEffect(() => {
    function handleKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    setQuery('')
    setResults(null)
    setNoResults(false)
    setSearching(false)
    clearTimeout(searchTimer.current)
  }, [])

  const doSearch = useCallback(async (q) => {
    if (!q.trim()) return
    setSearching(true)
    setNoResults(false)
    try {
      const mode = useModeStore.getState().isSFW ? 'social' : 'nsfw'
      const res = await fetch(`/api/search/multi?q=${encodeURIComponent(q)}&limit=12&mode=${mode}`)
      const data = await res.json()
      const videos = (data.videos || data.results || []).map(v => ({
        id: v.id || v.url,
        url: v.url,
        title: v.title || 'Untitled',
        thumbnail: v.thumbnail,
        duration: v.durationFormatted || (v.duration ? `${Math.floor(v.duration / 60)}:${String(v.duration % 60).padStart(2, '0')}` : ''),
        views: v.view_count ? (v.view_count >= 1e6 ? (v.view_count / 1e6).toFixed(1) + 'M' : Math.round(v.view_count / 1e3) + 'K') : '',
        uploader: v.uploader || v.source || '',
        source: v.source || '',
      }))
      if (videos.length > 0) {
        setResults(videos)
        setNoResults(false)
      } else {
        setResults(null)
        setNoResults(true)
      }
    } catch {
      setResults(null)
      setNoResults(true)
    } finally {
      setSearching(false)
    }
  }, [])

  const handleInput = useCallback((value) => {
    setQuery(value)
    clearTimeout(searchTimer.current)
    if (!value.trim()) {
      setResults(null)
      setNoResults(false)
      return
    }
    searchTimer.current = setTimeout(() => doSearch(value.trim()), 300)
  }, [doSearch])

  const handleResultClick = useCallback((item) => {
    // Set as hero item and enter theatre mode to play it
    setHeroItem({
      ...item,
      thumbnailSm: item.thumbnail,
      desc: item.title,
      genre: item.source || 'Video',
      rating: '8.0',
      daysAgo: 1,
    })
    // Navigate home if not already there, then enter theatre
    if (location.pathname !== '/') {
      navigate('/')
    }
    // Small delay to let hero update, then enter theatre
    setTimeout(() => toggleTheatre(), 50)
    closeSearch()
  }, [setHeroItem, toggleTheatre, closeSearch, navigate, location.pathname])

  const navItems = [
    { label: 'Home', path: '/' },
    { label: 'Feed', path: '/feed' },
    { label: 'Library', path: '/library' },
  ]

  return (
    <header
      className="fixed top-0 left-0 right-0 z-system h-14 flex items-center justify-between px-10 bg-white/[0.03] backdrop-blur-2xl border-b border-white/[0.06]"
    >
      {/* Logo */}
      <div className="text-lg font-bold tracking-tight font-display">
        &#128225; <em className="not-italic text-accent">Feed</em>Deck
      </div>

      {/* Nav */}
      <nav className="flex gap-1">
        {navItems.map((item) => (
          <button
            key={item.path}
            onClick={() => navigate(item.path)}
            className={`text-sm font-medium transition-all duration-150 cursor-pointer rounded-full px-3.5 py-1.5 border ${
              location.pathname === item.path
                ? 'text-accent bg-accent/[0.10] border-accent/[0.20]'
                : 'text-text-secondary border-transparent hover:text-text-primary hover:bg-white/[0.05] hover:border-white/[0.06]'
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {/* Right side */}
      <div className="flex items-center gap-3.5">
        {/* Search */}
        <div ref={containerRef} className="relative">
          <div className="flex items-center">
            {/* Search input — expands from the icon */}
            <div
              className={`flex items-center overflow-hidden transition-all duration-200 ease-out rounded-full
                ${searchOpen
                  ? 'w-64 sm:w-80 bg-white/[0.07] border border-white/10 backdrop-blur-lg'
                  : 'w-0'
                }`}
            >
              {searchOpen && (
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => handleInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && query.trim()) doSearch(query.trim())
                    if (e.key === 'Escape') closeSearch()
                  }}
                  placeholder="Search videos..."
                  autoComplete="off"
                  className="w-full h-[34px] bg-transparent text-text-primary text-sm pl-3.5 pr-8
                    outline-none placeholder:text-text-muted font-sans"
                />
              )}
              {searchOpen && query && (
                <button
                  onClick={() => { setQuery(''); setResults(null); setNoResults(false); inputRef.current?.focus() }}
                  className="absolute right-10 text-text-muted hover:text-text-primary transition-colors text-xs px-1"
                >
                  &#10005;
                </button>
              )}
            </div>

            {/* Search icon button */}
            <button
              onClick={() => searchOpen ? closeSearch() : setSearchOpen(true)}
              className="p-2 rounded-lg text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
              title="Search (Ctrl+K)"
              aria-label="Search"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="stroke-current">
                <circle cx="6.5" cy="6.5" r="5" strokeWidth="1.5" />
                <line x1="10.5" y1="10.5" x2="14.5" y2="14.5" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {/* Search results dropdown */}
          {searchOpen && (results || searching || noResults) && (
            <div
              className="absolute right-0 top-full mt-2 w-[400px] max-h-[70vh] overflow-y-auto
                bg-surface/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl
                scrollbar-none"
              style={{ scrollbarWidth: 'none' }}
            >
              {/* Searching indicator */}
              {searching && (
                <div className="px-4 py-3 text-sm text-text-muted flex items-center gap-2">
                  <div className="w-3.5 h-3.5 border-2 border-text-muted/30 border-t-accent rounded-full animate-spin" />
                  Searching...
                </div>
              )}

              {/* No results */}
              {noResults && !searching && (
                <div className="px-4 py-6 text-center">
                  <div className="text-text-muted text-sm">No results for &ldquo;{query}&rdquo;</div>
                  <div className="text-text-muted/50 text-xs mt-1">Try a different term</div>
                </div>
              )}

              {/* Results list */}
              {results && !searching && (
                <div className="py-1.5">
                  <div className="px-4 py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                    {results.length} result{results.length !== 1 ? 's' : ''}
                  </div>
                  {results.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => handleResultClick(item)}
                      className="w-full flex items-center gap-3 px-4 py-2 hover:bg-white/[0.06]
                        transition-colors text-left cursor-pointer group"
                    >
                      {/* Thumbnail */}
                      <div className="flex-none w-20 h-11 rounded overflow-hidden bg-white/5 relative">
                        {item.thumbnail ? (
                          <img
                            src={item.thumbnail}
                            alt=""
                            loading="lazy"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-text-muted text-xs">
                            No img
                          </div>
                        )}
                        {item.duration && (
                          <span className="absolute bottom-0.5 right-0.5 bg-black/75 text-white text-[9px] font-medium px-1 rounded">
                            {item.duration}
                          </span>
                        )}
                      </div>
                      {/* Info */}
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-text-primary font-medium truncate group-hover:text-accent transition-colors">
                          {item.title}
                        </div>
                        <div className="text-xs text-text-muted mt-0.5 flex items-center gap-1.5">
                          {item.uploader && <span>{item.uploader}</span>}
                          {item.views && (
                            <>
                              <span className="text-text-muted/40">&middot;</span>
                              <span>{item.views} views</span>
                            </>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <button
          onClick={() => navigate('/settings')}
          className="p-2 rounded-lg text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
          title="Settings"
          aria-label="Settings"
        >
          ⚙
        </button>
        <button
          onClick={toggleTheme}
          className="p-2 rounded-lg text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? '☀' : '🌙'}
        </button>
        <button
          onClick={toggleMode}
          title={isSFW ? 'Switch to full library' : 'Switch to Social mode'}
          className={`px-3.5 py-1.5 rounded-full text-xs font-semibold cursor-pointer transition-all tracking-wide ${
            isSFW
              ? 'bg-amber-500/[0.06] border border-amber-500/25 text-amber-400 hover:bg-amber-500/[0.12]'
              : 'bg-white/[0.04] border border-white/[0.08] text-text-secondary hover:text-text-primary hover:bg-white/[0.07] hover:border-white/[0.12]'
          }`}
        >
          &#9679; {isSFW ? 'SOCIAL MODE' : 'NSFW MODE'}
        </button>
      </div>
    </header>
  )
}
