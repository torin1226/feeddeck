import { useNavigate } from 'react-router-dom'
import { useCallback } from 'react'

/**
 * Wraps react-router's useNavigate with CSS View Transitions API.
 * Falls back to plain navigation when the API isn't supported.
 */
export default function useViewTransitionNavigate() {
  const navigate = useNavigate()

  return useCallback((to, options) => {
    if (document.startViewTransition) {
      document.startViewTransition(() => navigate(to, options))
    } else {
      navigate(to, options)
    }
  }, [navigate])
}
