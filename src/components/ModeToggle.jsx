import { useState } from 'react'
import useModeStore from '../stores/modeStore'

// ============================================================
// ModeToggle
// iOS-style switch for Social/NSFW mode with screen reader
// announcement. Minimal, subtle design. Escape key panic
// behavior is handled by modeStore.
// ============================================================

export default function ModeToggle() {
  const { isSFW, toggleMode } = useModeStore()
  const [announcement, setAnnouncement] = useState('')

  const handleToggle = () => {
    toggleMode()
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
        role="switch"
        aria-checked={!isSFW}
        aria-label={isSFW ? 'Switch to full library mode' : 'Switch to Social mode'}
        className="relative w-11 h-6 rounded-full transition-colors duration-200 cursor-pointer flex-shrink-0"
        style={{
          backgroundColor: isSFW ? 'rgba(120, 120, 128, 0.32)' : 'var(--color-accent)',
        }}
      >
        {/* Track knob */}
        <span
          className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200"
          style={{
            transform: isSFW ? 'translateX(0)' : 'translateX(20px)',
          }}
        />
      </button>
    </>
  )
}
