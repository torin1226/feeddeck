import { useLocation } from 'react-router-dom'
import useViewTransitionNavigate from '../../hooks/useViewTransitionNavigate'
import useQueueStore from '../../stores/queueStore'
import useFeedStore from '../../stores/feedStore'

// ============================================================
// FeedBottomNav
// Mobile-style bottom tab bar for the feed experience.
// 4 tabs: Feed, Filter, Queue, Settings
// Search tab replaced with Filter to open FeedFilterSheet.
// ============================================================

const tabs = [
  { label: 'Home', path: '/', icon: TabIconHome },
  { label: 'Feed', path: '/feed', icon: TabIconFeed },
  { label: 'Filter', path: null, action: 'filter', icon: TabIconFilter },
  { label: 'Settings', path: '/settings', icon: TabIconSettings },
]

export default function FeedBottomNav({ hidden = false, onFilterOpen }) {
  const navigate = useViewTransitionNavigate()
  const location = useLocation()
  const queueCount = useQueueStore(s => s.queue.length)
  const filters = useFeedStore(s => s.filters)
  const hasActiveFilters = (filters.sources?.length > 0) || (filters.tags?.length > 0)

  return (
    <nav className={`fixed bottom-0 left-0 right-0 z-modal flex items-center justify-around
      bg-black/80 backdrop-blur-lg border-t border-white/10 pb-safe
      transition-transform duration-200 ${hidden ? 'translate-y-full' : 'translate-y-0'}`}
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 8px)' }}
    >
      {tabs.map(tab => {
        const isActive = tab.path
          ? location.pathname === tab.path
          : false
        const isFilterActive = tab.action === 'filter' && hasActiveFilters
        const Icon = tab.icon

        return (
          <button
            key={tab.label}
            onClick={() => {
              if (tab.action === 'filter') {
                onFilterOpen?.()
              } else if (tab.path) {
                navigate(tab.path)
              }
            }}
            className={`flex flex-col items-center gap-0.5 py-2 px-4 cursor-pointer
              transition-colors ${isActive ? 'text-white' : isFilterActive ? 'text-accent' : 'text-white/40'}`}
          >
            <div className="relative">
              <Icon active={isActive || isFilterActive} />
              {tab.label === 'Queue' && queueCount > 0 && (
                <span
                  aria-live="polite"
                  aria-label={`${queueCount} items in queue`}
                  className="absolute -top-1 -right-2 min-w-[16px] h-4 px-1
                  rounded-full bg-accent text-micro font-bold text-black
                  flex items-center justify-center">
                  {queueCount > 99 ? '99+' : queueCount}
                </span>
              )}
              {tab.action === 'filter' && hasActiveFilters && (
                <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-accent" />
              )}
            </div>
            <span className="text-micro font-medium">{tab.label}</span>
          </button>
        )
      })}
    </nav>
  )
}

// --- Tab Icons (inline SVGs, 24x24) ---

function TabIconHome({ active }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  )
}

function TabIconFeed({ active }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="3" width="12" height="18" rx="2" />
      <path d="M10 15l4-3-4-3v6z" fill={active ? 'currentColor' : 'none'} />
    </svg>
  )
}

function TabIconFilter({ active }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  )
}


function TabIconSettings({ active }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  )
}
