import { useState, useEffect } from 'react'

// Returns 'mobile' or 'desktop' based on screen width
// Breakpoint at 768px (md in Tailwind)
export default function useResponsive() {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  )

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')

    function handleChange(e) {
      setIsMobile(e.matches)
    }

    mq.addEventListener('change', handleChange)
    return () => mq.removeEventListener('change', handleChange)
  }, [])

  return { isMobile, isDesktop: !isMobile }
}
