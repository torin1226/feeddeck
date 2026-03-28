import { useState } from 'react'
import useModeStore from '../stores/modeStore'
import clsx from 'clsx'

// ============================================================
// ModeToggle
// Visual Social/NSFW toggle button with screen reader announcement.
// ============================================================

export default function ModeToggle() {
  const isSFW = useModeStore(s => s.isSFW)
  const toggleMode = useModeStore(s => s.toggleMode)
  const [announcement, setAnnouncement] = useState('')

  const handleToggle = () => {
    toggleMode()
    // Announce mode change to screen readers
    const newMode = isSFW ? 'Full library' : 'Social'
    setAnnouncement(`Switched to ${newMode} mode`)
    setTimeout(() => setAnnouncement(''), 1000)
  }

  return (
    <>
      {/* Screen reader announcement */}
      <div aria-live="assertive" className="sr-only">{announcement}</div>
      <button
        onClick={handleToggle}
        title={isSFW ? 'Switch to full library' : 'Switch to Social mode'}
        aria-label={isSFW ? 'Switch to full library mode' : 'Switch to Social mode'}
        className={clsx(
        'flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all duration-150',
        isSFW
          ? 'bg-sfw/20 text-sfw border border-sfw/30 hover:bg-sfw/30'
          : 'bg-surface-overlay text-text-secondary border border-surface-border hover:text-text-primary hover:border-text-muted'
      )}
    >
      <span className="text-base">{isSFW ? '📡' : '▶'}</span>
      <span>{isSFW ? 'Social' : 'FD'}</span>
    </button>
    </>
  )
}
