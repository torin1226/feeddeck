import { useState, useEffect } from 'react'

const BREAKPOINT = 1024

export default function useDesktopBreakpoint() {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= BREAKPOINT
  )

  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${BREAKPOINT}px)`)
    const handler = (e) => setIsDesktop(e.matches)
    mql.addEventListener('change', handler)
    setIsDesktop(mql.matches)
    return () => mql.removeEventListener('change', handler)
  }, [])

  return isDesktop
}
