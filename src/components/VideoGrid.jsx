import { useEffect, useMemo, useRef, useState } from 'react'
import useLibraryStore from '../stores/libraryStore'
import useModeStore from '../stores/modeStore'
import VideoCard from './VideoCard'
import VideoPlayer from './VideoPlayer'

// ============================================================
// VideoGrid
// Responsive grid of video thumbnails.
// - Local library filtered by searchQuery (keystroke)
// - SSE search results streamed by remoteQuery (form submit)
// Columns: 2 (sm) / 3 (md) / 4 (lg) / 5 (xl)
// ============================================================

export default function VideoGrid({ searchQuery, remoteQuery }) {
  const { videos } = useLibraryStore()
  const { isSFW } = useModeStore()
  const [activeVideo, setActiveVideo] = useState(null)

  // Filter local library by keystroke query
  const filtered = useMemo(() => {
    if (!searchQuery?.trim()) return videos
    const q = searchQuery.toLowerCase()
    return videos.filter((v) =>
      v.title?.toLowerCase().includes(q) ||
      v.tags?.some((t) => t.toLowerCase().includes(q)) ||
      v.source?.toLowerCase().includes(q)
    )
  }, [videos, searchQuery])

  return (
    <>
      {activeVideo && (
        <VideoPlayer
          video={activeVideo}
          onClose={() => setActiveVideo(null)}
          onPlayVideo={setActiveVideo}
        />
      )}

      {/* SSE search results — shown when user submits a search */}
      {remoteQuery && (
        <SearchResults query={remoteQuery} onPlay={setActiveVideo} />
      )}

      {/* Local library grid */}
      <div className="p-4 md:p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-text-primary">
            Library
            <span className="text-text-muted font-normal ml-2 text-sm">
              {filtered.length} {filtered.length === 1 ? 'video' : 'videos'}
            </span>
          </h2>
        </div>

        {filtered.length === 0 ? (
          <EmptyState isSFW={isSFW} hasSearch={!!searchQuery?.trim()} />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 md:gap-5">
            {filtered.map((video) => (
              <VideoCard key={video.id} video={video} onClick={setActiveVideo} />
            ))}
          </div>
        )}
      </div>
    </>
  )
}

// -----------------------------------------------------------
// SearchResults
// Opens an EventSource to /api/search and renders cards as
// they stream in, with skeleton placeholders while loading.
// -----------------------------------------------------------
function SearchResults({ query, onPlay }) {
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(true)
  const esRef = useRef(null)

  useEffect(() => {
    setResults([])
    setLoading(true)

    const es = new EventSource(`/api/search?q=${encodeURIComponent(query)}&count=12`)
    esRef.current = es

    es.onmessage = (e) => {
      if (e.data === '[done]') {
        setLoading(false)
        es.close()
        return
      }
      try {
        const video = JSON.parse(e.data)
        setResults((prev) => [...prev, video])
      } catch {}
    }

    es.onerror = () => {
      setLoading(false)
      es.close()
    }

    return () => es.close()
  }, [query])

  return (
    <div className="px-4 md:px-6 pt-4 md:pt-6 border-b border-surface-border pb-6">
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-base font-semibold text-text-primary">
          Results for "{query}"
          {results.length > 0 && (
            <span className="text-text-muted font-normal ml-2 text-sm">
              {results.length} found
            </span>
          )}
        </h2>
        {loading && (
          <span className="text-xs text-text-muted animate-pulse">fetching...</span>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 md:gap-5">
        {results.map((video, i) => (
          <div
            key={video.id}
            className="animate-fade-slide-in"
            style={{ animationDelay: `${Math.min(i * 40, 200)}ms` }}
          >
            <VideoCard video={video} onClick={onPlay} />
          </div>
        ))}
        {loading && Array.from({ length: results.length === 0 ? 8 : 2 }).map((_, i) => (
          <SkeletonCard key={`sk-${i}`} />
        ))}
      </div>
    </div>
  )
}

// -----------------------------------------------------------
// SkeletonCard — shimmer placeholder while a result is loading
// -----------------------------------------------------------
function SkeletonCard() {
  return (
    <div className="animate-pulse">
      <div className="aspect-video rounded-lg bg-surface-overlay mb-2" />
      <div className="h-3.5 bg-surface-overlay rounded mb-2 w-4/5" />
      <div className="h-3 bg-surface-overlay rounded w-1/2" />
    </div>
  )
}

// -----------------------------------------------------------
// Empty state when library is empty or search has no results
// -----------------------------------------------------------
function EmptyState({ isSFW, hasSearch }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <span className="text-5xl mb-4">📂</span>
      <h3 className="text-lg font-medium text-text-primary mb-2">
        {hasSearch ? 'No results found' : 'Nothing here yet'}
      </h3>
      <p className="text-sm text-text-muted max-w-sm">
        {hasSearch
          ? 'Try a different search term.'
          : isSFW
            ? 'No videos match your search.'
            : 'Click the + Add button to start building your library.'}
      </p>
    </div>
  )
}
