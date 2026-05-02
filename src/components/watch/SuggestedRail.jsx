import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

// ============================================================
// SuggestedRail
// Two-tab rail under the player:
//   - More Like This  : items related to the current video
//   - Recommended For You : taste-profile picks, no overlap
// Empty / no-related fallback collapses to the recommended tab.
// ============================================================

export default function SuggestedRail({ related, recommended, onAddToQueue, hydrating = false }) {
  const hasRelated = (related?.length || 0) > 0
  const hasRec = (recommended?.length || 0) > 0
  const [tab, setTab] = useState(hasRelated ? 'related' : 'recommended')
  const navigate = useNavigate()

  if (!hasRelated && !hasRec && !hydrating) return null

  const items = tab === 'related' ? related : recommended

  return (
    <section className="pb-16">
      <div className="flex items-center gap-1 mb-5 border-b border-white/[0.06]">
        <TabBtn
          active={tab === 'related'}
          onClick={() => hasRelated && setTab('related')}
          disabled={!hasRelated}
        >
          More Like This
        </TabBtn>
        <TabBtn
          active={tab === 'recommended'}
          onClick={() => hasRec && setTab('recommended')}
          disabled={!hasRec}
        >
          Recommended For You
        </TabBtn>
        {hydrating && (
          <span className="ml-auto inline-flex items-center gap-2 text-xs text-text-muted pr-1">
            <span className="w-3 h-3 border border-text-muted border-t-text-secondary rounded-full animate-spin" />
            finding similar…
          </span>
        )}
      </div>

      {items.length > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {items.map((rv) => (
            <SuggestedCard
              key={rv.id}
              item={rv}
              onNavigate={() => navigate(`/watch/${rv.id}`)}
              onQueue={() => onAddToQueue?.(rv)}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-text-muted">Nothing here yet.</p>
      )}
    </section>
  )
}

function TabBtn({ active, onClick, disabled, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`relative px-4 py-3 text-sm font-semibold transition-colors
        ${disabled ? 'cursor-not-allowed text-text-muted/40' : 'cursor-pointer'}
        ${active ? 'text-text-primary' : 'text-text-muted hover:text-text-secondary'}`}
    >
      {children}
      {active && (
        <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-accent" aria-hidden="true" />
      )}
    </button>
  )
}

function SuggestedCard({ item, onNavigate, onQueue }) {
  const [queued, setQueued] = useState(false)

  const handleQueue = (e) => {
    e.stopPropagation()
    onQueue?.()
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
        transition-all duration-200 hover:scale-[var(--hover-scale)] hover:shadow-card-hover"
    >
      <div className="relative" style={{ aspectRatio: '16 / 9' }}>
        {item.thumbnail ? (
          <img
            src={item.thumbnail}
            alt={item.title}
            loading="lazy"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-overlay" />
        )}
        {item.duration && (
          <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-black/70 text-white/90">
            {item.duration}
          </span>
        )}
      </div>
      <div className="p-3">
        <div className="text-sm font-semibold leading-tight line-clamp-2 mb-1">
          {item.title}
        </div>
        <div className="text-xs text-text-muted mb-2">
          {item.uploader}
          {item.views && <span> &middot; {item.views} views</span>}
        </div>
        <button
          type="button"
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
