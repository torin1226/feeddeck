import { useState, useRef, useCallback, useEffect } from 'react'
import useHomeStore from '../../stores/homeStore'
import useModeStore from '../../stores/modeStore'

// ============================================================
// HeroCarousel
// Horizontal scroll strip of cards at the bottom of the hero.
// Includes search bar with 380ms debounce.
// ============================================================

export default function HeroCarousel() {
  const { carouselItems, heroItem, setHeroItem, setFocusedItem } = useHomeStore()
  const scrollRef = useRef(null)
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [savedItems, setSavedItems] = useState(null)
  const searchTimer = useRef(null)

  const displayItems = searchResults || carouselItems
  const activeId = heroItem?.id

  // Debounced search
  const handleInput = useCallback(
    (value) => {
      setQuery(value)
      clearTimeout(searchTimer.current)
      if (!value.trim()) {
        clearSearch()
        return
      }
      searchTimer.current = setTimeout(() => {
        doSearch(value.trim())
      }, 380)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [carouselItems]
  )

  const [searching, setSearching] = useState(false)
  const [searchEmpty, setSearchEmpty] = useState(false)

  // Real search via multi-site API
  const doSearch = useCallback(
    async (q) => {
      if (!savedItems) setSavedItems([...carouselItems])
      setSearching(true)
      setSearchEmpty(false)
      try {
        const mode = useModeStore.getState().isSFW ? 'social' : 'nsfw'
        const signal = AbortSignal.timeout(90_000)
        const res = await fetch(`/api/search/multi?q=${encodeURIComponent(q)}&limit=20&mode=${mode}`, { signal })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
        const results = (data.videos || []).map(v => ({
          id: v.id || v.url,
          url: v.url,
          title: v.title,
          thumbnail: v.thumbnail,
          thumbnailSm: v.thumbnail,
          duration: v.durationFormatted || (v.duration ? `${Math.floor(v.duration / 60)}:${String(v.duration % 60).padStart(2, '0')}` : ''),
          views: v.view_count ? `${Math.floor(v.view_count / 1000)}K` : '',
          uploader: v.uploader || v.source || '',
          source: v.source || '',
        }))
        if (results.length > 0) {
          setSearchResults(results)
          setSearchEmpty(false)
        } else {
          setSearchResults(null)
          setSearchEmpty(true)
        }
      } catch {
        setSearchResults(null)
        setSearchEmpty(true)
      } finally {
        setSearching(false)
      }
    },
    [carouselItems, savedItems]
  )

  const clearSearch = useCallback(() => {
    setQuery('')
    setSearchResults(null)
    setSavedItems(null)
    setSearchEmpty(false)
  }, [])

  // Scroll active card into view
  useEffect(() => {
    if (!scrollRef.current || !activeId) return
    const active = scrollRef.current.querySelector(`[data-card-id="${activeId}"]`)
    if (active) active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [activeId])

  return (
    <div className="[&_*]:pointer-events-auto">
      {/* Search row */}
      <div className="px-10 mb-3">
        <div className="relative max-w-[360px]">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted text-sm pointer-events-none">
            &#8981;
          </span>
          <input
            type="text"
            value={query}
            onChange={(e) => handleInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') doSearch(query)
              if (e.key === 'Escape') {
                clearSearch()
                e.target.blur()
              }
            }}
            placeholder="Search videos..."
            autoComplete="off"
            className="w-full h-[34px] bg-white/[0.07] border border-white/10 rounded-full
              text-text-primary text-label pl-[34px] pr-9 outline-none
              focus:bg-white/[0.11] focus:border-white/[0.22] transition-all
              placeholder:text-text-muted backdrop-blur-lg font-sans"
          />
          {query && (
            <button
              onClick={clearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors text-base leading-none px-1 py-0.5"
            >
              &#10005;
            </button>
          )}
        </div>
      </div>
      <div className="px-10 mb-2">
        <div className="text-caption font-semibold text-text-muted uppercase tracking-wider flex items-center gap-2">
          <span>{searching ? 'Searching...' : searchResults ? `Results for \u201C${query}\u201D` : 'Up Next'}</span>
          {searchResults && (
            <span className="bg-accent/20 text-accent rounded px-1.5 py-0.5 text-micro tracking-wide">
              {searchResults.length} found
            </span>
          )}
        </div>
      </div>

      {/* No results message */}
      {searchEmpty && !searching && query && (
        <div className="px-10 py-6 text-center">
          <div className="text-text-muted text-sm">No results found for &ldquo;{query}&rdquo;</div>
          <div className="text-text-muted/60 text-xs mt-1">Try a different search term</div>
        </div>
      )}

      {/* Scrollable card strip */}
      <div
        ref={scrollRef}
        className="flex gap-3 overflow-x-auto px-10 py-1 scrollbar-none"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {displayItems.map((item) => (
          <CarouselCard
            key={item.id}
            item={item}
            isActive={item.id === activeId}
            onClick={() => setHeroItem(item)}
            onHover={() => setFocusedItem(item, 'hero-carousel')}
          />
        ))}
      </div>
    </div>
  )
}

function CarouselCard({ item, isActive, onClick, onHover }) {
  return (
    <div
      data-card-id={item.id}
      onClick={onClick}
      onMouseEnter={onHover}
      onFocus={onHover}
      tabIndex={0}
      className={`flex-none w-[160px] h-[90px] rounded-lg overflow-hidden cursor-pointer
        relative transition-all duration-250 ease-out border-2 bg-overlay
        ${isActive ? 'border-accent shadow-glow-accent' : 'border-transparent'}
        hover:scale-[var(--hover-scale)] hover:-translate-y-0.5 hover:shadow-card-hover`}
    >
      <img
        src={item.thumbnailSm || item.thumbnail}
        alt={item.title}
        loading="lazy"
        className="w-full h-full object-cover transition-transform duration-300 hover:scale-[var(--hover-scale)]"
      />
      {/* Overlay with title */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/[0.75] via-transparent to-transparent flex flex-col justify-end p-2">
        <div className="text-caption font-semibold text-white truncate leading-tight">
          {item.title}
        </div>
        <div className="text-micro font-medium text-white/50 mt-0.5">{item.duration}</div>
      </div>
      {/* Play indicator on active card */}
      {isActive && (
        <div className="absolute inset-0 flex items-center justify-center text-xl text-white drop-shadow-lg">
          &#9654;
        </div>
      )}
    </div>
  )
}
