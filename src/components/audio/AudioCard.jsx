import useAudioFeedStore from '../../stores/audioFeedStore'

// ============================================================
// AudioCard
// ============================================================
// Outer container is a div with role="button" rather than a <button>
// element because tag pills nested inside need to be real <button>s
// (button-inside-button is invalid HTML). The div keeps a11y parity via
// role + tabIndex + Enter/Space key handling.

// ============================================================
// AudioCard
// Typography-focused card for a single audio item. No thumbnail.
// Title is the dominant element. Tags + creator + length below.
// Click anywhere on the card to play.
//
// Visual hierarchy:
//   [title 24-28px, 2-line clamp]
//   [creator · source · length]
//   [tag chips]
//
// Active card gets a colored ring + "playing" indicator.
// ============================================================

const SOURCE_LABEL = {
  'soundgasm.net': 'soundgasm',
  'reddit.com': 'reddit',
}

function timeLabel(item) {
  if (item.length_label) return item.length_label
  if (item.duration_sec && item.duration_sec > 0) {
    const m = Math.floor(item.duration_sec / 60)
    const s = Math.floor(item.duration_sec % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }
  return null
}

export default function AudioCard({ item }) {
  const playItem = useAudioFeedStore(s => s.playItem)
  const setQuery = useAudioFeedStore(s => s.setQuery)
  const setCreatorFilter = useAudioFeedStore(s => s.setCreatorFilter)
  const currentIndex = useAudioFeedStore(s => s.currentIndex)
  const items = useAudioFeedStore(s => s.items)
  const isPlaying = useAudioFeedStore(s => s.isPlaying)
  const localRatings = useAudioFeedStore(s => s.localRatings)

  const isActive = items[currentIndex]?.id === item.id
  const localRating = localRatings.get(item.id) ?? item.rated

  const handlePlay = () => playItem(item)
  const handleKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handlePlay()
    }
  }
  const handleTagClick = (e, tag) => {
    e.stopPropagation()
    setQuery(tag)
  }
  const handleCreatorClick = (e) => {
    e.stopPropagation()
    setCreatorFilter(item.creator)
  }

  const tags = Array.isArray(item.tags) ? item.tags : []
  const length = timeLabel(item)
  const sourceLabel = SOURCE_LABEL[item.source_domain] || item.source_domain

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handlePlay}
      onKeyDown={handleKey}
      className={`
        group w-full text-left rounded-2xl p-5 transition-all cursor-pointer
        ${isActive
          ? 'bg-rose-500/10 ring-2 ring-rose-400/60 shadow-lg shadow-rose-500/10'
          : 'bg-zinc-900/40 hover:bg-zinc-900/70 ring-1 ring-white/5 hover:ring-white/15'}
        ${localRating === -1 ? 'opacity-40' : ''}
      `}
    >
      <div className="flex items-start gap-3">
        {/* Letter glyph in lieu of a thumbnail. Creator initial in a soft
            chip. Cheap visual anchor without forcing image fetches. */}
        <div
          className={`
            shrink-0 w-12 h-12 rounded-xl flex items-center justify-center
            font-serif text-2xl font-medium tracking-tight
            ${isActive
              ? 'bg-rose-500/20 text-rose-200'
              : 'bg-zinc-800/80 text-zinc-300 group-hover:bg-zinc-700/80'}
          `}
        >
          {(item.creator || '?').charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <h3
            className={`
              font-serif text-[1.35rem] leading-tight tracking-tight
              ${isActive ? 'text-rose-50' : 'text-zinc-100'}
              line-clamp-2
            `}
            style={{ fontFamily: '"Iowan Old Style","Constantia","Georgia",serif' }}
          >
            {item.title}
          </h3>
          <div className="mt-1.5 flex items-center gap-2 text-xs text-zinc-400 font-medium tracking-wide uppercase">
            <button
              type="button"
              onClick={handleCreatorClick}
              className={`hover:underline focus-visible:underline outline-none ${isActive ? 'text-rose-300' : 'text-zinc-300'}`}
              aria-label={`Filter by creator ${item.creator || 'unknown'}`}
            >
              {item.creator || 'unknown'}
            </button>
            <span className="text-zinc-600">·</span>
            <span>{sourceLabel}</span>
            {length && (
              <>
                <span className="text-zinc-600">·</span>
                <span className="tabular-nums">{length}</span>
              </>
            )}
            {isActive && (
              <>
                <span className="text-zinc-600">·</span>
                <span className="text-rose-300 inline-flex items-center gap-1">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
                  {isPlaying ? 'playing' : 'paused'}
                </span>
              </>
            )}
          </div>
          {tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {tags.slice(0, 8).map((tag, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={(e) => handleTagClick(e, tag)}
                  className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-zinc-800/70 text-zinc-400 ring-1 ring-white/5 hover:bg-rose-500/15 hover:text-rose-200 hover:ring-rose-400/40 transition-colors cursor-pointer"
                  aria-label={`Search audio tagged ${tag}`}
                >
                  {tag}
                </button>
              ))}
              {tags.length > 8 && (
                <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 text-zinc-500">
                  +{tags.length - 8}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
