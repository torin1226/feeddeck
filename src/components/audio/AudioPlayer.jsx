import { useEffect, useRef } from 'react'
import useAudioFeedStore from '../../stores/audioFeedStore'

// ============================================================
// AudioPlayer
// Sticky mini-player pinned to the bottom of the page. Single
// HTML5 <audio> element. Persists across navigation because it's
// mounted at the page root and survives via store state.
//
// Controls: prev, play/pause, next, scrubber, thumbs-up, thumbs-
// down. Creator initial + title shown left of controls.
// ============================================================

function fmtTime(t) {
  if (!isFinite(t) || t < 0) return '0:00'
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

export default function AudioPlayer() {
  const items = useAudioFeedStore(s => s.items)
  const currentIndex = useAudioFeedStore(s => s.currentIndex)
  const isPlaying = useAudioFeedStore(s => s.isPlaying)
  const position = useAudioFeedStore(s => s.position)
  const duration = useAudioFeedStore(s => s.duration)
  const togglePlay = useAudioFeedStore(s => s.togglePlay)
  const next = useAudioFeedStore(s => s.next)
  const prev = useAudioFeedStore(s => s.prev)
  const seek = useAudioFeedStore(s => s.seek)
  const setPosition = useAudioFeedStore(s => s.setPosition)
  const setDuration = useAudioFeedStore(s => s.setDuration)
  const setAudioElement = useAudioFeedStore(s => s.setAudioElement)
  const onEnded = useAudioFeedStore(s => s.onEnded)
  const onPlaybackError = useAudioFeedStore(s => s.onPlaybackError)
  const rateCurrent = useAudioFeedStore(s => s.rateCurrent)
  const localRatings = useAudioFeedStore(s => s.localRatings)

  const audioRef = useRef(null)
  const item = items[currentIndex]

  // Register the <audio> element with the store so seek() and pause/play
  // calls can drive it directly.
  useEffect(() => {
    setAudioElement(audioRef.current)
    return () => setAudioElement(null)
  }, [setAudioElement])

  // When the active item changes, point the element at the new src.
  // Using src directly (not <source> tag) so React reconciles cleanly.
  useEffect(() => {
    const el = audioRef.current
    if (!el || !item) return
    if (el.src !== item.audio_url) {
      el.src = item.audio_url
      el.load()
    }
  }, [item])

  // Drive play/pause from store state. Wrapped in a promise to handle the
  // browser autoplay rejection gracefully — first user click on a card is
  // always a real user gesture so play() should always succeed.
  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    if (isPlaying && item) {
      el.play().catch(err => {
        console.warn('audio play() rejected:', err.message)
      })
    } else {
      el.pause()
    }
  }, [isPlaying, item])

  // Don't render until there's something to play. Avoids a stray bar at
  // the bottom on empty state.
  if (!item) return null

  const localRating = localRatings.get(item.id) ?? item.rated
  const progress = duration > 0 ? (position / duration) * 100 : 0

  return (
    <>
      <audio
        ref={audioRef}
        preload="none"
        onTimeUpdate={(e) => setPosition(e.target.currentTime)}
        onDurationChange={(e) => setDuration(e.target.duration)}
        onEnded={() => onEnded()}
        // Skip broken tracks without marking watched. Asymmetric to
        // onEnded so a transient CDN failure doesn't permanently sink a
        // track from the feed. Mirrors useHeroAutoplay 2026-05-16.
        onError={() => onPlaybackError()}
      />
      <div
        className="fixed bottom-0 inset-x-0 z-40 border-t border-white/5 bg-zinc-950/95 backdrop-blur-md"
        // Sit above any persistent FeedBottomNav (currently 56px on mobile).
        // Desktop has no bottom nav so we go flush.
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0)' }}
      >
        {/* Scrubber: full-width thin bar with hover affordance */}
        <div
          role="slider"
          aria-label="Audio scrubber"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={position}
          tabIndex={0}
          className="group h-1 bg-zinc-800 cursor-pointer relative"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            const pct = (e.clientX - rect.left) / rect.width
            seek(pct * duration)
          }}
        >
          <div
            className="absolute inset-y-0 left-0 bg-rose-500 transition-[width] duration-75"
            style={{ width: `${progress}%` }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-rose-300 opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ left: `calc(${progress}% - 6px)` }}
          />
        </div>

        <div className="px-4 py-3 flex items-center gap-4">
          {/* Title + creator. Truncated, single line. */}
          <div className="min-w-0 flex-1 flex items-center gap-3">
            <div className="shrink-0 w-10 h-10 rounded-lg bg-rose-500/20 text-rose-200 font-serif text-xl flex items-center justify-center">
              {(item.creator || '?').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div
                className="text-sm font-medium text-zinc-100 truncate"
                style={{ fontFamily: '"Iowan Old Style","Constantia","Georgia",serif' }}
              >
                {item.title}
              </div>
              <div className="text-[11px] text-zinc-500 truncate">
                {item.creator || 'unknown'}
                <span className="mx-1.5">·</span>
                <span className="tabular-nums">
                  {fmtTime(position)} / {fmtTime(duration)}
                </span>
              </div>
            </div>
          </div>

          {/* Transport */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={prev}
              disabled={currentIndex <= 0}
              className="p-2 rounded-full hover:bg-white/5 disabled:opacity-30 text-zinc-300"
              aria-label="Previous"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 6h2v12H6zM9.5 12l8.5 6V6z" />
              </svg>
            </button>
            <button
              onClick={togglePlay}
              className="p-3 rounded-full bg-rose-500 hover:bg-rose-400 text-white"
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M7 4v16l13-8z" />
                </svg>
              )}
            </button>
            <button
              onClick={next}
              disabled={currentIndex < 0 || currentIndex >= items.length - 1}
              className="p-2 rounded-full hover:bg-white/5 disabled:opacity-30 text-zinc-300"
              aria-label="Next"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M16 6h2v12h-2zM6 6v12l8.5-6z" />
              </svg>
            </button>
          </div>

          {/* Rating */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => rateCurrent('up')}
              className={`p-2 rounded-full hover:bg-white/5 transition-colors ${
                localRating === 1 ? 'text-emerald-400' : 'text-zinc-500'
              }`}
              aria-label="Thumbs up"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M2 20h2v-9H2zM23 11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 2 7.59 8.59C7.22 8.95 7 9.45 7 10v9c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73z" />
              </svg>
            </button>
            <button
              onClick={() => rateCurrent('down')}
              className={`p-2 rounded-full hover:bg-white/5 transition-colors ${
                localRating === -1 ? 'text-rose-400' : 'text-zinc-500'
              }`}
              aria-label="Thumbs down"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M22 4h-2v9h2zM1 13c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06l1.06 1.06 6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2H6c-.83 0-1.54.5-1.84 1.22L1.14 11.27C1.05 11.5 1 11.74 1 12z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
