import useMobileNavStore from '../../stores/mobileNavStore'

// ============================================================
// HamburgerButton
// Visible only below md breakpoint. Toggles the MobileNavSheet.
// 44×44 touch target (WCAG 2.5.5 / Apple HIG).
// ============================================================

export default function HamburgerButton() {
  const { open, toggleNav } = useMobileNavStore()

  return (
    <button
      className="md:hidden flex items-center justify-center w-11 h-11 rounded-lg
        text-text-secondary hover:text-text-primary hover:bg-surface-overlay
        transition-colors"
      aria-label={open ? 'Close navigation menu' : 'Open navigation menu'}
      aria-expanded={open}
      aria-haspopup="dialog"
      onClick={toggleNav}
    >
      {/* Animated hamburger → X icon */}
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        {open ? (
          <>
            <line x1="4" y1="4" x2="16" y2="16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <line x1="16" y1="4" x2="4" y2="16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </>
        ) : (
          <>
            <line x1="3" y1="6"  x2="17" y2="6"  stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <line x1="3" y1="10" x2="17" y2="10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <line x1="3" y1="14" x2="17" y2="14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </>
        )}
      </svg>
    </button>
  )
}
