import { useState, useRef, useCallback, useEffect } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import useViewTransitionNavigate from '../../hooks/useViewTransitionNavigate'
import useHomeStore from '../../stores/homeStore'
import useModeStore from '../../stores/modeStore'
import useDeviceStore from '../../stores/deviceStore'

// ============================================================
// HomeHeader
// Fixed transparent header for the homepage. Nav links, logo,
// search, and mode pill. Gradient background that fades to
// transparent.
// ============================================================

export default function HomeHeader() {
  const navigate = useViewTransitionNavigate()
  const location = useLocation()
  const [urlParams] = useSearchParams()
  const shuffleHome = useHomeStore(s => s.shuffleHome)
  const shuffling = useHomeStore(s => s.shuffling)
  const refreshing = useHomeStore(s => s.refreshing)
  const { isSFW, toggleMode } = useModeStore()
  const mobilePreview = useDeviceStore(s => s.mobilePreview)
  const toggleMobilePreview = useDeviceStore(s => s.toggleMobilePreview)
  const isDev = import.meta.env.DEV

  // --- Search state ---
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const [noResults, setNoResults] = useState(false)
  const [searchError, setSearchError] = useState(null)

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
    setSearchError(null)
    setSearching(false)
    clearTimeout(searchTimer.current)
  }, [])

  const doSearch = useCallback(async (q) => {
    if (!q.trim()) return
    setSearching(true)
    setNoResults(false)
    setSearchError(null)
    try {
      const mode = useModeStore.getState().isSFW ? 'social' : 'nsfw'
      // Search fans out to all sources server-side; YouTube via yt-dlp can take ~30-60s
      const signal = AbortSignal.timeout(90_000)
      const res = await fetch(`/api/search/multi?q=${encodeURIComponent(q)}&limit=12&mode=${mode}`, { signal })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setResults(null)
        setNoResults(false)
        setSearchError(data.error || `Search failed (HTTP ${res.status})`)
        return
      }
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
    } catch (err) {
      setResults(null)
      setNoResults(false)
      const msg = err?.name === 'TimeoutError' || err?.name === 'AbortError'
        ? 'Search timed out — try again or a more specific query'
        : err?.message || 'Search request failed'
      setSearchError(msg)
    } finally {
      setSearching(false)
    }
  }, [])

  // Submit (Enter): commit to the dedicated SearchPage instead of fetching inline.
  // Use replace when already on /search to avoid back-button spam.
  const submitSearch = useCallback((q) => {
    const trimmed = (q || '').trim()
    if (!trimmed) return
    const target = `/search?q=${encodeURIComponent(trimmed)}`
    if (location.pathname === '/search') {
      navigate(target, { replace: true })
    } else {
      navigate(target)
    }
    clearTimeout(searchTimer.current)
    setSearchOpen(false)
    setResults(null)
    setNoResults(false)
    setSearchError(null)
    setSearching(false)
  }, [location.pathname, navigate])

  // When on /search, pre-fill the input with the q URL param so the user
  // can edit and re-submit. Open the search bar so the input is visible.
  useEffect(() => {
    if (location.pathname !== '/search') return
    const urlQ = urlParams.get('q') || ''
    if (urlQ && urlQ !== query) {
      setQuery(urlQ)
      setSearchOpen(true)
    }
    // Intentionally only react to URL changes, not local query edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, urlParams])

  const handleInput = useCallback((value) => {
    setQuery(value)
    clearTimeout(searchTimer.current)
    if (!value.trim()) {
      setResults(null)
      setNoResults(false)
      setSearchError(null)
      return
    }
    searchTimer.current = setTimeout(() => doSearch(value.trim()), 300)
  }, [doSearch])

  const handleResultClick = useCallback((item) => {
    const id = item.id || item.url
    if (!id) {
      closeSearch()
      return
    }
    closeSearch()
    navigate(`/watch/${encodeURIComponent(id)}`)
  }, [closeSearch, navigate])

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
      <div className="flex items-center gap-5">
        {/* Search */}
        <div ref={containerRef} className="relative">
          <div className="flex items-center">
            {/* Search input — expands from the icon */}
            <div
              className={`relative flex items-center overflow-hidden transition-all duration-200 ease-out rounded-full
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
                    if (e.key === 'Enter' && query.trim()) submitSearch(query.trim())
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
                  onClick={() => { setQuery(''); setResults(null); setNoResults(false); setSearchError(null); inputRef.current?.focus() }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors text-xs px-1"
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
          {searchOpen && (results || searching || noResults || searchError) && (
            <div
              className="absolute right-0 top-full mt-2 w-[400px] max-h-[60vh] overflow-y-auto
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

              {/* Error */}
              {searchError && !searching && (
                <div className="px-4 py-5 text-center">
                  <div className="text-blue-400 text-sm font-medium">Search failed</div>
                  <div className="text-text-muted/70 text-xs mt-1 break-words">{searchError}</div>
                </div>
              )}

              {/* No results */}
              {noResults && !searching && !searchError && (
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

        <div className="w-px h-5 bg-white/10" aria-hidden="true" />

        {/* Shuffle (rotates first 5 cards in every row except Likes) */}
        <button
          onClick={() => shuffleHome(isSFW ? 'social' : 'nsfw')}
          disabled={shuffling || refreshing}
          className="p-2 rounded-lg text-text-secondary hover:text-text-primary transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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

        <button
          onClick={() => navigate('/settings')}
          className="p-2 rounded-lg text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
          title="Settings"
          aria-label="Settings"
        >
          ⚙
        </button>
        {isDev && (
          <button
            onClick={toggleMobilePreview}
            className={`p-2 rounded-lg transition-colors cursor-pointer ${
              mobilePreview
                ? 'bg-accent text-black hover:bg-accent/80'
                : 'text-text-secondary hover:text-text-primary'
            }`}
            title="Toggle mobile preview (Ctrl+M)"
            aria-label="Toggle mobile preview"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
              <line x1="12" y1="18" x2="12" y2="18" />
            </svg>
          </button>
        )}
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
