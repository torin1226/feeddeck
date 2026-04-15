import { useEffect, useState, useRef, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import useHomeStore from '../stores/homeStore'
import useQueueStore from '../stores/queueStore'
import useLibraryStore from '../stores/libraryStore'
import useToastStore from '../stores/toastStore'
import useModeStore from '../stores/modeStore'
import HomeHeader from '../components/home/HomeHeader'

// ============================================================
// VideoDetailPage
// Full video detail view at /video/:id
// Player section + info + related videos grid
// ============================================================

const SFW_VIDEO = 'https://videos.pexels.com/video-files/856974/856974-hd_1280_720_30fps.mp4'

export default function VideoDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const videoRef = useRef(null)
  const isSFW = useModeStore((s) => s.isSFW)

  // Find the item from homeStore categories
  const categories = useHomeStore((s) => s.categories)
  const allItems = useMemo(() => {
    if (!categories) return []
    return categories.flatMap((c) => c.items || [])
  }, [categories])

  const item = useMemo(() => allItems.find((v) => String(v.id) === String(id)), [allItems, id])

  // Related videos: same category, excluding current
  const relatedVideos = useMemo(() => {
    if (!item || !categories) return []
    const cat = categories.find((c) => (c.items || []).some((v) => String(v.id) === String(id)))
    if (!cat) return allItems.filter((v) => String(v.id) !== String(id)).slice(0, 12)
    return (cat.items || []).filter((v) => String(v.id) !== String(id)).slice(0, 12)
  }, [item, categories, allItems, id])

  // Stream URL resolution
  const [streamUrl, setStreamUrl] = useState(null)
  const [streamLoading, setStreamLoading] = useState(false)

  useEffect(() => {
    if (!item?.url || isSFW) return
    setStreamUrl(null)
    setStreamLoading(true)
    fetch(`/api/stream-url?url=${encodeURIComponent(item.url)}`)
      .then((r) => r.json())
      .then((data) => { if (data.streamUrl) setStreamUrl(data.streamUrl) })
      .catch(() => {})
      .finally(() => setStreamLoading(false))
  }, [item?.url, isSFW])

  // Mark watched
  const markWatched = useLibraryStore((s) => s.markWatched)
  useEffect(() => {
    if (item?.id) markWatched(item.id)
  }, [item?.id, markWatched])

  // Track watch progress
  useEffect(() => {
    const vid = videoRef.current
    if (!vid || isSFW || !item?.id) return
    const interval = setInterval(() => {
      if (vid.duration > 0) {
        useLibraryStore.getState().setWatchProgress(item.id, vid.currentTime / vid.duration)
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [item?.id, isSFW])

  const videoSrc = isSFW
    ? SFW_VIDEO
    : streamUrl
      ? (streamUrl.includes('.m3u8')
          ? `/api/hls-proxy?url=${encodeURIComponent(streamUrl)}`
          : `/api/proxy-stream?url=${encodeURIComponent(streamUrl)}`)
      : ''

  // Actions
  const addToQueue = useQueueStore((s) => s.addToQueue)
  const toggleFavorite = useLibraryStore((s) => s.toggleFavorite)
  const showToast = useToastStore((s) => s.showToast)
  // Reactive subscription so the Like button updates immediately after toggle.
  // Must be a hook called before any early return.
  const isFavorite = useLibraryStore((s) => s.videos.some((v) => v.id === item?.id && v.favorite))

  const handleAddToQueue = (video) => {
    addToQueue(video)
    showToast('Added to queue')
  }

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href).catch(() => {})
    showToast('Link copied')
  }

  const handleLike = () => {
    if (item) {
      toggleFavorite(item.id)
      showToast('Updated favorites')
    }
  }

  // Not found state
  if (!item) {
    return (
      <div className="min-h-screen bg-surface text-text-primary font-sans">
        <HomeHeader />
        <div className="flex flex-col items-center justify-center pt-32 gap-4">
          <p className="text-text-muted text-lg">Video not found</p>
          <button
            onClick={() => navigate('/')}
            className="px-6 py-2.5 rounded-full bg-accent text-white font-semibold hover:bg-accent-hover transition-colors"
          >
            Back to Home
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-surface text-text-primary font-sans">
      <HomeHeader />

      {/* Back button */}
      <div className="px-6 pt-4 pb-2">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1.5 text-text-muted hover:text-text-primary transition-colors text-sm"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
      </div>

      {/* Video Player Section */}
      <div className="max-w-6xl mx-auto px-6">
        <div className="relative bg-black rounded-xl overflow-hidden" style={{ aspectRatio: '16 / 9' }}>
          {videoSrc ? (
            <video
              ref={videoRef}
              src={videoSrc}
              className="w-full h-full object-contain"
              controls
              autoPlay
              muted
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-text-muted gap-3 relative">
              {item.thumbnail && (
                <img
                  src={item.thumbnail}
                  alt={item.title}
                  className="absolute inset-0 w-full h-full object-contain opacity-40"
                />
              )}
              {streamLoading ? (
                <div className="relative flex flex-col items-center gap-2">
                  <div className="w-8 h-8 border-2 border-text-muted border-t-white rounded-full animate-spin" />
                  <p className="text-sm">Loading stream...</p>
                </div>
              ) : (
                <div className="relative flex flex-col items-center gap-2">
                  <span className="text-5xl">&#9654;</span>
                  <p className="text-sm">Could not load stream</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Video Info Section */}
        <div className="mt-6 mb-8">
          <h1 className="font-display text-2xl font-bold tracking-tight mb-2">
            {item.title}
          </h1>
          <div className="flex items-center gap-3 text-sm text-text-muted mb-4 flex-wrap">
            {item.uploader && <span className="font-medium text-text-secondary">{item.uploader}</span>}
            {item.uploader && <span>&middot;</span>}
            {item.genre && (
              <span className="px-2 py-0.5 rounded-full text-xs bg-white/5 border border-white/10">
                {item.genre}
              </span>
            )}
            {item.views && <span>{item.views} views</span>}
            {item.daysAgo && <span>&middot;</span>}
            {item.daysAgo && <span>{item.daysAgo}d ago</span>}
            {item.duration && <span>&middot;</span>}
            {item.duration && <span>{item.duration}</span>}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={handleLike}
              className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold transition-all
                ${isFavorite
                  ? 'bg-accent/20 text-accent border border-accent/30'
                  : 'bg-white/5 text-text-secondary border border-white/10 hover:bg-white/10'}`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill={isFavorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
              {isFavorite ? 'Liked' : 'Like'}
            </button>
            <button
              onClick={handleShare}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold
                bg-white/5 text-text-secondary border border-white/10 hover:bg-white/10 transition-all"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
              Share
            </button>
            <button
              onClick={() => handleAddToQueue(item)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold
                bg-accent text-white hover:bg-accent-hover transition-all"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
              </svg>
              Add to Queue
            </button>
          </div>

          {item.desc && (
            <p className="mt-4 text-sm text-text-muted leading-relaxed max-w-3xl">
              {item.desc}
            </p>
          )}
        </div>

        {/* Related Videos Section */}
        {relatedVideos.length > 0 && (
          <div className="pb-16">
            <h2 className="font-display text-lg font-bold tracking-tight mb-4">
              More Like This
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {relatedVideos.map((rv) => (
                <RelatedVideoCard
                  key={rv.id}
                  item={rv}
                  onNavigate={() => navigate(`/video/${rv.id}`)}
                  onQueue={() => handleAddToQueue(rv)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// -------------------------------------------------------
// RelatedVideoCard
// -------------------------------------------------------
function RelatedVideoCard({ item, onNavigate, onQueue }) {
  const [queued, setQueued] = useState(false)

  const handleQueue = (e) => {
    e.stopPropagation()
    onQueue()
    setQueued(true)
    setTimeout(() => setQueued(false), 2000)
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onNavigate}
      onKeyDown={(e) => { if (e.key === 'Enter') onNavigate() }}
      className="cursor-pointer group rounded-lg overflow-hidden bg-raised
        transition-all duration-200 hover:scale-[1.02] hover:shadow-card-hover"
    >
      {/* Thumbnail */}
      <div className="relative" style={{ aspectRatio: '16 / 9' }}>
        <img
          src={item.thumbnail}
          alt={item.title}
          loading="lazy"
          className="w-full h-full object-cover"
        />
        {item.duration && (
          <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-black/70 text-white/90">
            {item.duration}
          </span>
        )}
      </div>

      {/* Info */}
      <div className="p-3">
        <div className="text-sm font-semibold leading-tight line-clamp-2 mb-1">
          {item.title}
        </div>
        <div className="text-xs text-text-muted mb-2">
          {item.uploader}
          {item.views && <span> &middot; {item.views} views</span>}
        </div>

        {/* Add to Queue button */}
        <button
          onClick={handleQueue}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all
            ${queued
              ? 'bg-green-500/20 text-green-400 border border-green-500/30'
              : 'bg-white/5 text-text-secondary border border-white/10 hover:bg-accent hover:text-white hover:border-accent'}`}
        >
          {queued ? (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Queued
            </>
          ) : (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add to Queue
            </>
          )}
        </button>
      </div>
    </div>
  )
}
