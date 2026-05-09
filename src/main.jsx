import './migrations' // Must be first — renames pv-* → fd-* before stores init

// Global fetch timeout — no API call should hang forever (15s default).
// Endpoints that legitimately exceed 15s (yt-dlp warm-cache, cross-source
// search) are exempted here. Call sites for those endpoints should still
// pass their own AbortSignal so the request is bounded.
// AbortSignal.timeout() is wallclock and applies to the whole request, so
// using a too-short cap on a long-running JSON endpoint silently aborts
// the connection and the success-handler never runs.
const SLOW_API_PREFIXES = [
  '/api/homepage/warm',
  '/api/search/multi',
]
const _origFetch = window.fetch
window.fetch = function (input, init) {
  if (!init?.signal && typeof input === 'string' && input.startsWith('/api/')) {
    const isSlow = SLOW_API_PREFIXES.some(p => input.startsWith(p))
    if (!isSlow) {
      return _origFetch(input, { ...init, signal: AbortSignal.timeout(15000) })
    }
  }
  return _origFetch(input, init)
}

import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import AppShell from './components/AppShell'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <AppShell />
  </BrowserRouter>
)
