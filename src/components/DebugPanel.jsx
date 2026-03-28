import { useState, useEffect } from 'react'
import clsx from 'clsx'
import useModeStore from '../stores/modeStore'
import useLibraryStore from '../stores/libraryStore'
import useQueueStore from '../stores/queueStore'

// ============================================================
// DebugPanel
// Saves you from ever opening browser dev tools.
// Toggle: Ctrl+Shift+D (wired in App.jsx via keyboard listener)
// Tabs: state, console, storage, network
// ============================================================

export default function DebugPanel({ open, onClose }) {
  const isSFW = useModeStore(s => s.isSFW)
  const videos = useLibraryStore(s => s.videos)
  const queue = useQueueStore(s => s.queue)
  const [logs, setLogs] = useState([])
  const [activeTab, setActiveTab] = useState('state')

  // Intercept console output while panel is mounted
  useEffect(() => {
    const orig = {
      log: console.log,
      warn: console.warn,
      error: console.error,
    }

    function capture(level, ...args) {
      orig[level](...args)
      const msg = args.map(a =>
        typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)
      ).join(' ')
      setLogs(prev => [...prev.slice(-200), {
        level, msg, time: new Date().toLocaleTimeString()
      }])
    }

    console.log = (...a) => capture('log', ...a)
    console.warn = (...a) => capture('warn', ...a)
    console.error = (...a) => capture('error', ...a)

    return () => {
      console.log = orig.log
      console.warn = orig.warn
      console.error = orig.error
    }
  }, [])

  if (!open) return null

  const tabs = ['state', 'console', 'storage', 'network']

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[200] bg-surface-raised border-t border-surface-border shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-border">
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono font-bold text-accent">DEBUG</span>
          <div className="flex gap-1">
            {tabs.map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={clsx(
                  'px-2 py-0.5 text-xs rounded transition-colors',
                  activeTab === tab
                    ? 'bg-accent text-white'
                    : 'text-text-muted hover:text-text-secondary'
                )}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-text-muted hover:text-text-primary transition-colors text-sm"
        >
          ✕
        </button>
      </div>

      {/* Panel content */}
      <div className="h-48 overflow-y-auto font-mono text-xs p-3">

        {/* STATE tab */}
        {activeTab === 'state' && (
          <div className="grid grid-cols-2 gap-x-8 gap-y-1">
            <Row label="Mode" value={isSFW ? 'Social 📡' : 'NSFW'} highlight={!isSFW} />
            <Row label="Library size" value={`${videos.length} videos`} />
            <Row label="Queue length" value={queue.length} />
            <Row label="Screen" value={`${window.innerWidth}×${window.innerHeight}px`} />
            <Row label="Mobile layout" value={window.innerWidth < 768 ? 'yes' : 'no'} />
            <Row label="Backend" value="localhost:3001" />
          </div>
        )}

        {/* CONSOLE tab */}
        {activeTab === 'console' && (
          <div className="space-y-0.5">
            {logs.length === 0
              ? <span className="text-text-muted">No logs yet. Interact with the app.</span>
              : logs.map((log, i) => (
                <div key={i} className="flex gap-2">
                  <span className="text-text-muted shrink-0">{log.time}</span>
                  <span className={clsx(
                    log.level === 'error' && 'text-red-400',
                    log.level === 'warn' && 'text-yellow-400',
                    log.level === 'log' && 'text-text-secondary',
                  )}>
                    {log.msg}
                  </span>
                </div>
              ))
            }
          </div>
        )}

        {/* STORAGE tab */}
        {activeTab === 'storage' && (
          <div className="space-y-3">
            {['fd-mode', 'fd-lib', 'fd-queue'].map(key => {
              const raw = localStorage.getItem(key)
              const kb = raw ? (new Blob([raw]).size / 1024).toFixed(1) : 0
              return (
                <div key={key}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-accent">{key}</span>
                    <span className="text-text-muted">{kb} KB</span>
                  </div>
                  <pre className="text-text-muted text-[10px] whitespace-pre-wrap break-all max-h-16 overflow-y-auto">
                    {raw ? JSON.stringify(JSON.parse(raw), null, 2).slice(0, 400) : 'empty'}
                  </pre>
                </div>
              )
            })}
            <button
              onClick={() => {
                if (confirm('Clear all local storage? This resets your library, queue, and preferences.')) {
                  localStorage.clear()
                  window.location.reload()
                }
              }}
              className="px-3 py-1 text-xs bg-red-900/30 text-red-400 rounded hover:bg-red-900/50 transition-colors"
            >
              Clear All Storage
            </button>
          </div>
        )}

        {/* NETWORK tab */}
        {activeTab === 'network' && (
          <div className="space-y-2 text-text-muted">
            <p>API proxy: <span className="text-text-secondary">localhost:3001</span></p>
            <p className="mt-2 text-text-secondary">Routes:</p>
            <p className="ml-2">GET  /api/health</p>
            <p className="ml-2">GET  /api/metadata?url=...</p>
            <p className="ml-2">GET  /api/stream-url?url=...</p>
            <p className="ml-2">GET  /api/videos</p>
            <p className="ml-2">GET  /api/search?q=...</p>
            <div className="flex gap-2 mt-3">
              <button
                onClick={async () => {
                  try {
                    const r = await fetch('/api/health')
                    const d = await r.json()
                    console.log('Health:', d)
                  } catch (e) {
                    console.error('Backend unreachable:', e.message)
                  }
                }}
                className="px-3 py-1 bg-surface-overlay rounded hover:bg-surface-border transition-colors text-text-secondary"
              >
                Ping backend
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ label, value, highlight }) {
  return (
    <>
      <span className="text-text-muted">{label}:</span>
      <span className={highlight ? 'text-accent' : 'text-text-secondary'}>{String(value)}</span>
    </>
  )
}
