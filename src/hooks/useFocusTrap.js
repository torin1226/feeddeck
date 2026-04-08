import { useEffect, useRef } from 'react'

export default function useFocusTrap(active = true) {
  const containerRef = useRef(null)

  useEffect(() => {
    if (!active || !containerRef.current) return
    const container = containerRef.current
    const focusable = container.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    const first = focusable[0]
    const last = focusable[focusable.length - 1]

    // Store previously focused element to return focus on close
    const previousFocus = document.activeElement

    // Focus the first element
    first?.focus()

    const handleKeyDown = (e) => {
      if (e.key !== 'Tab') return
      if (focusable.length === 0) { e.preventDefault(); return }
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last?.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first?.focus()
        }
      }
    }

    container.addEventListener('keydown', handleKeyDown)
    return () => {
      container.removeEventListener('keydown', handleKeyDown)
      previousFocus?.focus()
    }
  }, [active])

  return containerRef
}
