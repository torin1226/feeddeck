import { useNavigate, useLocation } from 'react-router-dom'
import useHomeStore from '../../stores/homeStore'
import useModeStore from '../../stores/modeStore'
import useThemeStore from '../../stores/themeStore'

// ============================================================
// HomeHeader
// Fixed transparent header for the homepage. Nav links, logo,
// and mode pill. Gradient background that fades to transparent.
// ============================================================

export default function HomeHeader() {
  const navigate = useNavigate()
  const location = useLocation()
  const { _theatreMode } = useHomeStore()
  const { isSFW, toggleMode } = useModeStore()
  const { theme, toggleTheme } = useThemeStore()

  const navItems = [
    { label: 'Home', path: '/' },
    { label: 'Feed', path: '/feed' },
    { label: 'Library', path: '/library' },
  ]

  return (
    <header
      className="fixed top-0 left-0 right-0 z-[200] h-14 flex items-center justify-between px-10"
      style={{
        background: `linear-gradient(to bottom, var(--color-surface) 0%, transparent 100%)`,
      }}
    >
      {/* Logo */}
      <div className="text-lg font-bold tracking-tight font-display">
        &#128225; <em className="not-italic text-accent">Feed</em>Deck
      </div>

      {/* Nav */}
      <nav className="flex gap-7">
        {navItems.map((item) => (
          <button
            key={item.path}
            onClick={() => navigate(item.path)}
            className={`text-sm font-medium transition-colors cursor-pointer relative pb-0.5 ${
              location.pathname === item.path
                ? 'text-text-primary'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {item.label}
            {location.pathname === item.path && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-full" />
            )}
          </button>
        ))}
      </nav>

      {/* Right side */}
      <div className="flex items-center gap-3.5">
        <button
          onClick={() => navigate('/settings')}
          className="p-2 rounded-lg text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
          title="Settings"
          aria-label="Settings"
        >
          ⚙
        </button>
        <button
          onClick={toggleTheme}
          className="p-2 rounded-lg text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? '☀' : '🌙'}
        </button>
        <button
          onClick={toggleMode}
          title={isSFW ? 'Switch to full library' : 'Switch to Social mode'}
          className={`px-3.5 py-1.5 rounded-full text-xs font-semibold cursor-pointer transition-all tracking-wide ${
            isSFW
              ? 'bg-amber-500/[0.06] border border-amber-500/25 text-amber-400 hover:bg-amber-500/[0.12]'
              : 'bg-surface-overlay border border-surface-border text-text-secondary hover:text-text-primary hover:border-text-muted'
          }`}
        >
          &#9679; {isSFW ? 'SOCIAL MODE' : 'NSFW MODE'}
        </button>
      </div>
    </header>
  )
}
