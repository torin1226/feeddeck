import './migrations' // Must be first — renames pv-* → fd-* before stores init

// Global fetch timeout — no API call should hang forever (15s default)
const _origFetch = window.fetch
window.fetch = function (input, init) {
  if (!init?.signal && typeof input === 'string' && input.startsWith('/api/')) {
    return _origFetch(input, { ...init, signal: AbortSignal.timeout(15000) })
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
