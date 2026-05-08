import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

// ============================================================
// useViewMode
// URL-backed view-mode state for the watch page.
// "standard" is implicit (no ?view=); "fullscreen" is explicit
// (?view=fullscreen). Browser back/forward exits fullscreen for
// free, and the URL is shareable.
// ============================================================

const VALID = new Set(['fullscreen'])

export default function useViewMode() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('view')
  const viewMode = VALID.has(raw) ? raw : 'standard'

  const setViewMode = useCallback((next) => {
    setParams(
      (prev) => {
        const np = new URLSearchParams(prev)
        if (next && next !== 'standard') np.set('view', next)
        else np.delete('view')
        return np
      },
      { replace: false },
    )
  }, [setParams])

  return { viewMode, setViewMode }
}
