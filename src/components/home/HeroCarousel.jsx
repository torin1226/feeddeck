import { useState, useRef, useCallback, useEffect } from 'react'
import useHomeStore from '../../stores/homeStore'

// ============================================================
// HeroCarousel
// Horizontal scroll strip of cards at the bottom of the hero.
// Includes search bar with 380ms debounce.
// ============================================================

export default function HeroCarousel() {
  const { carouselItems, heroItem, setHeroItem } = useHomeStore()
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
    [carouselItems]
  )

  // Generate fake search results (matches mockup behavior)
  const doSearch = useCallback(
    (q) => {
      if (!savedItems) setSavedItems([...carouselItems])

      // Seed a deterministic-ish set of results from query
      const seed = q.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
      const results = Array.from({ length: 18 }, (_, i) => {
        const id = 700 + (seed % 200) + i
        return {
          id: `search-${id}`,
          title: `${q} – Result ${i + 1}`,
          thumbnailSm: `https://picsum.photos/seed/${id}/320/180`,
          thumbnail: `https://picsum.photos/seed/${id}/1280/720`,
          duration: `${Math.floor(Math.random() * 30)}:${Math.floor(Math.random() * 60)
            .toString()
            .padStart(2, '0')}`,
          views: `${Math.floor(Math.random() * 9000) + 500}`,
          uploader: 'SearchTV',
          daysAgo: Math.floor(Math.random() * 30) + 1,
          desc: 'Search result.',
          genre: 'Search',
          rating: (7 + Math.random() * 2.5).toFixed(1),
        }
      })
      setSearchResults(results)
    },
    [carouselItems, savedItems]
  )

  const clearSearch = useCallback(() => {
    setQuery('')
    setSearchResults(null)
    setSavedItems(null)
  }, [])

  // Scroll active card into view
  useEffect(() => {
    if (!scrollRef.current || !activeId) return
    const active = scrollRef.current.querySelector(`[data-card-id="${activeId}"]`)
    if (active) active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [activeId])

  return (
    <div>
      {/* Search row */}
      <div className="px-10 mb-3.5">
        <div className="relative max-w-[280px]">
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
              text-text-primary text-[12px] pl-[34px] pr-9 outline-none
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
        <div className="text-[11px] font-semibold text-text-muted uppercase tracking-wider flex items-center gap-2 mt-2">
          <span>{searchResults ? `Results for \u201C${query}\u201D` : 'Up Next'}</span>
          {searchResults && (
            <span className="bg-accent/20 text-accent rounded px-1.5 py-0.5 text-[10px] tracking-wide">
              {searchResults.length} found
            </span>
          )}
        </div>
      </div>

      {/* Scrollable card strip */}
      <div
        ref={scrollRef}
        className="flex gap-2.5 overflow-x-auto px-10 py-1 scrollbar-none"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {displayItems.map((item) => (
          <CarouselCard
            key={item.id}
            item={item}
            isActive={item.id === activeId}
            onClick={() => setHeroItem(item)}
          />
        ))}

        {/* Load more ghost card */}
        {!searchResults && (
          <div
            onClick={() => {
              // In real app, this would load more. For now, noop.
            }}
            className="flex-none w-[230px] h-[130px] rounded-lg flex items-center justify-center
              flex-col gap-1.5 bg-raised border border-dashed border-surface-border
              text-text-muted text-[11px] font-medium cursor-pointer
              hover:bg-overlay hover:text-text-secondary transition-all"
          >
            <span className="text-xl">+</span>
            <span>Load more</span>
          </div>
        )}
      </div>
    </div>
  )
}

function CarouselCard({ item, isActive, onClick }) {
  return (
    <div
      data-card-id={item.id}
      onClick={onClick}
      className={`flex-none w-[230px] h-[130px] rounded-lg overflow-hidden cursor-pointer
        relative transition-all duration-250 ease-out border-2 bg-overlay
        ${isActive ? 'border-accent shadow-[0_0_0_1px_#e50914,0_8px_32px_rgba(229,9,20,0.25)]' : 'border-transparent'}
        hover:scale-[1.06] hover:-translate-y-1`}
    >
      <img
        src={item.thumbnailSm || item.thumbnail}
        alt={item.title}
        loading="lazy"
        className="w-full h-full object-cover transition-transform duration-400 hover:scale-[1.06]"
      />
      {/* Overlay with title */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/[0.85] via-transparent to-transparent flex flex-col justify-end p-2">
        <div className="text-[10px] font-semibold text-white truncate leading-tight">
          {item.title}
        </div>
        <div className="text-[9px] text-white/50 mt-0.5">{item.duration}</div>
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
