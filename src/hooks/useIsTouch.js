import { useState, useEffect } from 'react'

// ============================================================
// useIsTouch
// Returns true when the primary pointer is coarse / touch-only
// (i.e. no fine-grained hover capability). Uses the CSS
// `(hover: none)` media query — the most reliable signal for
// "this device doesn't hover" across mobile, tablet, and
// touch-screen laptops.
//
// Re-evaluates if the MQ fires a change (e.g. iPad connecting
// a Magic Keyboard trackpad switches from hover:none → hover:hover).
//
// Safe to call in SSR — returns false when window is absent.
// ============================================================

const QUERY = '(hover: none)'

export default function useIsTouch() {
  const [isTouch, setIsTouch] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(QUERY).matches
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mql = window.matchMedia(QUERY)
    const handler = (e) => setIsTouch(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])

  return isTouch
}
