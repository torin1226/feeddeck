import { useState, useEffect, useCallback, useRef } from 'react'
import useFeedStore from '../../stores/feedStore'
import useModeStore from '../../stores/modeStore'

// ============================================================
// FeedFilterSheet
// Slide-up modal for filtering the feed by sources, tags,
// and cross-source search. Accessible from feed view.
// ============================================================

export default function FeedFilterSheet({ onClose }) {
  const { filters, setFilters, resetFeed } = useFeedStore()
  const isSFW = useModeStore(s => s.isSFW)

  // Local state mirrors store filters for editing before apply
  const [sources, setSources] = useState([])
  const [selectedSources, setSelectedSources] = useState(new Set(filters.sources || []))
  const [tags, setTags] = useState([])
  const [selectedTags, setSelectedTags] = useState(new Set(filters.tags || []))
  const [searchQuery, setSearchQuery] = useState(filters.searchQuery || '')
  const [searchResults, setSearchResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const [loadingSources, setLoadingSources] = useState(true)
  const [loadingTags, setLoadingTags] = useState(true)
  const searchTimer = useRef(null)

  // Fetch available sources and popular tags in parallel
  useEffect(() => {
    const mode = isSFW ? 'social' : 'nsfw'
    const controller = new AbortController()
    const { signal } = controller

    Promise.all([
      fetch(`/api/sources/list?mode=${mode}`, { signal })
        .then(r => r.json())
        .then(data => setSources(data.sources || data || []))
        .catch(() => {})
        .finally(() => setLoadingSources(false)),
      fetch(`/api/tags/popular?mode=${mode}`, { signal })
        .then(r => r.json())
        .then(data => setTags((data.tags || []).slice(0, 20)))
        .catch(() => {})
        .finally(() => setLoadingTags(false)),
    ])

    return () => controller.abort()
  }, [isSFW])

  // Clear search results on mode change
  useEffect(() => {
    setSearchQuery('')
    setSearchResults(null)
  }, [isSFW])

  // Toggle source selection
  const toggleSource = useCallback((domain) => {
    setSelectedSources(prev => {
      const next = new Set(prev)
      if (next.has(domain)) next.delete(domain)
      else next.add(domain)
      return next
    })
  }, [])

  // Toggle tag selection
  const toggleTag = useCallback((tag) => {
    setSelectedTags(prev => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })
  }, [])

  // Cross-source search with debounce
  const handleSearch = useCallback((value) => {
    setSearchQuery(value)
    clearTimeout(searchTimer.current)
    if (!value.trim()) {
      setSearchResults(null)
      return
    }
    searchTimer.current = setTimeout(async () => {
      setSearching(true)
      try {
        const mode = isSFW ? 'social' : 'nsfw'
        const res = await fetch(`/api/search/multi?q=${encodeURIComponent(value.trim())}&limit=20&mode=${mode}`)
        const data = await res.json()
        setSearchResults(data.results || [])
      } catch {
        setSearchResults(null)
      } finally {
        setSearching(false)
      }
    }, 400)
  }, [isSFW])

  // Apply filters and close
  const applyFilters = useCallback(() => {
    setFilters({
      sources: [...selectedSources],
      tags: [...selectedTags],
      searchQuery: '',
    })
    // Reset and reinit feed with new filters
    resetFeed()
    setTimeout(() => useFeedStore.getState().initFeed(), 0)
    onClose()
  }, [selectedSources, selectedTags, setFilters, resetFeed, onClose])

  // Clear all filters
  const clearAll = useCallback(() => {
    setSelectedSources(new Set())
    setSelectedTags(new Set())
    setSearchQuery('')
    setSearchResults(null)
    setFilters({ sources: [], tags: [], searchQuery: '' })
    resetFeed()
    setTimeout(() => useFeedStore.getState().initFeed(), 0)
    onClose()
  }, [setFilters, resetFeed, onClose])

  // Play a search result in the feed
  const playSearchResult = useCallback((video) => {
    // Add the video to feed buffer and navigate to it
    const feedStore = useFeedStore.getState()
    const newBuffer = [{
      id: video.id || video.url,
      url: video.url,
      streamUrl: null,
      title: video.title,
      uploader: video.uploader || video.source,
      thumbnail: video.thumbnail,
      duration: video.duration,
      source: video.source,
      orientation: 'horizontal',
    }, ...feedStore.buffer]
    useFeedStore.setState({ buffer: newBuffer, currentIndex: 0 })
    onClose()
  }, [onClose])

  const hasActiveFilters = selectedSources.size > 0 || selectedTags.size > 0

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={() => onClose()}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" />

      {/* Sheet */}
      <div
        className="relative w-full max-w-lg bg-[#1a1a1e] rounded-t-2xl overflow-hidden animate-fade-slide-in"
        style={{ maxHeight: '85dvh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mt-3 mb-2" />

        {/* Header */}
        <div className="flex items-center justify-between px-5 pb-3">
          <h2 className="text-base font-semibold text-white">Filter Feed</h2>
          <div className="flex items-center gap-2">
            {hasActiveFilters && (
              <button
                onClick={clearAll}
                className="text-xs text-red-400 hover:text-red-300 transition-colors px-2 py-1"
              >
                Clear All
              </button>
            )}
            <button
              onClick={applyFilters}
              className="px-4 py-1.5 rounded-full bg-accent text-white text-xs font-semibold
                hover:bg-accent/90 transition-colors"
            >
              Apply
            </button>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto px-5 pb-8" style={{ maxHeight: 'calc(85dvh - 80px)' }}>

          {/* Search section */}
          <section className="mb-5">
            <label className="text-[11px] font-semibold text-white/40 uppercase tracking-wider mb-2 block">
              Search Across Sources
            </label>
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none"
                width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={e => handleSearch(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Escape') {
                    setSearchQuery('')
                    setSearchResults(null)
                  }
                }}
                placeholder="Search videos..."
                autoComplete="off"
                className="w-full h-10 bg-white/[0.07] border border-white/10 rounded-xl
                  text-white text-sm pl-10 pr-4 outline-none
                  focus:bg-white/[0.11] focus:border-white/[0.22] transition-all
                  placeholder:text-white/30"
              />
              {searchQuery && (
                <button
                  onClick={() => { setSearchQuery(''); setSearchResults(null) }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white transition-colors"
                >
                  &#10005;
                </button>
              )}
            </div>

            {/* Search results */}
            {searching && (
              <div className="mt-3 text-center text-white/40 text-sm">Searching...</div>
            )}
            {searchResults && searchResults.length > 0 && (
              <div className="mt-3 space-y-1.5 max-h-[200px] overflow-y-auto">
                {searchResults.map((v, i) => (
                  <button
                    key={v.id || i}
                    onClick={() => playSearchResult(v)}
                    className="w-full flex items-center gap-3 p-2 rounded-lg bg-white/[0.05]
                      hover:bg-white/[0.1] transition-colors text-left"
                  >
                    {v.thumbnail && (
                      <img src={v.thumbnail} alt="" className="w-16 h-10 rounded object-cover flex-none" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-white truncate">{v.title}</div>
                      <div className="text-[10px] text-white/40">{v.source || v.uploader}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {searchResults && searchResults.length === 0 && (
              <div className="mt-3 text-center text-white/40 text-sm">No results found</div>
            )}
          </section>

          {/* Source filter section */}
          <section className="mb-5">
            <label className="text-[11px] font-semibold text-white/40 uppercase tracking-wider mb-2 block">
              Sources
              {selectedSources.size > 0 && (
                <span className="ml-2 text-accent normal-case">{selectedSources.size} selected</span>
              )}
            </label>
            {loadingSources ? (
              <div className="text-white/30 text-sm">Loading...</div>
            ) : sources.length === 0 ? (
              <div className="text-white/30 text-sm">No sources configured</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {sources.map(src => {
                  const domain = src.domain || src
                  const label = src.label || domain
                  const active = selectedSources.has(domain)
                  return (
                    <button
                      key={domain}
                      onClick={() => toggleSource(domain)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all border
                        ${active
                          ? 'bg-accent/20 border-accent/40 text-accent'
                          : 'bg-white/[0.06] border-white/10 text-white/60 hover:text-white/80 hover:bg-white/[0.1]'
                        }`}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            )}
          </section>

          {/* Tag filter section */}
          <section className="mb-3">
            <label className="text-[11px] font-semibold text-white/40 uppercase tracking-wider mb-2 block">
              Tags
              {selectedTags.size > 0 && (
                <span className="ml-2 text-accent normal-case">{selectedTags.size} selected</span>
              )}
            </label>
            {loadingTags ? (
              <div className="text-white/30 text-sm">Loading...</div>
            ) : tags.length === 0 ? (
              <div className="text-white/30 text-sm">No tags available</div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {tags.map(t => {
                  const tagName = t.tag || t
                  const active = selectedTags.has(tagName)
                  return (
                    <button
                      key={tagName}
                      onClick={() => toggleTag(tagName)}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-all border
                        ${active
                          ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                          : 'bg-white/[0.05] border-white/[0.08] text-white/50 hover:text-white/70 hover:bg-white/[0.08]'
                        }`}
                    >
                      {tagName}
                    </button>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
