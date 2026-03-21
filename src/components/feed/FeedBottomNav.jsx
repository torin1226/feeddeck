import { useNavigate, useLocation } from 'react-router-dom'
import useQueueStore from '../../stores/queueStore'

// ============================================================
// FeedBottomNav
// Mobile-style bottom tab bar for the feed experience.
// 4 tabs: Feed, Search, Queue, Settings
// ============================================================

const tabs = [
  { label: 'Feed', path: '/feed', icon: TabIconFeed },
  { label: 'Search', path: '/feed/search', icon: TabIconSearch },
  { label: 'Queue', path: '/feed/queue', icon: TabIconQueue },
  { label: 'Settings', path: '/feed/settings', icon: TabIconSettings },
]

export default function FeedBottomNav({ hidden = false }) {
  const navigate = useNavigate()
  const location = useLocation()
  const queueCount = useQueueStore(s => s.queue.length)

  return (
    <nav className={`fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around
      bg-black/80 backdrop-blur-lg border-t border-white/10 pb-safe
      transition-transform duration-200 ${hidden ? 'translate-y-full' : 'translate-y-0'}`}
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 8px)' }}
    >
      {tabs.map(tab => {
        const isActive = tab.path === '/feed'
          ? location.pathname === '/feed'
          : location.pathname.startsWith(tab.path)
        const Icon = tab.icon

        return (
          <button
            key={tab.path}
            onClick={() => navigate(tab.path)}
            className={`flex flex-col items-center gap-0.5 py-2 px-4 cursor-pointer
              transition-colors ${isActive ? 'text-white' : 'text-white/40'}`}
          >
            <div className="relative">
              <Icon active={isActive} />
              {tab.label === 'Queue' && queueCount > 0 && (
                <span className="absolute -top-1 -right-2 min-w-[16px] h-4 px-1
                  rounded-full bg-accent text-[10px] font-bold text-black
                  flex items-center justify-center">
                  {queueCount > 99 ? '99+' : queueCount}
                </span>
              )}
            </div>
            <span className="text-[10px] font-medium">{tab.label}</span>
          </button>
        )
      })}
    </nav>
  )
}

// --- Tab Icons (inline SVGs, 24x24) ---

function TabIconFeed({ active }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="3" width="12" height="18" rx="2" />
      <path d="M10 15l4-3-4-3v6z" fill={active ? 'currentColor' : 'none'} />
    </svg>
  )
}

function TabIconSearch({ active }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  )
}

function TabIconQueue({ active }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="4" rx="1" />
      <rect x="3" y="11" width="14" height="4" rx="1" />
      <rect x="3" y="17" width="10" height="4" rx="1" />
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
