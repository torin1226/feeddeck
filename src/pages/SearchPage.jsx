import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import HomeHeader from '../components/home/HomeHeader'
import VideoCard from '../components/VideoCard'
import EmptyIllustration from '../components/EmptyIllustration'
import useViewTransitionNavigate from '../hooks/useViewTransitionNavigate'
import useLibraryStore from '../stores/libraryStore'
import useModeStore from '../stores/modeStore'
import { isVideoForMode, modeFromIsSFW, filterByMode } from '../utils/mode'

// ============================================================
// SearchPage
// Dedicated /search?q=<query> destination. Streams results via
// SSE and renders them into a responsive grid. A simplified
// library grid sits below as a fallback browsing surface.
// ============================================================

const RESULT_COUNT = 20
const LIBRARY_LIMIT = 20

function GridSkeleton({ count }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={`sk-${i}`} className="w-full">
          <div className="w-full aspect-video rounded-lg mb-2 animate-shimmer bg-[length:200%_100%] bg-gradient-to-r from-white/[0.04] via-white/[0.10] to-white/[0.04]" />
          <div className="h-3 w-3/4 mb-1.5 rounded animate-shimmer bg-[length:200%_100%] bg-gradient-to-r from-white/[0.04] via-white/[0.10] to-white/[0.04]" />
          <div className="h-2.5 w-1/2 rounded animate-shimmer bg-[length:200%_100%] bg-gradient-to-r from-white/[0.04] via-white/[0.10] to-white/[0.04]" />
        </div>
      ))}
    </>
  )
}

export default function SearchPage() {
  const [params] = useSearchParams()
  const navigate = useViewTransitionNavigate()
  const isSFW = useModeStore(s => s.isSFW)
  const mode = modeFromIsSFW(isSFW)
  const libraryVideos = useLibraryStore(s => s.videos)

  const rawQuery = params.get('q') || ''
  const query = rawQuery.trim()

  // Primary search state
  const [results, setResults] = useState([])
  const [streaming, setStreaming] = useState(false)
  const [streamError, setStreamError] = useState(null)
  const [completed, setCompleted] = useState(false)
  const historyIdRef = useRef(null)

  // Empty-state fallback
  const [fallbackQuery, setFallbackQuery] = useState(null)
  const [fallbackResults, setFallbackResults] = useState([])
  const [fallbackStreaming, setFallbackStreaming] = useState(false)

  // Reset on query/mode change
  useEffect(() => {
    historyIdRef.current = null
    setFallbackQuery(null)
    setFallbackResults([])
    setFallbackStreaming(false)
  }, [query, mode])

  // Primary SSE stream
  useEffect(() => {
    if (!query) {
      setResults([])
      setStreaming(false)
      setStreamError(null)
      setCompleted(false)
      return
    }

    setResults([])
    setStreamError(null)
    setCompleted(false)
    setStreaming(true)

    const url = `/api/search?q=${encodeURIComponent(query)}&count=${RESULT_COUNT}&mode=${mode}`
    const es = new EventSource(url)
    let collected = []

    es.onmessage = (e) => {
      if (e.data === '[done]') {
        setStreaming(false)
        setCompleted(true)
        es.close()
        // Record the search
        fetch('/api/search/history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, mode, result_count: collected.length }),
        })
          .then(r => r.ok ? r.json() : null)
          .then(data => { if (data?.id) historyIdRef.current = data.id })
          .catch(() => {})
        return
      }
      try {
        const video = JSON.parse(e.data)
        if (isVideoForMode(video, mode)) {
          collected = [...collected, video]
          setResults(collected)
        }
      } catch {}
    }

    es.onerror = () => {
      setStreamError('Search failed')
      setStreaming(false)
      es.close()
    }

    return () => es.close()
  }, [query, mode])

  // Fallback: when primary stream completes empty, run the most recent successful search
  useEffect(() => {
    if (!completed) return
    if (results.length > 0) return
    if (streamError) return
    if (!query) return
    let cancelled = false

    fetch(`/api/search/history?mode=${mode}&has_results=true&limit=1`)
      .then(r => r.ok ? r.json() : { history: [] })
      .then(data => {
        if (cancelled) return
        const prev = data?.history?.[0]
        if (!prev?.query || prev.query.trim().toLowerCase() === query.toLowerCase()) return
        setFallbackQuery(prev.query)
        setFallbackResults([])
        setFallbackStreaming(true)
      })
      .catch(() => {})

    return () => { cancelled = true }
  }, [completed, results.length, streamError, query, mode])

  // Run the fallback SSE
  useEffect(() => {
    if (!fallbackQuery) return
    setFallbackResults([])
    setFallbackStreaming(true)
    const url = `/api/search?q=${encodeURIComponent(fallbackQuery)}&count=${RESULT_COUNT}&mode=${mode}`
    const es = new EventSource(url)
    let collected = []

    es.onmessage = (e) => {
      if (e.data === '[done]') {
        setFallbackStreaming(false)
        es.close()
        return
      }
      try {
        const video = JSON.parse(e.data)
        if (isVideoForMode(video, mode)) {
          collected = [...collected, video]
          setFallbackResults(collected)
        }
      } catch {}
    }

    es.onerror = () => {
      setFallbackStreaming(false)
      es.close()
    }

    return () => es.close()
  }, [fallbackQuery, mode])

  // Card click — record click then navigate
  const handleCardClick = (video) => {
    const id = video.id || video.url
    if (historyIdRef.current) {
      fetch(`/api/search/history/${historyIdRef.current}/click`, { method: 'PATCH' }).catch(() => {})
    }
    navigate(`/video/${encodeURIComponent(id)}`)
  }

  // Library grid (mode-filtered, capped)
  const libraryForMode = filterByMode(libraryVideos || [], mode)
  const libraryDisplay = libraryForMode.slice(0, LIBRARY_LIMIT)
  const libraryHasMore = libraryForMode.length > LIBRARY_LIMIT

  // ----- Render -----

  const showEmpty = completed && results.length === 0 && !streamError
  const showError = !!streamError && results.length === 0

  return (
    <div className="min-h-dvh bg-surface text-text-primary">
      <HomeHeader />
      <div className="pt-20 pb-16 px-10 max-w-[1600px] mx-auto">

        {/* Results section */}
        <section className="mb-10">
          <div className="flex items-baseline gap-3 mb-5">
            <h2 className="font-display text-2xl font-semibold">
              {query ? <>Results for &ldquo;{query}&rdquo;</> : <>Search</>}
            </h2>
            {query && results.length > 0 && (
              <span className="text-text-muted text-sm">{results.length} result{results.length !== 1 ? 's' : ''}</span>
            )}
            {streaming && (
              <span className="text-text-muted/70 text-xs animate-pulse">fetching&hellip;</span>
            )}
          </div>

          {!query && (
            <div className="py-12 flex flex-col items-center text-text-muted">
              <EmptyIllustration variant="search" className="w-20 h-20 mb-3" />
              <div className="text-sm">Type a query in the header to search.</div>
            </div>
          )}

          {query && (results.length > 0 || streaming) && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {results.map((video, i) => (
                <div
                  key={video.id || video.url || i}
                  className="animate-fade-slide-in"
                  style={{ animationDelay: `${Math.min(i * 40, 200)}ms` }}
                >
                  <VideoCard video={video} onClick={handleCardClick} />
                </div>
              ))}
              {streaming && (
                <GridSkeleton count={results.length === 0 ? 8 : 2} />
              )}
            </div>
          )}

          {showError && (
            <div className="py-12 flex flex-col items-center text-center">
              <EmptyIllustration variant="error" className="w-20 h-20 mb-3 text-blue-400" />
              <div className="text-sm text-blue-400 font-medium mb-1">{streamError}</div>
              <button
                onClick={() => {
                  setStreamError(null)
                  setCompleted(false)
                  // Re-key the effect by toggling: easiest is reload-by-route
                  navigate(`/search?q=${encodeURIComponent(query)}`, { replace: true })
                }}
                className="mt-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-white/[0.06] border border-white/[0.12] hover:bg-white/[0.10] cursor-pointer"
              >
                Retry
              </button>
            </div>
          )}

          {showEmpty && (
            <div className="py-10 flex flex-col items-center text-center">
              <EmptyIllustration variant="search" className="w-20 h-20 mb-3 text-text-muted" />
              <div className="text-sm text-text-muted">No results for &ldquo;{query}&rdquo;</div>
              <div className="text-xs text-text-muted/60 mt-1">Try a different term</div>
            </div>
          )}

          {/* Fallback section: most recent successful search */}
          {showEmpty && fallbackQuery && (
            <div className="mt-8">
              <div className="flex items-baseline gap-3 mb-4">
                <h3 className="font-display text-base text-text-secondary">
                  Showing results for &ldquo;{fallbackQuery}&rdquo; instead
                </h3>
                {fallbackStreaming && (
                  <span className="text-text-muted/70 text-xs animate-pulse">fetching&hellip;</span>
                )}
              </div>
              {(fallbackResults.length > 0 || fallbackStreaming) && (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                  {fallbackResults.map((video, i) => (
                    <div
                      key={`fb-${video.id || video.url || i}`}
                      className="animate-fade-slide-in"
                      style={{ animationDelay: `${Math.min(i * 40, 200)}ms` }}
                    >
                      <VideoCard video={video} onClick={handleCardClick} />
                    </div>
                  ))}
                  {fallbackStreaming && (
                    <GridSkeleton count={fallbackResults.length === 0 ? 8 : 2} />
                  )}
                </div>
              )}
            </div>
          )}
        </section>

        {/* Divider */}
        <div className="border-b border-surface-border my-8" />

        {/* Library section */}
        <section>
          <div className="flex items-baseline gap-3 mb-5">
            <h2 className="font-display text-xl font-semibold text-text-secondary">Your Library</h2>
            {libraryDisplay.length > 0 && (
              <span className="text-text-muted text-sm">{libraryForMode.length} video{libraryForMode.length !== 1 ? 's' : ''}</span>
            )}
          </div>

          {libraryDisplay.length === 0 ? (
            <div className="py-10 flex flex-col items-center text-center">
              <div className="text-sm text-text-muted mb-3">No videos in your library yet</div>
              <button
                onClick={() => navigate('/feed')}
                className="px-4 py-2 rounded-full text-sm font-semibold bg-accent/[0.10] border border-accent/[0.20] text-accent hover:bg-accent/[0.16] cursor-pointer"
              >
                Browse Feed
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {libraryDisplay.map((video) => (
                  <VideoCard
                    key={video.id || video.url}
                    video={video}
                    onClick={(v) => navigate(`/video/${encodeURIComponent(v.id || v.url)}`)}
                  />
                ))}
              </div>
              {libraryHasMore && (
                <div className="mt-5 flex justify-center">
                  <button
                    onClick={() => navigate('/library')}
                    className="px-4 py-1.5 rounded-full text-sm font-medium bg-white/[0.04] border border-white/[0.08] text-text-secondary hover:text-text-primary hover:bg-white/[0.07] cursor-pointer"
                  >
                    View full library &rarr;
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  )
}
