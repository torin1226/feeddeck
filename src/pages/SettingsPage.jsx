import { useState, useEffect, useCallback } from 'react'
import useThemeStore from '../stores/themeStore'
import useModeStore from '../stores/modeStore'
import { useNavigate } from 'react-router-dom'

const API = '/api'

export default function SettingsPage() {
  const navigate = useNavigate()
  const { theme, toggleTheme } = useThemeStore()
  const { isSFW } = useModeStore()
  const [sources, setSources] = useState([])
  const [adapterHealth, setAdapterHealth] = useState(null)
  const [loading, setLoading] = useState(true)

  // New source form
  const [showAdd, setShowAdd] = useState(false)
  const [newSource, setNewSource] = useState({ domain: '', mode: 'nsfw', label: '', query: '' })
  const [addError, setAddError] = useState('')
  const [addLoading, setAddLoading] = useState(false)

  const fetchSources = useCallback(async () => {
    try {
      const [srcRes, healthRes] = await Promise.all([
        fetch(`${API}/sources/list`),
        fetch(`${API}/sources/health`),
      ])
      const srcData = await srcRes.json()
      const healthData = await healthRes.json()
      setSources(srcData.sources || [])
      setAdapterHealth(healthData)
    } catch (err) {
      console.error('Failed to load sources:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchSources() }, [fetchSources])

  const toggleSource = async (domain, currentActive) => {
    await fetch(`${API}/sources/${domain}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !currentActive }),
    })
    fetchSources()
  }

  const deleteSource = async (domain) => {
    await fetch(`${API}/sources/${domain}`, { method: 'DELETE' })
    fetchSources()
  }

  const addSource = async (e) => {
    e.preventDefault()
    setAddError('')
    setAddLoading(true)
    try {
      const res = await fetch(`${API}/sources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSource),
      })
      const data = await res.json()
      if (!res.ok) {
        setAddError(data.error || 'Failed to add source')
        return
      }
      setNewSource({ domain: '', mode: 'nsfw', label: '', query: '' })
      setShowAdd(false)
      fetchSources()
    } catch (err) {
      setAddError(err.message)
    } finally {
      setAddLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-surface/90 backdrop-blur-md border-b border-surface-border">
        <div className="flex items-center gap-4 px-4 md:px-6 h-14">
          <button onClick={() => navigate(-1)} className="text-text-secondary hover:text-text-primary transition-colors">
            ← Back
          </button>
          <h1 className="font-semibold text-text-primary">Settings</h1>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-8 space-y-8">

        {/* Theme */}
        <section>
          <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">Appearance</h2>
          <div className="bg-surface-raised rounded-xl border border-surface-border p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-text-primary font-medium">Theme</div>
                <div className="text-text-muted text-sm">{theme === 'dark' ? 'Dark mode (Netflix aesthetic)' : 'Light mode'}</div>
              </div>
              <button
                onClick={toggleTheme}
                className="px-4 py-2 rounded-lg bg-surface-overlay border border-surface-border text-text-primary text-sm hover:bg-surface-border transition-colors"
              >
                {theme === 'dark' ? '☀ Light' : '🌙 Dark'}
              </button>
            </div>
          </div>
        </section>

        {/* Feed Sources */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">Feed Sources</h2>
            <button
              onClick={() => setShowAdd(!showAdd)}
              className="px-3 py-1.5 rounded-lg text-sm bg-accent/90 text-white hover:bg-accent transition-colors font-medium"
            >
              {showAdd ? 'Cancel' : '+ Add Source'}
            </button>
          </div>

          {/* Add source form */}
          {showAdd && (
            <form onSubmit={addSource} className="bg-surface-raised rounded-xl border border-surface-border p-4 mb-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder="Domain (e.g. xvideos.com)"
                  value={newSource.domain}
                  onChange={(e) => setNewSource(s => ({ ...s, domain: e.target.value }))}
                  className="bg-surface-overlay border border-surface-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-text-muted"
                  required
                />
                <select
                  value={newSource.mode}
                  onChange={(e) => setNewSource(s => ({ ...s, mode: e.target.value }))}
                  className="bg-surface-overlay border border-surface-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-text-muted"
                >
                  <option value="nsfw">NSFW</option>
                  <option value="social">Social</option>
                </select>
              </div>
              <input
                type="text"
                placeholder="Label (e.g. XVideos)"
                value={newSource.label}
                onChange={(e) => setNewSource(s => ({ ...s, label: e.target.value }))}
                className="w-full bg-surface-overlay border border-surface-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-text-muted"
                required
              />
              <input
                type="text"
                placeholder="Search query (e.g. trending, popular new)"
                value={newSource.query}
                onChange={(e) => setNewSource(s => ({ ...s, query: e.target.value }))}
                className="w-full bg-surface-overlay border border-surface-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-text-muted"
                required
              />
              {addError && <p className="text-accent text-sm">{addError}</p>}
              <button
                type="submit"
                disabled={addLoading}
                className="px-4 py-2 rounded-lg text-sm bg-accent/90 text-white hover:bg-accent transition-colors font-medium disabled:opacity-50"
              >
                {addLoading ? 'Testing source...' : 'Add & Test'}
              </button>
            </form>
          )}

          {/* Source list */}
          {loading ? (
            <div className="text-text-muted text-sm">Loading sources...</div>
          ) : (
            <div className="space-y-2">
              {sources.map((src) => (
                <div
                  key={src.domain}
                  className={`bg-surface-raised rounded-xl border border-surface-border p-4 flex items-center justify-between ${
                    !src.active ? 'opacity-50' : ''
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-text-primary font-medium">{src.label}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase ${
                        src.mode === 'nsfw'
                          ? 'bg-accent/20 text-accent'
                          : 'bg-amber-500/20 text-amber-400'
                      }`}>
                        {src.mode}
                      </span>
                      {!src.active && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-overlay text-text-muted font-semibold">
                          PAUSED
                        </span>
                      )}
                    </div>
                    <div className="text-text-muted text-xs mt-0.5 truncate">
                      {src.domain} · query: "{src.query}" · weight: {src.weight}
                    </div>
                    {src.last_fetched && (
                      <div className="text-text-muted text-[10px] mt-0.5">
                        Last fetched: {new Date(src.last_fetched + 'Z').toLocaleString()}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 ml-4 shrink-0">
                    <button
                      onClick={() => toggleSource(src.domain, src.active)}
                      className="px-3 py-1.5 rounded-lg text-xs border border-surface-border text-text-secondary hover:text-text-primary hover:border-text-muted transition-colors"
                    >
                      {src.active ? 'Pause' : 'Resume'}
                    </button>
                    <button
                      onClick={() => deleteSource(src.domain)}
                      className="px-3 py-1.5 rounded-lg text-xs border border-accent/30 text-accent hover:bg-accent/10 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
              {sources.length === 0 && (
                <div className="text-text-muted text-sm text-center py-8">
                  No sources configured. Add one above.
                </div>
              )}
            </div>
          )}
        </section>

        {/* Adapter Health */}
        {adapterHealth && (
          <section>
            <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">Adapter Health</h2>
            <div className="space-y-2">
              {adapterHealth.adapters.map((adapter) => (
                <div key={adapter.name} className="bg-surface-raised rounded-xl border border-surface-border p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${
                        adapter.disabled ? 'bg-accent' : adapter.available ? 'bg-green-500' : 'bg-yellow-500'
                      }`} />
                      <span className="text-text-primary font-medium">{adapter.name}</span>
                      {adapter.version && <span className="text-text-muted text-xs">v{adapter.version}</span>}
                    </div>
                    <span className={`text-xs font-semibold ${
                      adapter.disabled ? 'text-accent' : adapter.available ? 'text-green-500' : 'text-yellow-500'
                    }`}>
                      {adapter.disabled ? 'DISABLED' : adapter.available ? 'OK' : 'UNAVAILABLE'}
                    </span>
                  </div>
                  {adapter.stats && (adapter.stats.successes > 0 || adapter.stats.failures > 0) && (
                    <div className="mt-2 text-text-muted text-xs flex gap-4">
                      <span>{adapter.stats.successes} OK</span>
                      <span>{adapter.stats.failures} failed</span>
                      {adapter.stats.lastError && (
                        <span className="text-accent truncate">Last: {adapter.stats.lastError.message}</span>
                      )}
                    </div>
                  )}
                  <div className="mt-1 text-text-muted text-[10px]">
                    {adapter.supportedDomains.length > 0
                      ? adapter.supportedDomains.join(', ')
                      : 'Universal fallback'}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
