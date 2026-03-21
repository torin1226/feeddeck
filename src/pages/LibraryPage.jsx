import { useState, useEffect } from 'react'
import useModeStore from '../stores/modeStore'
import useLibraryStore from '../stores/libraryStore'
import Header from '../components/Header'
import VideoGrid from '../components/VideoGrid'
import DebugPanel from '../components/DebugPanel'

// ============================================================
// LibraryPage
// The original app layout — header, video grid, debug panel.
// Mounted at /library route.
// ============================================================

export default function LibraryPage() {
  const isSFW = useModeStore((s) => s.isSFW)
  const { loadFromServer, seedDemoData } = useLibraryStore()
  const [searchQuery, setSearchQuery] = useState('')
  const [remoteQuery, setRemoteQuery] = useState('')
  const [debugOpen, setDebugOpen] = useState(false)

  // Ctrl+Shift+D toggles debug panel
  useEffect(() => {
    const handler = (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        e.preventDefault()
        setDebugOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Load library on startup
  useEffect(() => {
    loadFromServer().then(() => {
      const current = useLibraryStore.getState().videos
      if (current.length === 0) {
        seedDemoData()
      }
    })
  }, [])

  return (
    <div className="h-screen overflow-hidden bg-surface text-text-primary flex flex-col font-sans">
      <Header
        onSearch={(q) => {
          setSearchQuery(q)
          if (!q) setRemoteQuery('')
        }}
        onSearchSubmit={setRemoteQuery}
      />

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <main className="flex-1 overflow-y-auto">
          <VideoGrid searchQuery={searchQuery} remoteQuery={remoteQuery} />
        </main>
      </div>

      {isSFW && (
        <div
          className="fixed bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r
          from-transparent via-amber-400/30 to-transparent pointer-events-none"
        />
      )}

      <DebugPanel open={debugOpen} onClose={() => setDebugOpen(false)} />
    </div>
  )
}
