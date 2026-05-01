import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

// ============================================================
// FullscreenSuggestedSheet
// Bottom slide-up panel with two tabs (More Like This /
// Recommended For You). Renders only when in fullscreen mode.
// Click a card → navigate to its /watch/:id while preserving
// the current view mode via the parent's onPickItem.
// ============================================================

export default function FullscreenSuggestedSheet({
  open,
  related,
  recommended,
  onPickItem,
  onClose,
}) {
  const hasRelated = (related?.length || 0) > 0
  const hasRec = (recommended?.length || 0) > 0
  const [tab, setTab] = useState(hasRelated ? 'related' : 'recommended')
  const navigate = useNavigate()

  const items = tab === 'related' ? related : recommended

  return (
    <div
      className={`fixed inset-0 z-[55] flex flex-col pt-20 transition-transform ease-out
        ${open ? 'translate-y-0 pointer-events-auto' : 'translate-y-full pointer-events-none'}`}
      style={{
        background: 'linear-gradient(to top, rgba(0,0,0,0.96) 60%, rgba(0,0,0,0.85) 100%)',
        transitionDuration: '400ms',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-8 mb-4 mr-[36%]">
        <div className="flex items-center">
          <TabBtn
            active={tab === 'related'}
            disabled={!hasRelated}
            onClick={() => setTab('related')}
          >
            More Like This
          </TabBtn>
          <TabBtn
            active={tab === 'recommended'}
            disabled={!hasRec}
            onClick={() => setTab('recommended')}
          >
            Recommended For You
          </TabBtn>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto text-xs px-3 py-1.5 rounded-md border border-white/15 bg-white/5 text-white/75 hover:bg-white/10 hover:text-white transition-colors"
          aria-label="Close suggested panel"
        >
          Dismiss
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-12" data-fs-panel-inner="true">
        {items?.length ? (
          <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
            {items.map((rv) => (
              <SheetCard
                key={rv.id}
                item={rv}
                onClick={() => {
                  if (onPickItem) onPickItem(rv)
                  else navigate(`/watch/${rv.id}`)
                }}
              />
            ))}
          </div>
        ) : (
          <p className="text-white/50 text-sm">Nothing here yet.</p>
        )}
      </div>
    </div>
  )
}

function TabBtn({ active, disabled, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`relative px-5 py-3 text-base font-semibold transition-colors
        ${disabled
          ? 'cursor-not-allowed text-white/25'
          : active
            ? 'text-white cursor-pointer'
            : 'text-white/55 hover:text-white/80 cursor-pointer'}`}
    >
      {children}
      {active && (
        <span className="absolute left-0 right-0 -bottom-px h-[2px] bg-accent" aria-hidden="true" />
      )}
    </button>
  )
}

function SheetCard({ item, onClick }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter') onClick?.() }}
      className="cursor-pointer group rounded-lg overflow-hidden bg-raised
        transition-transform duration-200 hover:scale-[var(--hover-scale)]"
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
      <div className="p-2.5">
        <div className="text-[13px] font-semibold leading-tight line-clamp-2 mb-1 text-white">
          {item.title}
        </div>
        <div className="text-[11px] text-white/55">
          {item.uploader}
          {item.views && <span> &middot; {item.views} views</span>}
        </div>
      </div>
    </div>
  )
}
