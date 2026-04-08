import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import useModeStore from '../stores/modeStore'
import useLibraryStore from '../stores/libraryStore'
import HomeHeader from '../components/home/HomeHeader'
import VideoCard from '../components/VideoCard'
import VideoPlayer from '../components/VideoPlayer'
import DebugPanel from '../components/DebugPanel'

// ============================================================
// LibraryPage
// First-class page matching homepage visual language.
// Tabs: All, Favorites, Watch History, Watch Later, Top Rated
// Continue Watching row at top with resume progress indicators.
// ============================================================

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'favorites', label: 'Favorites' },
  { key: 'history', label: 'Watch History' },
  { key: 'watchLater', label: 'Watch Later' },
  { key: 'rated', label: 'Top Rated' },
]

export default function LibraryPage() {
  const navigate = useNavigate()
  const isSFW = useModeStore((s) => s.isSFW)
  const { videos, loadFromServer, seedDemoData } = useLibraryStore()
  const [activeTab, setActiveTab] = useState('all')
  const [activeVideo, setActiveVideo] = useState(null)
  const [debugOpen, setDebugOpen] = useState(false)

  // Ctrl+Shift+D toggles debug panel
  useEffect(() => {
    const handler = (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        e.preventDefault()
        setDebugOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Load library on startup
  useEffect(() => {
    loadFromServer().then(() => {
      const current = useLibraryStore.getState().videos
      if (current.length === 0) {
        seedDemoData()
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Continue Watching — videos with progress between 5% and 95%
  const continueWatching = useMemo(() => {
    return videos
      .filter((v) => v.watchProgress > 0.05 && v.watchProgress < 0.95)
      .sort((a, b) => new Date(b.lastWatched || 0) - new Date(a.lastWatched || 0))
      .slice(0, 20)
  }, [videos])

  // Filtered videos based on active tab
  const filtered = useMemo(() => {
    switch (activeTab) {
      case 'favorites':
        return videos.filter((v) => v.favorite)
      case 'history':
        return videos
          .filter((v) => v.lastWatched)
          .sort((a, b) => new Date(b.lastWatched) - new Date(a.lastWatched))
      case 'watchLater':
        return videos.filter((v) => v.watchLater)
      case 'rated':
        return videos
          .filter((v) => v.rating)
          .sort((a, b) => b.rating - a.rating)
      default:
        return videos
    }
  }, [videos, activeTab])

  // Tab counts for badges
  const counts = useMemo(() => ({
    all: videos.length,
    favorites: videos.filter((v) => v.favorite).length,
    history: videos.filter((v) => v.lastWatched).length,
    watchLater: videos.filter((v) => v.watchLater).length,
    rated: videos.filter((v) => v.rating).length,
  }), [videos])

  return (
    <div className="min-h-screen bg-surface text-text-primary font-sans">
      <HomeHeader />

      {/* Video player overlay */}
      {activeVideo && (
        <VideoPlayer
          video={activeVideo}
          onClose={() => setActiveVideo(null)}
          onPlayVideo={setActiveVideo}
        />
      )}

      {/* Page content — below fixed header */}
      <div className="pt-14">
        {/* Page title area */}
        <div className="px-10 pt-8 pb-2">
          <h1 className="font-display text-headline font-bold tracking-[-0.5px] mb-1">
            Your Library
          </h1>
          <p className="text-sm text-text-muted">
            {videos.length} {videos.length === 1 ? 'video' : 'videos'} saved
          </p>
        </div>

        {/* Tab bar */}
        <div className="px-10 pt-3 pb-1 border-b border-surface-border">
          <div className="flex gap-1">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-2 rounded-full text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                  activeTab === tab.key
                    ? 'bg-accent/15 text-accent border border-accent/30'
                    : 'text-text-secondary hover:text-text-primary hover:bg-surface-overlay'
                }`}
              >
                {tab.label}
                {counts[tab.key] > 0 && (
                  <span className={`text-micro font-medium px-1.5 py-0.5 rounded-full ${
                    activeTab === tab.key
                      ? 'bg-accent/20 text-accent'
                      : 'bg-surface-overlay text-text-muted'
                  }`}>
                    {counts[tab.key]}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Continue Watching row — only show on All tab when there are items */}
        {activeTab === 'all' && continueWatching.length > 0 && (
          <ContinueWatchingRow items={continueWatching} onPlay={setActiveVideo} />
        )}

        {/* Main grid */}
        <div className="px-10 py-6">
          {filtered.length === 0 ? (
            <LibraryEmptyState tab={activeTab} onNavigate={navigate} />
          ) : (
            <>
              {/* Section header */}
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-subhead font-semibold tracking-wider uppercase text-text-secondary">
                  {TABS.find((t) => t.key === activeTab)?.label}
                </h2>
                <span className="text-caption text-text-muted">
                  {filtered.length} {filtered.length === 1 ? 'video' : 'videos'}
                </span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {filtered.map((video) => (
                  <VideoCard key={video.id} video={video} onClick={setActiveVideo} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {isSFW && (
        <div
          className="fixed bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r
          from-transparent via-amber-400/30 to-transparent pointer-events-none"
        />
      )}

      <DebugPanel open={debugOpen} onClose={() => setDebugOpen(false)} />
    </div>
  )
}

// ============================================================
// ContinueWatchingRow
// Horizontal scroll row with resume progress bars on each card.
// Matches homepage CategoryRow visual language.
// ============================================================
function ContinueWatchingRow({ items, onPlay }) {
  return (
    <div className="px-10 pt-6 pb-2">
      {/* Header */}
      <div className="flex items-center justify-between mb-3.5">
        <h3 className="font-display text-title font-bold tracking-[-0.3px]">
          Continue Watching
        </h3>
        <span className="text-caption font-semibold text-accent opacity-75 cursor-pointer uppercase tracking-wider hover:opacity-100 transition-opacity">
          See all &rarr;
        </span>
      </div>

      {/* Scrollable row */}
      <div
        className="flex gap-3 overflow-x-auto pb-1.5 scrollbar-none"
        style={{
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          WebkitMaskImage: 'linear-gradient(to right, black 88%, transparent 100%)',
          maskImage: 'linear-gradient(to right, black 88%, transparent 100%)',
        }}
      >
        {items.map((item) => (
          <ContinueWatchingCard key={item.id} item={item} onClick={() => onPlay(item)} />
        ))}
      </div>
    </div>
  )
}

// ============================================================
// ContinueWatchingCard
// Card with thumbnail, title, and a progress bar showing
// how far the user got through the video.
// ============================================================
function ContinueWatchingCard({ item, onClick }) {
  const progress = Math.round((item.watchProgress || 0) * 100)

  return (
    <div
      onClick={onClick}
      className="flex-none w-card rounded-[10px] overflow-hidden bg-raised
        cursor-pointer relative transition-all duration-[220ms] ease-out
        hover:scale-[1.03] hover:-translate-y-0.5 hover:shadow-card-hover"
    >
      {/* Thumbnail */}
      <div className="relative">
        <img
          src={item.thumbnail}
          alt={item.title}
          loading="lazy"
          className="w-full h-[124px] object-cover block bg-overlay"
        />
        {/* Resume overlay */}
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
          <div className="w-11 h-11 rounded-full bg-white/90 flex items-center justify-center text-black text-lg shadow-float">
            ▶
          </div>
        </div>
        {/* Duration badge */}
        <span className="absolute top-[100px] right-[7px] bg-black/80 text-micro font-semibold px-1.5 py-0.5 rounded z-content">
          {item.durationFormatted || '0:00'}
        </span>
        {/* Progress bar */}
        <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-white/10">
          <div
            className="h-full bg-accent rounded-r-sm transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Info */}
      <div className="p-2.5 pt-2">
        <div className="text-body-sm font-semibold leading-tight line-clamp-2 mb-0.5">
          {item.title}
        </div>
        <div className="text-caption text-text-muted">
          {progress}% watched
        </div>
      </div>
    </div>
  )
}

// ============================================================
// LibraryEmptyState
// Contextual empty state per tab with actionable CTAs.
// ============================================================
function LibraryEmptyState({ tab, onNavigate }) {
  const states = {
    all: {
      icon: '📂',
      title: 'Start building your library',
      desc: 'Add videos from the feed, search, or paste URLs directly.',
      cta: 'Browse Feed',
      action: () => onNavigate('/feed'),
    },
    favorites: {
      icon: '♡',
      title: 'No favorites yet',
      desc: 'Heart videos you love and they\'ll show up here.',
      cta: null,
    },
    history: {
      icon: '⏱',
      title: 'No watch history',
      desc: 'Videos you watch will appear here so you can pick up where you left off.',
      cta: 'Browse Feed',
      action: () => onNavigate('/feed'),
    },
    watchLater: {
      icon: '🔖',
      title: 'Watch Later is empty',
      desc: 'Save videos to watch later and find them all in one place.',
      cta: null,
    },
    rated: {
      icon: '★',
      title: 'No rated videos',
      desc: 'Rate videos to build your personal rankings.',
      cta: null,
    },
  }

  const s = states[tab] || states.all

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <span className="text-5xl mb-4 opacity-60">{s.icon}</span>
      <h3 className="font-display text-lg font-semibold text-text-primary mb-2">
        {s.title}
      </h3>
      <p className="text-sm text-text-muted max-w-sm mb-5">
        {s.desc}
      </p>
      {s.cta && (
        <button
          onClick={s.action}
          className="px-5 py-2.5 rounded-full bg-accent text-white text-sm font-semibold
            hover:bg-accent-hover transition-colors"
        >
          {s.cta}
        </button>
      )}
    </div>
  )
}
