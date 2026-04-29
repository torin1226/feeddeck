import { useState, useEffect } from 'react'
import useHomeStore from '../stores/homeStore'

// Floating debug overlay for the shuffle/refresh button.
// Re-reads homeStore state on every render and after a shuffle event
// to surface what the click actually did. Bottom-right corner.
export default function ShuffleDebugOverlay() {
  const refreshing = useHomeStore(s => s.refreshing)
  const shuffling = useHomeStore(s => s.shuffling)
  const categories = useHomeStore(s => s.categories)
  const [tick, setTick] = useState(0)

  // Bump tick whenever the global debug log changes so we re-render.
  useEffect(() => {
    const id = setInterval(() => {
      const log = window.__shuffleDebugLog
      if (log && log.length !== window.__shuffleDebugLastLen) {
        window.__shuffleDebugLastLen = log.length
        setTick(t => t + 1)
      }
    }, 200)
    return () => clearInterval(id)
  }, [])

  const log = window.__shuffleDebugLog || []
  const recent = log.slice(-6).reverse()

  const sample = (categories || []).slice(0, 5).map(c => ({
    key: c._key,
    label: c.label?.slice(0, 18),
    pinned: !!c._pinned,
    n: c.items?.length,
    top: (c.items || [])[0]?.id?.slice(-12) || (c.items || [])[0]?.url?.slice(-14),
  }))

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 12,
        right: 12,
        zIndex: 9999,
        background: 'rgba(0,0,0,0.85)',
        color: '#0f0',
        padding: '10px 12px',
        borderRadius: 8,
        fontFamily: 'ui-monospace, monospace',
        fontSize: 11,
        lineHeight: 1.4,
        maxWidth: 420,
        maxHeight: '60vh',
        overflow: 'auto',
        border: '1px solid #0f0',
        pointerEvents: 'auto',
      }}
      data-tick={tick}
    >
      <div style={{ color: '#fff', fontWeight: 'bold', marginBottom: 4 }}>
        SHUFFLE DEBUG
      </div>
      <div>refreshing: <span style={{ color: refreshing ? '#f88' : '#0f0' }}>{String(refreshing)}</span></div>
      <div>shuffling: <span style={{ color: shuffling ? '#f88' : '#0f0' }}>{String(shuffling)}</span></div>
      <div>cats.length: {categories?.length ?? 'null'}</div>
      <div style={{ marginTop: 6, color: '#ff0' }}>top of first 5 rows:</div>
      {sample.map((s, i) => (
        <div key={i} style={{ color: '#aaf' }}>
          {i}. {s.pinned ? '📌 ' : '  '}{s.key || s.label} (n={s.n}) → {s.top}
        </div>
      ))}
      <div style={{ marginTop: 6, color: '#ff0' }}>recent events:</div>
      {recent.length === 0 && <div style={{ color: '#888' }}>(none yet)</div>}
      {recent.map((e, i) => (
        <div key={i} style={{ color: e.kind === 'error' ? '#f88' : e.kind === 'bail' ? '#fa0' : '#9f9' }}>
          [{new Date(e.t).toLocaleTimeString().slice(-8)}] {e.msg}
        </div>
      ))}
    </div>
  )
}
