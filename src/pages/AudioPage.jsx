import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import useAudioFeedStore from '../stores/audioFeedStore'
import useModeStore from '../stores/modeStore'
import HomeHeader from '../components/home/HomeHeader'
import AudioCard from '../components/audio/AudioCard'
// AudioPlayer is mounted at AppShell so playback persists across routes.

// ============================================================
// AudioPage
// /audio — typography-focused audio feed. NSFW-mode-gated.
// Sticky AudioPlayer pinned to the bottom; cards above scroll
// normally. No thumbnails — title is the dominant element.
//
// See plan: generic-exploring-lampson.md.
// ============================================================

export default function AudioPage() {
  const isSFW = useModeStore(s => s.isSFW)
  const items = useAudioFeedStore(s => s.items)
  const loading = useAudioFeedStore(s => s.loading)
  const error = useAudioFeedStore(s => s.error)
  const loadFeed = useAudioFeedStore(s => s.loadFeed)
  const creatorFilter = useAudioFeedStore(s => s.creatorFilter)
  const sourceFilter = useAudioFeedStore(s => s.sourceFilter)
  const setCreatorFilter = useAudioFeedStore(s => s.setCreatorFilter)
  const setSourceFilter = useAudioFeedStore(s => s.setSourceFilter)
  const query = useAudioFeedStore(s => s.query)
  const setQuery = useAudioFeedStore(s => s.setQuery)
  const clearFilters = useAudioFeedStore(s => s.clearFilters)
  const currentIndex = useAudioFeedStore(s => s.currentIndex)

  const [stats, setStats] = useState(null)
  // Local input value so typing is responsive; debounced setQuery (the
  // store-level call that triggers a fetch) fires 250ms after last keypress.
  // Kept in sync with store query (tag-pill clicks update the store directly).
  const [inputValue, setInputValue] = useState(query)
  const debounceRef = useRef(null)
  useEffect(() => { setInputValue(query) }, [query])
  const onInputChange = (e) => {
    const v = e.target.value
    setInputValue(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setQuery(v), 250)
  }
  const onClearSearch = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setInputValue('')
    setQuery('')
  }
  const hasFilters = !!(query || creatorFilter || sourceFilter)

  useEffect(() => {
    loadFeed()
  }, [loadFeed])

  // Pull stats for the filter chips (creator + source breakdowns).
  useEffect(() => {
    fetch('/api/audio/stats')
      .then(r => r.ok ? r.json() : null)
      .then(setStats)
      .catch(() => setStats(null))
  }, [items.length])

  const topCreators = useMemo(() => (stats?.byCreator || []).slice(0, 6), [stats])
  const sources = useMemo(() => stats?.bySource || [], [stats])
  const playerActive = currentIndex >= 0

  // SFW mode shows a tasteful empty state — the route still exists, but
  // audio porn is gated behind NSFW mode like everything else.
  if (isSFW) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-200">
        <HomeHeader />
        <div className="max-w-2xl mx-auto px-6 pt-32 pb-24 text-center">
          <h1
            className="text-3xl tracking-tight text-zinc-100"
            style={{ fontFamily: '"Iowan Old Style","Constantia","Georgia",serif' }}
          >
            Audio is on the other side
          </h1>
          <p className="mt-3 text-zinc-400">
            Switch to NSFW mode to see the audio feed.
          </p>
          <Link
            to="/"
            className="mt-6 inline-block text-sm text-rose-400 hover:text-rose-300"
          >
            ← Home
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200">
      <HomeHeader />
      {/* Header */}
      <div className="max-w-3xl mx-auto px-6 pt-20 pb-6">
        <h1
          className="text-4xl tracking-tight text-zinc-100"
          style={{ fontFamily: '"Iowan Old Style","Constantia","Georgia",serif' }}
        >
          Audio
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          Voice-first, evergreen. {stats ? `${stats.total} tracks · ${stats.unrated} unrated` : ''}
        </p>

        {/* Search bar */}
        <div className="mt-5 relative">
          <input
            type="search"
            inputMode="search"
            value={inputValue}
            onChange={onInputChange}
            placeholder="Search title, creator, or tag…"
            className="w-full bg-zinc-900/60 ring-1 ring-white/5 focus:ring-rose-400/40 focus:bg-zinc-900/90 rounded-xl pl-10 pr-10 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none transition-colors"
            aria-label="Search audio"
          />
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          {inputValue && (
            <button
              type="button"
              onClick={onClearSearch}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full text-zinc-500 hover:text-zinc-200 hover:bg-white/5"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M6 6l12 12M6 18L18 6" />
              </svg>
            </button>
          )}
        </div>

        {/* Active filter row — shown only when at least one filter is on. */}
        {hasFilters && (
          <div className="mt-3 flex flex-wrap gap-2 items-center">
            {query && (
              <span className="text-xs px-2.5 py-1 rounded-full bg-rose-500/15 text-rose-200 ring-1 ring-rose-400/30 inline-flex items-center gap-1.5">
                <span className="text-rose-300/80">search:</span>
                <span className="font-medium">{query}</span>
                <button
                  onClick={() => setQuery('')}
                  className="hover:text-rose-50"
                  aria-label="Clear search filter"
                >×</button>
              </span>
            )}
            {creatorFilter && (
              <span className="text-xs px-2.5 py-1 rounded-full bg-rose-500/15 text-rose-200 ring-1 ring-rose-400/30 inline-flex items-center gap-1.5">
                <span className="text-rose-300/80">creator:</span>
                <span className="font-medium">{creatorFilter}</span>
                <button onClick={() => setCreatorFilter(null)} aria-label="Clear creator filter">×</button>
              </span>
            )}
            {sourceFilter && (
              <span className="text-xs px-2.5 py-1 rounded-full bg-rose-500/15 text-rose-200 ring-1 ring-rose-400/30 inline-flex items-center gap-1.5">
                <span className="text-rose-300/80">source:</span>
                <span className="font-medium">{sourceFilter}</span>
                <button onClick={() => setSourceFilter(null)} aria-label="Clear source filter">×</button>
              </span>
            )}
            <button
              onClick={clearFilters}
              className="text-[10px] uppercase tracking-widest text-zinc-500 hover:text-zinc-300 px-2 py-1 rounded"
            >
              clear all
            </button>
          </div>
        )}

        {/* Filter chips */}
        {(topCreators.length > 0 || sources.length > 0) && (
          <div className="mt-6 space-y-3">
            {sources.length > 1 && (
              <div className="flex flex-wrap gap-2 items-center">
                <span className="text-[10px] uppercase tracking-widest text-zinc-600 mr-1">Source</span>
                <button
                  onClick={() => setSourceFilter(null)}
                  className={chip(!sourceFilter)}
                >
                  all
                </button>
                {sources.map(s => (
                  <button
                    key={s.source_domain}
                    onClick={() => setSourceFilter(s.source_domain)}
                    className={chip(sourceFilter === s.source_domain)}
                  >
                    {s.source_domain.replace('.com', '').replace('.net', '')} · {s.n}
                  </button>
                ))}
              </div>
            )}
            {topCreators.length > 0 && (
              <div className="flex flex-wrap gap-2 items-center">
                <span className="text-[10px] uppercase tracking-widest text-zinc-600 mr-1">Creator</span>
                <button
                  onClick={() => setCreatorFilter(null)}
                  className={chip(!creatorFilter)}
                >
                  all
                </button>
                {topCreators.map(c => (
                  <button
                    key={c.creator}
                    onClick={() => setCreatorFilter(c.creator)}
                    className={chip(creatorFilter === c.creator)}
                  >
                    {c.creator} · {c.n}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Card list */}
      <div
        className="max-w-3xl mx-auto px-6 pb-32"
        style={{ paddingBottom: playerActive ? 160 : 80 }}
      >
        {loading && items.length === 0 && (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-28 rounded-2xl bg-zinc-900/30 animate-pulse" />
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-xl bg-rose-950/30 ring-1 ring-rose-500/20 px-4 py-3 text-sm text-rose-200">
            Failed to load: {error}
          </div>
        )}

        {!loading && items.length === 0 && !error && (
          <div className="text-center py-16">
            {hasFilters ? (
              <>
                <p className="text-zinc-400">No matches.</p>
                <button
                  onClick={clearFilters}
                  className="mt-3 text-sm text-rose-400 hover:text-rose-300"
                >
                  Clear filters
                </button>
              </>
            ) : (
              <>
                <p className="text-zinc-400">No audio yet.</p>
                <p className="mt-2 text-sm text-zinc-600">
                  Add a Reddit subreddit or Soundgasm creator and the next fetch cycle will fill this in.
                </p>
              </>
            )}
          </div>
        )}

        <div className="space-y-3">
          {items.map(item => (
            <AudioCard key={item.id} item={item} />
          ))}
        </div>
      </div>
    </div>
  )
}

function chip(active) {
  return `text-xs px-3 py-1 rounded-full transition-colors ${
    active
      ? 'bg-rose-500/20 text-rose-200 ring-1 ring-rose-400/40'
      : 'bg-zinc-900/60 text-zinc-400 ring-1 ring-white/5 hover:bg-zinc-800/80 hover:text-zinc-200'
  }`
}
