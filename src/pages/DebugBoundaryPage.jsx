import { useEffect, useState } from 'react'

// ============================================================
// Debug — Boundary Stats
// Read-only table of every wrapped external boundary and its
// outcome counts since the in-memory tally was last reset.
// Refreshes every 10s. Internal-only — the deploy target is a
// single Beelink box on Torin's home network.
// ============================================================

const OUTCOME_COLS = [
  'ok', 'empty', 'wrong_shape', 'auth_failed',
  'rate_limited', 'timeout', 'blocked', 'unknown_error',
]

export default function DebugBoundaryPage() {
  const [boundaries, setBoundaries] = useState({})
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const r = await fetch('/api/debug/boundary-stats')
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const json = await r.json()
        if (!cancelled) {
          setBoundaries(json.boundaries || {})
          setError(null)
        }
      } catch (err) {
        if (!cancelled) setError(err.message)
      }
    }
    load()
    const id = setInterval(load, 10_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  const rows = Object.entries(boundaries)
    .map(([name, bucket]) => ({
      name,
      ...bucket,
      total: OUTCOME_COLS.reduce((s, c) => s + (bucket[c] || 0), 0),
      failures: OUTCOME_COLS.filter(c => c !== 'ok').reduce((s, c) => s + (bucket[c] || 0), 0),
    }))
    .sort((a, b) => b.failures - a.failures)

  return (
    <div className="min-h-screen bg-surface text-text p-8">
      <h1 className="text-2xl font-bold mb-4">Boundary stats</h1>
      <p className="text-text/60 mb-4">Cumulative since server start or last reset. Refreshes every 10 seconds.</p>
      {error && <p className="text-red-500 mb-4">Error: {error}</p>}
      {rows.length === 0 && <p>No boundary calls recorded yet.</p>}
      {rows.length > 0 && (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-text/20">
              <th className="text-left p-2">Boundary</th>
              <th className="text-right p-2">Total</th>
              <th className="text-right p-2">Failures</th>
              {OUTCOME_COLS.map(c => (
                <th key={c} className="text-right p-2">{c}</th>
              ))}
              <th className="text-left p-2">Last failure</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.name} className="border-b border-text/10">
                <td className="p-2 font-mono">{row.name}</td>
                <td className="text-right p-2">{row.total}</td>
                <td className={`text-right p-2 ${row.failures > 0 ? 'text-red-500' : ''}`}>
                  {row.failures}
                </td>
                {OUTCOME_COLS.map(c => (
                  <td key={c} className="text-right p-2">{row[c] || 0}</td>
                ))}
                <td className="p-2 text-text/60">
                  {row.lastFailureAt ? new Date(row.lastFailureAt).toLocaleString() : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
