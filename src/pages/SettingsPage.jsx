import { useState, useEffect, useCallback } from 'react'
import useThemeStore from '../stores/themeStore'
import useModeStore from '../stores/modeStore'
import useViewTransitionNavigate from '../hooks/useViewTransitionNavigate'

const API = '/api'

export default function SettingsPage() {
  const navigate = useViewTransitionNavigate()
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

  // Tag preferences
  const [tagPrefs, setTagPrefs] = useState([])
  const [newTag, setNewTag] = useState('')
  const [newTagPref, setNewTagPref] = useState('liked')

  // Cookie auth
  const [cookieStatus, setCookieStatus] = useState(null)

  // Recommendation seeding (3.3.1)
  const [seedPlatform, setSeedPlatform] = useState('pornhub')
  const [seedUsername, setSeedUsername] = useState('')
  const [seedLog, setSeedLog] = useState([])
  const [seedRunning, setSeedRunning] = useState(false)
  const [seedResult, setSeedResult] = useState(null)

  const fetchSources = useCallback(async () => {
    try {
      const [srcRes, healthRes, tagRes, cookieRes] = await Promise.all([
        fetch(`${API}/sources/list`),
        fetch(`${API}/sources/health`),
        fetch(`${API}/tags/preferences`),
        fetch(`${API}/cookies/status`),
      ])
      const srcData = await srcRes.json()
      const healthData = await healthRes.json()
      const tagData = await tagRes.json()
      const cookieData = await cookieRes.json()
      setSources(srcData.sources || [])
      setAdapterHealth(healthData)
      setTagPrefs(tagData.preferences || [])
      setCookieStatus(cookieData)
    } catch (err) {
      console.error('Failed to load settings:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchSources() }, [fetchSources])

  // Load saved usernames on mount
  useEffect(() => {
    fetch(`${API}/recommendations/username`).then(r => r.json()).then(d => {
      if (d.usernames?.[seedPlatform]) setSeedUsername(d.usernames[seedPlatform])
    }).catch(() => {})
  }, [seedPlatform])

  const saveUsername = async () => {
    if (!seedUsername.trim()) return
    await fetch(`${API}/recommendations/username`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: seedPlatform, username: seedUsername.trim() }),
    })
  }

  const runSeed = async () => {
    await saveUsername()
    setSeedRunning(true)
    setSeedLog([])
    setSeedResult(null)
    try {
      const es = new EventSource(`${API}/recommendations/seed?platform=${seedPlatform}&force=1`)
      es.onmessage = (e) => {
        const data = JSON.parse(e.data)
        if (data.type === 'complete') {
          setSeedResult(data)
          setSeedRunning(false)
          es.close()
          fetchSources() // refresh tag prefs
        } else if (data.type === 'error') {
          setSeedLog(prev => [...prev, data.message])
          setSeedRunning(false)
          es.close()
        } else {
          const msg = data.message || `${data.phase}: ${data.current}/${data.total}`
          setSeedLog(prev => [...prev.slice(-20), msg])
        }
      }
      es.onerror = () => {
        setSeedRunning(false)
        es.close()
      }
    } catch {
      setSeedRunning(false)
    }
  }

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

  const handleCookieUpload = async (e, mode) => {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    const modeParam = mode ? `?mode=${mode}` : ''
    const res = await fetch(`${API}/cookies${modeParam}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: text,
    })
    const data = await res.json()
    if (res.ok) {
      fetchSources() // refresh cookie status
    } else {
      alert(data.error || 'Failed to import cookies')
    }
    e.target.value = '' // reset file input
  }

  const handleCookieDelete = async (mode) => {
    const modeParam = mode ? `?mode=${mode}` : ''
    await fetch(`${API}/cookies${modeParam}`, { method: 'DELETE' })
    fetchSources()
  }

  const addTagPref = async () => {
    if (!newTag.trim()) return
    await fetch(`${API}/tags/preferences`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag: newTag.trim(), preference: newTagPref }),
    })
    setNewTag('')
    fetchSources()
  }

  const removeTagPref = async (tag) => {
    await fetch(`${API}/tags/preferences/${encodeURIComponent(tag)}`, { method: 'DELETE' })
    fetchSources()
  }

  return (
    <div className="min-h-screen bg-surface">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-surface/90 backdrop-blur-md border-b border-surface-border">
        <div className="flex items-center gap-4 px-4 md:px-6 h-14">
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-lg">{isSFW ? '📡' : '▶'}</span>
            <span className="font-semibold text-text-primary hidden sm:block">FeedDeck</span>
          </div>
          <nav className="hidden md:flex gap-5 shrink-0">
            {[{ label: 'Home', path: '/' }, { label: 'Feed', path: '/feed' }, { label: 'Library', path: '/library' }].map(item => (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className="text-sm font-medium text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
              >
                {item.label}
              </button>
            ))}
          </nav>
          <div className="flex-1" />
          <h1 className="font-semibold text-text-primary text-sm">Settings</h1>
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

        {/* Tag Preferences */}
        <section>
          <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">Tag Preferences</h2>
          <div className="bg-surface-raised rounded-xl border border-surface-border p-4 space-y-3">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Add a tag..."
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && newTag.trim()) addTagPref() }}
                className="flex-1 bg-surface-overlay border border-surface-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[rgba(244,63,94,0.5)] focus-visible:outline-offset-2 focus:border-text-muted"
              />
              <select
                value={newTagPref}
                onChange={(e) => setNewTagPref(e.target.value)}
                className="bg-surface-overlay border border-surface-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[rgba(244,63,94,0.5)] focus-visible:outline-offset-2"
              >
                <option value="liked">Liked</option>
                <option value="disliked">Disliked</option>
              </select>
              <button
                onClick={addTagPref}
                disabled={!newTag.trim()}
                className="px-3 py-2 rounded-lg text-sm bg-accent/90 text-white hover:bg-accent transition-colors font-medium disabled:opacity-50"
              >
                Add
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {tagPrefs.filter(p => p.preference === 'liked').map(p => (
                <span key={p.tag} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-green-500/15 text-green-400 border border-green-500/25">
                  {p.tag}
                  <button onClick={() => removeTagPref(p.tag)} className="hover:text-white transition-colors cursor-pointer">✕</button>
                </span>
              ))}
              {tagPrefs.filter(p => p.preference === 'disliked').map(p => (
                <span key={p.tag} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-red-500/15 text-red-400 border border-red-500/25">
                  {p.tag}
                  <button onClick={() => removeTagPref(p.tag)} className="hover:text-white transition-colors cursor-pointer">✕</button>
                </span>
              ))}
              {tagPrefs.length === 0 && (
                <p className="text-text-muted text-sm">No tag preferences set. Add tags you like or dislike to improve recommendations.</p>
              )}
            </div>
          </div>
        </section>

        {/* Cookie Auth */}
        <section>
          <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">Browser Cookies</h2>
          <div className="bg-surface-raised rounded-xl border border-surface-border p-4 space-y-4">
            <p className="text-text-muted text-sm">
              Import browser cookies per mode to access personalized feeds and premium content.
              Export cookies using a browser extension (e.g. "Get cookies.txt LOCALLY").
            </p>

            {/* Social cookies */}
            <CookieRow
              label="Social"
              hint="YouTube, TikTok, Instagram"
              status={cookieStatus?.social}
              onUpload={(e) => handleCookieUpload(e, 'social')}
              onDelete={() => handleCookieDelete('social')}
            />

            {/* NSFW cookies */}
            <CookieRow
              label="NSFW"
              hint="PornHub, RedGifs, etc."
              status={cookieStatus?.nsfw}
              onUpload={(e) => handleCookieUpload(e, 'nsfw')}
              onDelete={() => handleCookieDelete('nsfw')}
            />

            {/* Legacy (backward compat) */}
            {cookieStatus?.legacy?.installed && (
              <div className="pt-2 border-t border-surface-border">
                <CookieRow
                  label="Legacy (combined)"
                  hint="Used as fallback when mode-specific cookies are missing"
                  status={cookieStatus.legacy}
                  onUpload={(e) => handleCookieUpload(e)}
                  onDelete={() => handleCookieDelete()}
                />
              </div>
            )}
          </div>
        </section>

        {/* Recommendation Seeding (3.3.1) */}
        <section>
          <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">Seed Recommendations</h2>
          <div className="bg-surface-raised rounded-xl border border-surface-border p-4 space-y-3">
            <p className="text-text-muted text-sm">
              Import your watch history and favorites to bootstrap personalized recommendations.
              Requires cookies to be installed for the selected platform.
            </p>
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <label className="text-xs text-text-muted block mb-1">Platform</label>
                <select
                  value={seedPlatform}
                  onChange={(e) => setSeedPlatform(e.target.value)}
                  className="w-full bg-surface-overlay border border-surface-border rounded-lg px-3 py-2 text-sm text-text-primary"
                >
                  <option value="pornhub">PornHub</option>
                  <option value="youtube">YouTube</option>
                  <option value="tiktok">TikTok</option>
                </select>
              </div>
              <div className="flex-1">
                <label className="text-xs text-text-muted block mb-1">Username</label>
                <input
                  type="text"
                  value={seedUsername}
                  onChange={(e) => setSeedUsername(e.target.value)}
                  onBlur={saveUsername}
                  placeholder="your-username"
                  className="w-full bg-surface-overlay border border-surface-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted"
                />
              </div>
              <button
                onClick={runSeed}
                disabled={seedRunning || (seedPlatform !== 'youtube' && !seedUsername.trim())}
                className="px-4 py-2 rounded-lg text-sm bg-accent/90 text-white hover:bg-accent transition-colors font-medium disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
              >
                {seedRunning ? 'Seeding...' : 'Seed Now'}
              </button>
            </div>

            {/* Progress log */}
            {seedLog.length > 0 && (
              <div className="bg-surface-overlay rounded-lg p-3 max-h-32 overflow-y-auto text-xs font-mono text-text-muted space-y-0.5">
                {seedLog.map((msg, i) => <div key={i}>{msg}</div>)}
              </div>
            )}

            {/* Completion summary */}
            {seedResult && (
              <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-sm">
                <div className="text-green-400 font-medium mb-1">Seeding complete</div>
                <div className="text-text-muted text-xs space-y-0.5">
                  <div>Scanned {seedResult.videosScanned} videos ({seedResult.videosFailed} failed)</div>
                  <div>Imported {seedResult.videosImported} videos to library</div>
                  <div>Found {seedResult.tagsFound} tags, {seedResult.categoriesFound} categories</div>
                  <div>Added {seedResult.tagsAdded} new tag preferences</div>
                  {seedResult.topTags?.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {seedResult.topTags.map(t => (
                        <span key={t.tag} className="px-2 py-0.5 rounded-full bg-green-500/20 text-green-300 text-xs">
                          {t.tag} ({t.count})
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
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
                  className="bg-surface-overlay border border-surface-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[rgba(244,63,94,0.5)] focus-visible:outline-offset-2 focus:border-text-muted"
                  required
                />
                <select
                  value={newSource.mode}
                  onChange={(e) => setNewSource(s => ({ ...s, mode: e.target.value }))}
                  className="bg-surface-overlay border border-surface-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[rgba(244,63,94,0.5)] focus-visible:outline-offset-2 focus:border-text-muted"
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
                className="w-full bg-surface-overlay border border-surface-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[rgba(244,63,94,0.5)] focus-visible:outline-offset-2 focus:border-text-muted"
                required
              />
              <input
                type="text"
                placeholder="Search query (e.g. trending, popular new)"
                value={newSource.query}
                onChange={(e) => setNewSource(s => ({ ...s, query: e.target.value }))}
                className="w-full bg-surface-overlay border border-surface-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[rgba(244,63,94,0.5)] focus-visible:outline-offset-2 focus:border-text-muted"
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

// Sub-component for per-mode cookie row
function CookieRow({ label, hint, status, onUpload, onDelete }) {
  return (
    <div className="flex items-center justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${status?.installed ? 'bg-green-500' : 'bg-surface-border'}`} />
          <span className="text-text-primary text-sm font-medium">{label}</span>
        </div>
        <div className="text-text-muted text-xs mt-0.5 ml-4">
          {status?.installed
            ? `${status.cookies} cookies · Updated ${new Date(status.modified).toLocaleDateString()}`
            : hint}
        </div>
      </div>
      <div className="flex gap-2 shrink-0">
        <label className="px-3 py-1.5 rounded-lg text-xs border border-surface-border text-text-secondary hover:text-text-primary hover:border-text-muted transition-colors cursor-pointer">
          {status?.installed ? 'Re-import' : 'Import'}
          <input type="file" accept=".txt" className="hidden" onChange={onUpload} />
        </label>
        {status?.installed && (
          <button
            onClick={onDelete}
            className="px-3 py-1.5 rounded-lg text-xs border border-accent/30 text-accent hover:bg-accent/10 transition-colors cursor-pointer"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  )
}
