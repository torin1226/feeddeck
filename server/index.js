import express from 'express'
import cors from 'cors'
import { networkInterfaces } from 'os'
import { existsSync, writeFileSync, unlinkSync, statSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { randomBytes } from 'crypto'
import { getCookieArgs, COOKIE_MAP, MODE_COOKIE_FILES, LEGACY_COOKIE_FILE } from './cookies.js'
import { initDatabase, db } from './database.js'
import { registry, ytdlp as ytdlpAdapter, scraper as scraperAdapter, closeAllSources } from './sources/index.js'
import { logger } from './logger.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Allowed CDN domains for proxy endpoints (prevents SSRF)
const ALLOWED_CDN_DOMAINS = [
  'phncdn.com',
  'googlevideo.com',
  'youtube.com',
  'ytimg.com',
  'tiktokcdn.com',
  'tiktokcdn-us.com',
  'akamaized.net',
  'cloudfront.net',
  'xvideos-cdn.com',
  'spankbang.com',
  'redgifs.com',
  'thumbs2.redgifs.com',
]

function isAllowedCdnUrl(url) {
  try {
    const hostname = new URL(url).hostname
    return ALLOWED_CDN_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d))
  } catch {
    return false
  }
}

// ============================================================
// Backend Server
// Minimal Express API for:
//   - Fetching video metadata via yt-dlp
//   - Getting streaming URLs
//   - Serving the video library from SQLite
//   - Health check
//
// Runs on port 3001 (Vite proxies /api → here)
// ============================================================

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json())

// In production, serve the built Vite frontend
const distPath = join(__dirname, '..', 'dist')
if (existsSync(distPath)) {
  app.use(express.static(distPath))
}

// -----------------------------------------------------------
// Mode inference: determine if a URL/source is NSFW or social
// -----------------------------------------------------------
// Derived from COOKIE_MAP (single source of truth for domain→mode mapping)
const NSFW_DOMAINS = new Set(
  Object.entries(COOKIE_MAP).filter(([, v]) => v.mode === 'nsfw').map(([k]) => k)
)

function inferMode(urlOrSource) {
  if (!urlOrSource) return 'social'
  const str = urlOrSource.toLowerCase()
  for (const domain of NSFW_DOMAINS) {
    if (str.includes(domain)) return 'nsfw'
  }
  return 'social'
}

/** Read mode from request query, default to 'social' (fail safe).
 *  Logs a warning if mode param is missing on content endpoints. */
function getMode(req) {
  const mode = req.query.mode
  if (!mode) {
    logger.warn(`Missing mode param on ${req.path} — defaulting to social`, { query: req.query })
  }
  if (mode === 'nsfw') return 'nsfw'
  return 'social'
}

// -----------------------------------------------------------
// Health check
// -----------------------------------------------------------
app.get('/api/health', async (req, res) => {
  const ytdlpAvailable = ytdlpAdapter.isAvailable()

  res.json({
    status: 'ok',
    ytdlp: ytdlpAvailable ? (ytdlpAdapter.version || 'available') : 'not found',
    adapters: registry.adapters.map(a => a.name),
    database: db ? 'connected' : 'disconnected',
  })
})

// -----------------------------------------------------------
// GET /api/metadata?url=...
// Extract video metadata using yt-dlp
// -----------------------------------------------------------
app.get('/api/metadata', async (req, res) => {
  const { url } = req.query
  if (!url) return res.status(400).json({ error: 'URL required' })

  try {
    const metadata = await registry.extractMetadata(url)

    // Save to database
    try {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO videos (id, url, title, thumbnail, duration, tags, source, mode, added_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `)
      stmt.run(
        metadata.id,
        url,
        metadata.title,
        metadata.thumbnail,
        metadata.duration,
        JSON.stringify(metadata.tags),
        metadata.source,
        inferMode(url)
      )
    } catch (dbErr) {
      logger.warn('DB save failed', { error: dbErr.message })
    }

    res.json({ ...metadata, url })
  } catch (err) {
    logger.error('Metadata error', { error: err.message })
    const msg = err.message || ''
    if (msg.includes('not installed')) return res.status(500).json({ error: 'No extraction tools available' })
    if (msg.includes('unavailable') || msg.includes('Private')) return res.status(404).json({ error: 'Video unavailable or private' })
    if (msg.includes('Unsupported')) return res.status(400).json({ error: 'This site is not supported' })
    res.status(500).json({ error: 'Failed to extract metadata' })
  }
})

// -----------------------------------------------------------
// GET /api/stream-url?url=...
// Resolve the direct CDN URL for a video page via yt-dlp.
// Caches resolved URLs in feed_cache to avoid repeated yt-dlp calls.
// Returns { streamUrl } pointing to /api/proxy-stream for playback.
// -----------------------------------------------------------
app.get('/api/stream-url', async (req, res) => {
  const { url, format } = req.query
  if (!url) return res.status(400).json({ error: 'URL required' })

  // Check feed_cache for a cached, non-expired stream URL (skip cache if specific format requested)
  if (!format) {
    try {
      const cached = db.prepare(
        `SELECT stream_url, expires_at FROM feed_cache
         WHERE url = ? AND stream_url IS NOT NULL`
      ).get(url)

      if (cached?.stream_url) {
        // Only serve from cache if not expired (or no expiry set)
        const notExpired = !cached.expires_at || new Date(cached.expires_at + 'Z') > new Date()
        if (notExpired) {
          return res.json({ streamUrl: cached.stream_url })
        }
        // Expired — fall through to re-resolve
        logger.info('Stream URL expired, re-resolving', { url: url.substring(0, 60) })
      }
    } catch { /* fall through to yt-dlp */ }
  }

  try {
    // Use registry with fallback chain (yt-dlp → cobalt)
    const cdnUrl = await registry.getStreamUrl(url, format ? { format } : undefined)

    logger.info('Resolved stream URL', { format: cdnUrl.includes('.m3u8') ? 'HLS' : 'MP4', url: cdnUrl.substring(0, 80) })

    // Cache the resolved stream URL (expires in 2 hours — PornHub CDN URLs expire ~2hr)
    try {
      db.prepare(
        `UPDATE feed_cache SET stream_url = ?, expires_at = datetime('now', '+2 hours') WHERE url = ?`
      ).run(cdnUrl, url)
    } catch { /* cache miss is fine */ }

    res.json({ streamUrl: cdnUrl })
  } catch (err) {
    logger.error('Stream URL error:', { error: err.message })
    const msg = err.message || ''
    if (msg.includes('unavailable') || msg.includes('Private') || msg.includes('removed')) {
      return res.status(404).json({ error: 'Video unavailable or taken down' })
    }
    if (msg.includes('blocked') || msg.includes('geo')) {
      return res.status(403).json({ error: 'Video is geo-blocked in your region' })
    }
    if (msg.includes('429') || msg.includes('Too Many') || msg.includes('rate') || msg.includes('throttl')) {
      return res.status(429).json({ error: 'Rate limited — try again in a minute' })
    }
    if (msg.includes('Unsupported')) {
      return res.status(400).json({ error: 'This site is not supported' })
    }
    res.status(500).json({ error: 'Could not get streaming URL' })
  }
})

// -----------------------------------------------------------
// GET /api/stream-formats?url=... — list available quality options
// Runs yt-dlp -F and returns a simplified list of formats.
// -----------------------------------------------------------
app.get('/api/stream-formats', async (req, res) => {
  const { url } = req.query
  if (!url) return res.status(400).json({ error: 'URL required' })

  try {
    const { execFile } = await import('child_process')
    const { promisify } = await import('util')
    const execFileAsync = promisify(execFile)

    const { stdout } = await execFileAsync('yt-dlp', [
      ...getCookieArgs(url), '-j', '--no-warnings', '--no-playlist', url
    ], { timeout: 30000 })

    const info = JSON.parse(stdout)
    const formats = (info.formats || [])
      .filter(f => f.vcodec !== 'none' && f.ext === 'mp4')
      .map(f => ({
        format_id: f.format_id,
        quality: f.height ? `${f.height}p` : f.format_note || f.format_id,
        height: f.height || 0,
        filesize: f.filesize || f.filesize_approx || 0,
        fps: f.fps || 0,
      }))
      .sort((a, b) => a.height - b.height)
      // Dedupe by height
      .filter((f, i, arr) => i === 0 || f.height !== arr[i - 1].height)

    res.json({ formats, title: info.title })
  } catch (err) {
    logger.error('Stream formats error', { error: err.message })
    res.status(500).json({ error: 'Could not list formats' })
  }
})

// -----------------------------------------------------------
// GET /api/stream-url?url=...&format=...
// When format is specified, resolve that specific format's URL.
// -----------------------------------------------------------

// -----------------------------------------------------------
// GET /api/proxy-stream?url=...
// Proxies the video bytes from the CDN, adding the required
// Referer header. Supports Range requests for seeking.
// -----------------------------------------------------------
app.get('/api/proxy-stream', async (req, res) => {
  const { url } = req.query
  if (!url) return res.status(400).send('URL required')
  if (!isAllowedCdnUrl(url)) return res.status(403).send('Domain not allowed')

  try {
    let referer = 'https://www.youtube.com/'
    if (url.includes('pornhub') || url.includes('phncdn')) referer = 'https://www.pornhub.com/'
    else if (url.includes('tiktok')) referer = 'https://www.tiktok.com/'
    else if (url.includes('googlevideo')) referer = 'https://www.youtube.com/'

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
      'Referer': referer,
      'Origin': referer.replace(/\/$/, ''),
    }

    // Pass through Range header for seeking support
    if (req.headers.range) {
      headers['Range'] = req.headers.range
    }

    // 15s timeout to prevent hanging on slow/dead CDNs
    const upstream = await fetch(url, { headers, signal: AbortSignal.timeout(15000) })

    // Forward status and key headers
    res.status(upstream.status)
    const fwd = ['content-type', 'content-length', 'content-range', 'accept-ranges']
    for (const h of fwd) {
      const val = upstream.headers.get(h)
      if (val) res.setHeader(h, val)
    }

    // Pipe the body using Node streams (more robust than manual reader pump)
    const { Readable } = await import('stream')
    const nodeStream = Readable.fromWeb(upstream.body)

    // Per-chunk timeout: if no data arrives for 30s, abort the stalled stream
    let chunkTimer = null
    const resetChunkTimer = () => {
      clearTimeout(chunkTimer)
      chunkTimer = setTimeout(() => {
        logger.warn('Proxy stream stalled (no data for 30s), aborting')
        nodeStream.destroy()
        if (!res.writableEnded) res.end()
      }, 30_000)
    }
    resetChunkTimer()
    nodeStream.on('data', resetChunkTimer)
    nodeStream.on('end', () => clearTimeout(chunkTimer))

    nodeStream.pipe(res)
    nodeStream.on('error', () => { clearTimeout(chunkTimer); if (!res.writableEnded) res.end() })
    res.on('close', () => { clearTimeout(chunkTimer); nodeStream.destroy() })
  } catch (err) {
    logger.error('Proxy stream error:', { error: err.message })
    if (!res.headersSent) res.status(500).send('Stream proxy failed')
  }
})

// -----------------------------------------------------------
// GET /api/hls-proxy?url=...
// Proxies HLS playlists and segments from CDN.
// For .m3u8 files: rewrites segment URLs to also go through this proxy.
// For .ts segments: streams the bytes directly.
// This avoids Chrome's ORB (Opaque Response Blocking) which blocks
// hls.js and even native cross-origin media fetches on desktop Chrome.
// -----------------------------------------------------------
app.get('/api/hls-proxy', async (req, res) => {
  const { url } = req.query
  if (!url) return res.status(400).send('URL required')
  if (!isAllowedCdnUrl(url)) return res.status(403).send('Domain not allowed')

  try {
    let referer = 'https://www.youtube.com/'
    if (url.includes('pornhub') || url.includes('phncdn')) referer = 'https://www.pornhub.com/'
    else if (url.includes('tiktok')) referer = 'https://www.tiktok.com/'

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': referer,
    }
    if (req.headers.range) headers['Range'] = req.headers.range

    const upstream = await fetch(url, { headers, signal: AbortSignal.timeout(15000) })

    if (url.includes('.m3u8')) {
      // Rewrite m3u8 playlist: proxy ALL non-comment lines (segments, variant playlists)
      const text = await upstream.text()
      const baseUrl = url.substring(0, url.lastIndexOf('/') + 1)
      const rewritten = text.replace(/^(?!#)(\S+)$/gm, (line) => {
        const segUrl = line.startsWith('http') ? line : baseUrl + line
        return `/api/hls-proxy?url=${encodeURIComponent(segUrl)}`
      })
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl')
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.send(rewritten)
    } else {
      // Stream segment bytes using Node streams
      res.status(upstream.status)
      const ct = upstream.headers.get('content-type')
      if (ct) res.setHeader('Content-Type', ct)
      const cl = upstream.headers.get('content-length')
      if (cl) res.setHeader('Content-Length', cl)
      res.setHeader('Access-Control-Allow-Origin', '*')

      const { Readable } = await import('stream')
      const nodeStream = Readable.fromWeb(upstream.body)
      nodeStream.pipe(res)
      nodeStream.on('error', () => { if (!res.writableEnded) res.end() })
      res.on('close', () => { nodeStream.destroy() })
    }
  } catch (err) {
    logger.error('HLS proxy error:', { error: err.message })
    if (!res.headersSent) res.status(500).send('HLS proxy failed')
  }
})

// -----------------------------------------------------------
// GET /api/videos
// Return all videos from database
// -----------------------------------------------------------
app.get('/api/videos', (req, res) => {
  try {
    const mode = getMode(req)
    const rows = db.prepare('SELECT * FROM videos WHERE mode = ? ORDER BY added_at DESC').all(mode)
    const videos = rows.map((row) => ({
      ...row,
      tags: row.tags ? JSON.parse(row.tags) : [],
      durationFormatted: formatDuration(row.duration),
    }))
    res.json({ videos })
  } catch (err) {
    logger.error('DB read error:', { error: err.message })
    res.json({ videos: [] })
  }
})

// -----------------------------------------------------------
// PUT /api/videos/:id/favorite — toggle favorite
// -----------------------------------------------------------
app.put('/api/videos/:id/favorite', (req, res) => {
  try {
    const row = db.prepare('SELECT favorite FROM videos WHERE id = ?').get(req.params.id)
    if (!row) return res.status(404).json({ error: 'Video not found' })
    const newVal = row.favorite ? 0 : 1
    db.prepare('UPDATE videos SET favorite = ? WHERE id = ?').run(newVal, req.params.id)
    res.json({ id: req.params.id, favorite: newVal })
  } catch (err) {
    logger.error('Toggle favorite error', { error: err.message })
    res.status(500).json({ error: 'Failed to toggle favorite' })
  }
})

// -----------------------------------------------------------
// PUT /api/videos/:id/rating — set rating (1-5 or null to clear)
// -----------------------------------------------------------
app.put('/api/videos/:id/rating', express.json(), (req, res) => {
  const { rating } = req.body || {}
  if (rating !== null && (rating < 1 || rating > 5)) {
    return res.status(400).json({ error: 'Rating must be 1-5 or null' })
  }
  try {
    const row = db.prepare('SELECT id FROM videos WHERE id = ?').get(req.params.id)
    if (!row) return res.status(404).json({ error: 'Video not found' })
    db.prepare('UPDATE videos SET rating = ? WHERE id = ?').run(rating, req.params.id)
    res.json({ id: req.params.id, rating })
  } catch (err) {
    logger.error('Set rating error', { error: err.message })
    res.status(500).json({ error: 'Failed to set rating' })
  }
})

// -----------------------------------------------------------
// PUT /api/videos/:id/watch-later — toggle watch later
// -----------------------------------------------------------
app.put('/api/videos/:id/watch-later', (req, res) => {
  try {
    const row = db.prepare('SELECT watch_later FROM videos WHERE id = ?').get(req.params.id)
    if (!row) return res.status(404).json({ error: 'Video not found' })
    const newVal = row.watch_later ? 0 : 1
    db.prepare('UPDATE videos SET watch_later = ? WHERE id = ?').run(newVal, req.params.id)
    res.json({ id: req.params.id, watch_later: newVal })
  } catch (err) {
    logger.error('Toggle watch later error', { error: err.message })
    res.status(500).json({ error: 'Failed to toggle watch later' })
  }
})

// -----------------------------------------------------------
// GET /api/videos/favorites — return all favorited videos
// -----------------------------------------------------------
app.get('/api/videos/favorites', (req, res) => {
  try {
    const mode = getMode(req)
    const rows = db.prepare('SELECT * FROM videos WHERE favorite = 1 AND mode = ? ORDER BY added_at DESC').all(mode)
    const videos = rows.map(row => ({ ...row, tags: row.tags ? JSON.parse(row.tags) : [], durationFormatted: formatDuration(row.duration) }))
    res.json({ videos })
  } catch (err) {
    logger.error('Favorites fetch error', { error: err.message })
    res.json({ videos: [] })
  }
})

// -----------------------------------------------------------
// GET /api/videos/watch-later — return watch later list
// -----------------------------------------------------------
app.get('/api/videos/watch-later', (req, res) => {
  try {
    const mode = getMode(req)
    const rows = db.prepare('SELECT * FROM videos WHERE watch_later = 1 AND mode = ? ORDER BY added_at DESC').all(mode)
    const videos = rows.map(row => ({ ...row, tags: row.tags ? JSON.parse(row.tags) : [], durationFormatted: formatDuration(row.duration) }))
    res.json({ videos })
  } catch (err) {
    logger.error('Watch later fetch error', { error: err.message })
    res.json({ videos: [] })
  }
})

// -----------------------------------------------------------
// Cookie Auth (3.4) — import browser cookies for yt-dlp
// -----------------------------------------------------------

const VALID_COOKIE_MODES = new Set(['social', 'nsfw'])

// Helper: get cookie file path for a mode. Returns null for invalid modes.
function _cookiePath(mode) {
  if (!mode) return LEGACY_COOKIE_FILE
  if (VALID_COOKIE_MODES.has(mode)) return MODE_COOKIE_FILES[mode]
  return null // invalid mode
}

function _countCookies(content) {
  return content.split('\n').filter(l => !l.startsWith('#') && l.trim() && l.split('\t').length >= 7).length
}

function _cookieFileStatus(filePath) {
  if (!existsSync(filePath)) return null
  const stat = statSync(filePath)
  const content = readFileSync(filePath, 'utf8')
  return { installed: true, cookies: _countCookies(content), size: stat.size, modified: stat.mtime.toISOString() }
}

// POST /api/cookies — upload cookies.txt content
// Query param: ?mode=social|nsfw (defaults to legacy combined file)
app.post('/api/cookies', express.text({ limit: '5mb' }), (req, res) => {
  const content = req.body
  if (!content || typeof content !== 'string') return res.status(400).json({ error: 'Cookie content required (text/plain)' })

  // Basic validation: Netscape cookie format starts with # or domain lines
  const lines = content.trim().split('\n')
  const hasHeader = lines.some(l => l.startsWith('# Netscape') || l.startsWith('# HTTP Cookie'))
  const hasCookies = lines.some(l => !l.startsWith('#') && l.split('\t').length >= 7)

  if (!hasHeader && !hasCookies) {
    return res.status(400).json({ error: 'Invalid cookie format. Expected Netscape/Mozilla cookie.txt format.' })
  }

  const mode = req.query.mode // social | nsfw | undefined (legacy)
  const filePath = _cookiePath(mode)
  if (!filePath) return res.status(400).json({ error: `Invalid mode: ${mode}. Use "social" or "nsfw".` })

  try {
    writeFileSync(filePath, content, 'utf8')
    const cookieCount = _countCookies(content)
    logger.info('Cookies imported', { mode: mode || 'legacy', cookies: cookieCount })
    res.json({ ok: true, mode: mode || 'legacy', cookies: cookieCount })
  } catch (err) {
    logger.error('Cookie import error', { error: err.message })
    res.status(500).json({ error: 'Failed to save cookies' })
  }
})

// GET /api/cookies/status — check if cookies are installed
// Returns status for all cookie files (social, nsfw, legacy)
app.get('/api/cookies/status', (req, res) => {
  try {
    const social = _cookieFileStatus(MODE_COOKIE_FILES.social)
    const nsfw = _cookieFileStatus(MODE_COOKIE_FILES.nsfw)
    const legacy = _cookieFileStatus(LEGACY_COOKIE_FILE)

    // Backward compat: top-level installed/cookies for clients that expect the old shape
    const anyInstalled = !!(social || nsfw || legacy)
    const totalCookies = (social?.cookies || 0) + (nsfw?.cookies || 0) + (legacy?.cookies || 0)

    res.json({
      installed: anyInstalled,
      cookies: totalCookies,
      modified: social?.modified || nsfw?.modified || legacy?.modified || null,
      social: social || { installed: false },
      nsfw: nsfw || { installed: false },
      legacy: legacy || { installed: false },
    })
  } catch (err) {
    res.json({ installed: false, error: err.message })
  }
})

// DELETE /api/cookies — remove cookies file
// Query param: ?mode=social|nsfw (defaults to legacy)
app.delete('/api/cookies', (req, res) => {
  const mode = req.query.mode
  const filePath = _cookiePath(mode)
  if (!filePath) return res.status(400).json({ error: `Invalid mode: ${mode}. Use "social" or "nsfw".` })

  try {
    if (existsSync(filePath)) unlinkSync(filePath)
    logger.info('Cookies deleted', { mode: mode || 'legacy' })
    res.json({ ok: true })
  } catch (err) {
    logger.error('Cookie delete error', { error: err.message })
    res.status(500).json({ error: 'Failed to delete cookies' })
  }
})

// -----------------------------------------------------------
// Tag Preferences (3.2)
// -----------------------------------------------------------

// GET /api/tags/preferences — list all tag preferences
app.get('/api/tags/preferences', (req, res) => {
  try {
    const prefs = db.prepare('SELECT tag, preference FROM tag_preferences ORDER BY tag').all()
    res.json({ preferences: prefs })
  } catch (err) {
    logger.error('Tag preferences fetch error', { error: err.message })
    res.json({ preferences: [] })
  }
})

// PUT /api/tags/preferences — set preference for a tag (liked/disliked)
app.put('/api/tags/preferences', express.json(), (req, res) => {
  const { tag, preference } = req.body || {}
  if (!tag?.trim()) return res.status(400).json({ error: 'tag required' })
  if (!['liked', 'disliked'].includes(preference)) return res.status(400).json({ error: 'preference must be liked or disliked' })
  try {
    db.prepare('INSERT OR REPLACE INTO tag_preferences (tag, preference, updated_at) VALUES (?, ?, datetime(\'now\'))').run(tag.trim().toLowerCase(), preference)
    res.json({ ok: true })
  } catch (err) {
    logger.error('Tag preference set error', { error: err.message })
    res.status(500).json({ error: 'Failed to set preference' })
  }
})

// DELETE /api/tags/preferences/:tag — remove a tag preference
app.delete('/api/tags/preferences/:tag', (req, res) => {
  try {
    db.prepare('DELETE FROM tag_preferences WHERE tag = ?').run(req.params.tag)
    res.json({ ok: true })
  } catch (err) {
    logger.error('Tag preference delete error', { error: err.message })
    res.status(500).json({ error: 'Failed to delete preference' })
  }
})

// GET /api/tags/popular — list most common tags across all videos
app.get('/api/tags/popular', (req, res) => {
  try {
    const mode = getMode(req)
    const rows = db.prepare('SELECT tags FROM videos WHERE tags IS NOT NULL AND tags != \'[]\' AND mode = ?').all(mode)
    const tagCounts = {}
    for (const row of rows) {
      try {
        const tags = JSON.parse(row.tags)
        for (const tag of tags) {
          const t = tag.toLowerCase().trim()
          if (t) tagCounts[t] = (tagCounts[t] || 0) + 1
        }
      } catch (e) {
        logger.warn('Malformed tags JSON in popular-tags', { tags: row.tags?.slice(0, 100), error: e.message })
      }
    }
    const popular = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .map(([tag, count]) => ({ tag, count }))
    res.json({ tags: popular })
  } catch (err) {
    logger.error('Popular tags error', { error: err.message })
    res.json({ tags: [] })
  }
})

// -----------------------------------------------------------
// Seed Recommendations from History (3.3.1)
// Import watch history/favorites via yt-dlp, extract tags,
// auto-populate tag_preferences for personalization bootstrap.
// Uses SSE for real-time progress reporting.
// -----------------------------------------------------------

// Store PornHub username
app.put('/api/recommendations/username', express.json(), (req, res) => {
  const { platform, username } = req.body || {}
  if (!platform || !username?.trim()) return res.status(400).json({ error: 'platform and username required' })
  try {
    db.prepare("INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)").run(`${platform}_username`, username.trim())
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/recommendations/username', (req, res) => {
  try {
    const rows = db.prepare("SELECT key, value FROM preferences WHERE key LIKE '%_username'").all()
    const usernames = {}
    for (const r of rows) usernames[r.key.replace('_username', '')] = r.value
    res.json({ usernames })
  } catch { res.json({ usernames: {} }) }
})

// SSE endpoint: seed recommendations from platform history
app.get('/api/recommendations/seed', async (req, res) => {
  const platform = req.query.platform || 'pornhub'
  const maxVideos = Math.min(parseInt(req.query.max) || 200, 200)

  // SSE headers
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' })
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`)

  // Check re-seed guard
  try {
    const lastSeed = db.prepare("SELECT value FROM preferences WHERE key = 'recommendation_seed_at'").get()
    if (lastSeed && !req.query.force) {
      const age = Date.now() - new Date(lastSeed.value).getTime()
      if (age < 24 * 60 * 60 * 1000) {
        send({ type: 'error', message: `Already seeded ${Math.round(age / 3600000)}h ago. Add ?force=1 to re-seed.` })
        return res.end()
      }
    }
  } catch { /* preferences table may not have the key */ }

  // Get username (not required for YouTube which uses cookie-based auth)
  let username
  try {
    const row = db.prepare("SELECT value FROM preferences WHERE key = ?").get(`${platform}_username`)
    username = row?.value
  } catch {}

  // Build URLs to scrape based on platform
  const urls = []
  if (platform === 'pornhub') {
    if (!username) { send({ type: 'error', message: 'PornHub username required. Set it in the field above.' }); return res.end() }
    urls.push(
      { label: 'Favorites', url: `https://www.pornhub.com/users/${username}/videos/favorites` },
      { label: 'Watched', url: `https://www.pornhub.com/users/${username}/videos/watched` },
      { label: 'Rated', url: `https://www.pornhub.com/users/${username}/videos/rated` },
    )
  } else if (platform === 'youtube') {
    // YouTube uses cookie auth, no username needed
    urls.push(
      { label: 'Liked Videos', url: 'https://www.youtube.com/playlist?list=LL' },
      { label: 'Watch History', url: 'https://www.youtube.com/feed/history' },
    )
  } else if (platform === 'tiktok') {
    if (!username) { send({ type: 'error', message: 'TikTok username required. Set it in the field above.' }); return res.end() }
    urls.push(
      { label: 'Liked Videos', url: `https://www.tiktok.com/@${username}/liked` },
    )
  }

  send({ type: 'status', message: `Starting ${platform} import for user "${username}"...`, sources: urls.map(u => u.label) })

  // Phase 1: Collect video URLs from all sources via flat-playlist
  const { execFile } = await import('child_process')
  const { promisify } = await import('util')
  const execFileP = promisify(execFile)
  const allVideoUrls = []
  for (const src of urls) {
    send({ type: 'progress', phase: 'scan', source: src.label })
    try {
      const { stdout } = await execFileP('yt-dlp', [
        ...getCookieArgs(src.url), '--flat-playlist', '--dump-json', '--no-warnings',
        '--socket-timeout', '10', src.url
      ], { encoding: 'utf8', timeout: 60000, maxBuffer: 10 * 1024 * 1024, windowsHide: true })

      const entries = stdout.trim().split('\n').filter(Boolean)
      for (const line of entries) {
        try {
          const d = JSON.parse(line)
          const url = d.webpage_url || d.url
          if (url) allVideoUrls.push(url)
        } catch {}
      }
      send({ type: 'status', message: `${src.label}: found ${entries.length} videos` })
    } catch (err) {
      send({ type: 'status', message: `${src.label}: ${err.message?.includes('404') || err.message?.includes('Unable') ? 'not accessible (private or empty)' : 'error: ' + err.message?.substring(0, 60)}` })
    }
  }

  if (allVideoUrls.length === 0) {
    send({ type: 'error', message: 'No videos found across all sources. Check that cookies are valid and username is correct.' })
    return res.end()
  }

  // Cap at maxVideos
  const toProcess = allVideoUrls.slice(0, maxVideos)
  send({ type: 'status', message: `Found ${allVideoUrls.length} videos total. Processing ${toProcess.length} for tag extraction...` })

  // Phase 2: Extract full metadata for each video (tags, categories)
  const tagFreq = {}
  const categoryFreq = {}
  let processed = 0
  let failed = 0
  const importedVideos = []

  for (const url of toProcess) {
    processed++
    if (processed % 5 === 0 || processed === toProcess.length) {
      send({ type: 'progress', phase: 'extract', current: processed, total: toProcess.length })
    }
    try {
      const { stdout } = await execFileP('yt-dlp', [
        ...getCookieArgs(url), '--dump-json', '--skip-download', '--no-playlist', '--no-warnings',
        '--socket-timeout', '10', url
      ], { encoding: 'utf8', timeout: 30000, maxBuffer: 5 * 1024 * 1024, windowsHide: true })

      const meta = JSON.parse(stdout)
      const tags = meta.tags || []
      const categories = meta.categories || []

      for (const t of tags) {
        const key = t.toLowerCase().trim()
        if (key) tagFreq[key] = (tagFreq[key] || 0) + 1
      }
      for (const c of categories) {
        const key = c.toLowerCase().trim()
        if (key) categoryFreq[key] = (categoryFreq[key] || 0) + 1
      }

      // Import video into library
      importedVideos.push({
        url: meta.webpage_url || url,
        title: meta.title,
        thumbnail: meta.thumbnail,
        duration: meta.duration,
        source: meta.webpage_url_domain || platform,
        uploader: meta.uploader,
        view_count: meta.view_count,
        tags: [...tags, ...categories],
      })
    } catch {
      failed++
    }
  }

  send({ type: 'status', message: `Extracted tags from ${processed - failed}/${processed} videos (${failed} failed)` })

  // Phase 3: Auto-insert top tags into tag_preferences
  const existingPrefs = new Set()
  try {
    db.prepare('SELECT tag FROM tag_preferences').all().forEach(r => existingPrefs.add(r.tag))
  } catch {}

  // Tags that appear in 2+ videos (lower threshold since we might have few videos)
  const threshold = Math.max(2, Math.floor(toProcess.length * 0.1))
  const topTags = Object.entries(tagFreq)
    .filter(([, count]) => count >= Math.min(threshold, 2))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .filter(([tag]) => !existingPrefs.has(tag))

  const topCategories = Object.entries(categoryFreq)
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .filter(([tag]) => !existingPrefs.has(tag))

  const allNewTags = [...topTags, ...topCategories]
  let addedTags = 0
  const insertPref = db.prepare("INSERT OR IGNORE INTO tag_preferences (tag, preference, updated_at) VALUES (?, 'liked', datetime('now'))")
  for (const [tag] of allNewTags) {
    try {
      const result = insertPref.run(tag)
      if (result.changes > 0) addedTags++
    } catch {}
  }

  // Phase 4: Import videos into library (videos table)
  let addedVideos = 0
  const insertVideo = db.prepare(`
    INSERT OR IGNORE INTO videos (url, title, thumbnail, duration, source, tags, mode, added_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `)
  for (const v of importedVideos) {
    try {
      const result = insertVideo.run(v.url, v.title, v.thumbnail, v.duration, v.source, JSON.stringify(v.tags), inferMode(v.url || v.source))
      if (result.changes > 0) addedVideos++
    } catch {}
  }

  // Store seed metadata
  try {
    db.prepare("INSERT OR REPLACE INTO preferences (key, value) VALUES ('recommendation_seed_at', datetime('now'))").run()
    db.prepare("INSERT OR REPLACE INTO preferences (key, value) VALUES ('recommendation_seed_count', ?)").run(String(processed - failed))
  } catch {}

  const summary = {
    type: 'complete',
    videosScanned: processed,
    videosFailed: failed,
    videosImported: addedVideos,
    tagsFound: Object.keys(tagFreq).length,
    categoriesFound: Object.keys(categoryFreq).length,
    tagsAdded: addedTags,
    topTags: allNewTags.slice(0, 10).map(([tag, count]) => ({ tag, count })),
  }
  send(summary)
  res.end()
})

// -----------------------------------------------------------
// Basic Recommendations (3.3)
// Rule-based scoring: +2 liked tag, -5 disliked tag, +1 preferred source
// -----------------------------------------------------------

app.get('/api/discover', (req, res) => {
  const { limit = 20 } = req.query
  const mode = getMode(req)
  try {
    // Get tag preferences
    const prefs = db.prepare('SELECT tag, preference FROM tag_preferences').all()
    const liked = new Set(prefs.filter(p => p.preference === 'liked').map(p => p.tag))
    const disliked = new Set(prefs.filter(p => p.preference === 'disliked').map(p => p.tag))

    // Get all unwatched videos (filtered by mode)
    const videos = db.prepare('SELECT * FROM videos WHERE (watch_count = 0 OR watch_count IS NULL) AND mode = ? ORDER BY added_at DESC').all(mode)

    // Score each video
    const scored = videos.map(v => {
      let score = 0
      try {
        const tags = JSON.parse(v.tags || '[]')
        for (const tag of tags) {
          const t = tag.toLowerCase().trim()
          if (liked.has(t)) score += 2
          if (disliked.has(t)) score -= 5
        }
      } catch {}
      // Bonus for favorited
      if (v.favorite) score += 1
      // Bonus for highly rated
      if (v.rating >= 4) score += 1
      return { ...v, score, tags: v.tags ? JSON.parse(v.tags) : [], durationFormatted: formatDuration(v.duration) }
    })

    // Sort by score descending, then by added_at
    scored.sort((a, b) => b.score - a.score)

    res.json({ videos: scored.slice(0, parseInt(limit)) })
  } catch (err) {
    logger.error('Discover error', { error: err.message })
    res.json({ videos: [] })
  }
})

// -----------------------------------------------------------
// Playlist CRUD
// -----------------------------------------------------------

// GET /api/playlists — list all playlists with item counts
app.get('/api/playlists', (req, res) => {
  try {
    const playlists = db.prepare(`
      SELECT p.*, COUNT(pi.id) as item_count
      FROM playlists p LEFT JOIN playlist_items pi ON p.id = pi.playlist_id
      GROUP BY p.id ORDER BY p.updated_at DESC
    `).all()
    res.json({ playlists })
  } catch (err) {
    logger.error('Playlists fetch error', { error: err.message })
    res.json({ playlists: [] })
  }
})

// POST /api/playlists — create playlist
app.post('/api/playlists', express.json(), (req, res) => {
  const { name } = req.body || {}
  if (!name?.trim()) return res.status(400).json({ error: 'name required' })
  try {
    const id = randomBytes(16).toString('hex')
    db.prepare('INSERT INTO playlists (id, name) VALUES (?, ?)').run(id, name.trim())
    res.json({ playlist: { id, name: name.trim(), item_count: 0 } })
  } catch (err) {
    logger.error('Playlist create error', { error: err.message })
    res.status(500).json({ error: 'Failed to create playlist' })
  }
})

// DELETE /api/playlists/:id — delete playlist and its items
app.delete('/api/playlists/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM playlist_items WHERE playlist_id = ?').run(req.params.id)
    db.prepare('DELETE FROM playlists WHERE id = ?').run(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    logger.error('Playlist delete error', { error: err.message })
    res.status(500).json({ error: 'Failed to delete playlist' })
  }
})

// GET /api/playlists/:id/items — get playlist items with video details
app.get('/api/playlists/:id/items', (req, res) => {
  try {
    const items = db.prepare(`
      SELECT pi.id as item_id, pi.position, pi.added_at as item_added_at,
             v.id, v.url, v.title, v.thumbnail, v.duration, v.source, v.favorite, v.rating
      FROM playlist_items pi
      JOIN videos v ON pi.video_id = v.id
      WHERE pi.playlist_id = ?
      ORDER BY pi.position ASC
    `).all(req.params.id)
    const videos = items.map(row => ({ ...row, durationFormatted: formatDuration(row.duration) }))
    res.json({ videos })
  } catch (err) {
    logger.error('Playlist items fetch error', { error: err.message })
    res.json({ videos: [] })
  }
})

// POST /api/playlists/:id/items — add video to playlist
app.post('/api/playlists/:id/items', express.json(), (req, res) => {
  const { video_id } = req.body || {}
  if (!video_id) return res.status(400).json({ error: 'video_id required' })
  try {
    const maxPos = db.prepare('SELECT COALESCE(MAX(position), -1) as p FROM playlist_items WHERE playlist_id = ?').get(req.params.id).p
    const itemId = randomBytes(16).toString('hex')
    db.prepare('INSERT INTO playlist_items (id, playlist_id, video_id, position) VALUES (?, ?, ?, ?)').run(itemId, req.params.id, video_id, maxPos + 1)
    db.prepare('UPDATE playlists SET updated_at = datetime(\'now\') WHERE id = ?').run(req.params.id)
    res.json({ ok: true, item_id: itemId })
  } catch (err) {
    logger.error('Playlist add item error', { error: err.message })
    res.status(500).json({ error: 'Failed to add to playlist' })
  }
})

// DELETE /api/playlists/:id/items/:itemId — remove item from playlist
app.delete('/api/playlists/:id/items/:itemId', (req, res) => {
  try {
    db.prepare('DELETE FROM playlist_items WHERE id = ? AND playlist_id = ?').run(req.params.itemId, req.params.id)
    // Reindex positions
    const items = db.prepare('SELECT id FROM playlist_items WHERE playlist_id = ? ORDER BY position').all(req.params.id)
    const update = db.prepare('UPDATE playlist_items SET position = ? WHERE id = ?')
    items.forEach((item, i) => update.run(i, item.id))
    db.prepare('UPDATE playlists SET updated_at = datetime(\'now\') WHERE id = ?').run(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    logger.error('Playlist remove item error', { error: err.message })
    res.status(500).json({ error: 'Failed to remove from playlist' })
  }
})

// -----------------------------------------------------------
// GET /api/search?q=...&count=12
// SSE stream — emits one JSON video object per event as yt-dlp
// fetches full metadata for each result. Client gets real
// thumbnails/duration immediately without waiting for all results.
// -----------------------------------------------------------
app.get('/api/search', (req, res) => {
  const { q, count = 12, site } = req.query
  if (!q) return res.status(400).json({ error: 'Search query required' })

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })

  const limit = parseInt(count, 10)

  // Use the yt-dlp adapter's streaming search for SSE
  const stream = ytdlpAdapter.streamSearch(q, { site, limit })

  stream.onVideo((video) => {
    res.write(`data: ${JSON.stringify({ ...video, durationFormatted: formatDuration(video.duration) })}\n\n`)
  })

  stream.onDone(() => {
    res.write('data: [done]\n\n')
    res.end()
  })

  stream.onError((err) => {
    logger.error('Search error:', { error: err.message })
    res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`)
    res.end()
  })

  // Kill if client disconnects
  req.on('close', () => stream.kill())
})

// -----------------------------------------------------------
// GET /api/search/multi?q=...&limit=10
// Multi-site search — hits all configured scraper sites in
// parallel and returns combined results. Great for NSFW
// discovery where the same query may yield different results
// on different sites.
// -----------------------------------------------------------
app.get('/api/search/multi', async (req, res) => {
  const { q, limit = 10 } = req.query
  const mode = getMode(req)
  if (!q) return res.status(400).json({ error: 'Search query required' })

  try {
    let videos
    if (mode === 'nsfw') {
      // NSFW: hit all scraper sites in parallel
      videos = await scraperAdapter.searchAll(q, { limit: parseInt(limit, 10) })
    } else {
      // Social: use yt-dlp YouTube search (scraper only has NSFW sites)
      videos = await registry.search(q, { site: 'youtube.com', limit: parseInt(limit, 10) })
    }
    res.json({
      query: q,
      count: videos.length,
      videos: videos.map(v => ({
        ...v,
        durationFormatted: formatDuration(v.duration),
      })),
    })
  } catch (err) {
    logger.error('Multi-site search error:', { error: err.message })
    res.status(500).json({ error: 'Multi-site search failed' })
  }
})

// -----------------------------------------------------------
// GET /api/trending?site=pornhub.com&limit=20
// Returns trending videos from a specific site.
// Supported sites: pornhub.com, xvideos.com, spankbang.com
// -----------------------------------------------------------
app.get('/api/trending', async (req, res) => {
  const { site = 'pornhub.com', limit = 20 } = req.query

  try {
    const videos = await scraperAdapter.fetchTrending({
      site,
      limit: parseInt(limit, 10),
    })
    res.json({
      site,
      count: videos.length,
      videos: videos.map(v => ({
        ...v,
        durationFormatted: formatDuration(v.duration),
      })),
    })
  } catch (err) {
    logger.error('Trending fetch error:', { error: err.message })
    res.status(500).json({ error: `Failed to fetch trending for ${site}` })
  }
})

// -----------------------------------------------------------
// GET /api/categories?site=pornhub.com&url=...&limit=20
// Fetches videos from a specific category page URL.
// -----------------------------------------------------------
app.get('/api/categories', async (req, res) => {
  const { url, limit = 20 } = req.query
  if (!url) return res.status(400).json({ error: 'Category URL required' })

  try {
    const videos = await scraperAdapter.fetchCategory(url, {
      limit: parseInt(limit, 10),
    })
    res.json({
      url,
      count: videos.length,
      videos: videos.map(v => ({
        ...v,
        durationFormatted: formatDuration(v.duration),
      })),
    })
  } catch (err) {
    logger.error('Category fetch error:', { error: err.message })
    res.status(500).json({ error: 'Failed to fetch category' })
  }
})

// -----------------------------------------------------------
// GET /api/sources/health
// Reports status of all registered source adapters.
// Useful for monitoring which adapters are available and
// catching failures before they affect users.
// -----------------------------------------------------------
app.get('/api/sources/health', (req, res) => {
  const stats = registry.getStats()
  const adapters = registry.listAdapters().map(adapter => ({
    name: adapter.name,
    available: typeof adapter.isAvailable === 'function' ? adapter.isAvailable() : true,
    disabled: registry.isDisabled(adapter.name),
    capabilities: adapter.capabilities,
    supportedDomains: adapter.supportedDomains || [],
    version: adapter.version || null,
    stats: stats[adapter.name] || null,
  }))

  const allHealthy = adapters.every(a => a.available && !a.disabled)

  res.json({
    status: allHealthy ? 'healthy' : 'degraded',
    adapters,
  })
})

// -----------------------------------------------------------
// POST /api/sources/:name/reenable
// Manually re-enable a disabled adapter after consecutive failures.
// -----------------------------------------------------------
app.post('/api/sources/:name/reenable', (req, res) => {
  const { name } = req.params
  const success = registry.reenableAdapter(name)
  if (success) {
    res.json({ message: `${name} re-enabled` })
  } else {
    res.status(404).json({ error: `Adapter '${name}' not found` })
  }
})

// -----------------------------------------------------------
// GET /api/sources/list?mode=social|nsfw
// List all feed sources, optionally filtered by mode.
// -----------------------------------------------------------
app.get('/api/sources/list', (req, res) => {
  try {
    const { mode } = req.query
    let sources
    if (mode) {
      sources = db.prepare('SELECT * FROM sources WHERE mode = ? ORDER BY weight DESC').all(mode)
    } else {
      sources = db.prepare('SELECT * FROM sources ORDER BY mode, weight DESC').all()
    }
    res.json({ sources })
  } catch (err) {
    logger.error('List sources error', { error: err.message })
    res.status(500).json({ error: 'Failed to list sources' })
  }
})

// -----------------------------------------------------------
// POST /api/sources
// Add a new feed source. Body: { domain, mode, label, query, weight? }
// Tests the source with yt-dlp before activating.
// -----------------------------------------------------------
app.post('/api/sources', express.json(), async (req, res) => {
  const { domain, mode, label, query, weight = 1.0 } = req.body
  if (!domain || !mode || !label || !query) {
    return res.status(400).json({ error: 'Required: domain, mode, label, query' })
  }
  if (!['social', 'nsfw'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be social or nsfw' })
  }

  // Check if already exists
  const existing = db.prepare('SELECT domain FROM sources WHERE domain = ?').get(domain)
  if (existing) {
    return res.status(409).json({ error: `Source ${domain} already exists` })
  }

  // Test the source with a quick search to verify it works
  try {
    logger.info(`Testing new source: ${domain}`, { query })
    const testResults = await registry.search(query, { site: domain, limit: 3 })
    if (testResults.length === 0) {
      return res.status(422).json({ error: `Source test returned 0 results for "${query}" on ${domain}` })
    }

    // Insert into database
    db.prepare(
      'INSERT INTO sources (domain, mode, label, query, weight, active) VALUES (?, ?, ?, ?, ?, 1)'
    ).run(domain, mode, label, query, weight)

    logger.info(`Added new source: ${label} (${domain})`)
    res.json({
      source: { domain, mode, label, query, weight, active: 1 },
      testResults: testResults.length,
    })
  } catch (err) {
    logger.error('Add source error', { error: err.message, domain })
    res.status(500).json({ error: `Source test failed: ${err.message}` })
  }
})

// -----------------------------------------------------------
// PUT /api/sources/:domain
// Update a source's settings. Body: { label?, query?, weight?, active?, fetch_interval? }
// -----------------------------------------------------------
app.put('/api/sources/:domain', express.json(), (req, res) => {
  const { domain } = req.params
  const existing = db.prepare('SELECT * FROM sources WHERE domain = ?').get(domain)
  if (!existing) {
    return res.status(404).json({ error: `Source ${domain} not found` })
  }

  const { label, query, weight, active, fetch_interval } = req.body
  const updates = []
  const values = []

  if (label !== undefined) { updates.push('label = ?'); values.push(label) }
  if (query !== undefined) { updates.push('query = ?'); values.push(query) }
  if (weight !== undefined) { updates.push('weight = ?'); values.push(weight) }
  if (active !== undefined) { updates.push('active = ?'); values.push(active ? 1 : 0) }
  if (fetch_interval !== undefined) { updates.push('fetch_interval = ?'); values.push(fetch_interval) }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update' })
  }

  values.push(domain)
  db.prepare(`UPDATE sources SET ${updates.join(', ')} WHERE domain = ?`).run(...values)

  const updated = db.prepare('SELECT * FROM sources WHERE domain = ?').get(domain)
  res.json({ source: updated })
})

// -----------------------------------------------------------
// DELETE /api/sources/:domain
// Remove a feed source. Also cleans up its feed_cache entries.
// -----------------------------------------------------------
app.delete('/api/sources/:domain', (req, res) => {
  const { domain } = req.params
  const existing = db.prepare('SELECT * FROM sources WHERE domain = ?').get(domain)
  if (!existing) {
    return res.status(404).json({ error: `Source ${domain} not found` })
  }

  db.prepare('DELETE FROM feed_cache WHERE source_domain = ?').run(domain)
  db.prepare('DELETE FROM sources WHERE domain = ?').run(domain)

  logger.info(`Deleted source: ${existing.label} (${domain})`)
  res.json({ deleted: domain })
})

// -----------------------------------------------------------
// GET /api/homepage?mode=social|nsfw
// Returns cached videos grouped by category.
// Falls back to placeholder data if cache is empty.
// -----------------------------------------------------------
app.get('/api/homepage', (req, res) => {
  const mode = req.query.mode === 'nsfw' ? 'nsfw' : 'social'

  try {
    // Get categories for this mode
    const categories = db.prepare(
      'SELECT key, label, query FROM categories WHERE mode = ? ORDER BY sort_order'
    ).all(mode)

    // Get cached videos for each category
    const result = categories.map(cat => {
      const videos = db.prepare(
        `SELECT id, url, title, thumbnail, duration, source, uploader, view_count, tags, viewed
         FROM homepage_cache
         WHERE category_key = ? AND expires_at > datetime('now')
         ORDER BY fetched_at DESC
         LIMIT 20`
      ).all(cat.key)

      return {
        key: cat.key,
        label: cat.label,
        videos: videos.map(v => ({
          ...v,
          tags: v.tags ? JSON.parse(v.tags) : [],
          durationFormatted: formatDuration(v.duration),
        })),
      }
    })

    // Check if any category needs refill (below 8 videos)
    const needsRefill = result.some(cat => cat.videos.length < 8)

    // Trigger async refill for any sparse categories (fire-and-forget)
    if (needsRefill) {
      for (const cat of result) {
        if (cat.videos.length < 8) {
          refillCategory(cat.key).catch(err =>
            logger.error('Refill error:', { error: err.message })
          )
        }
      }
    }

    res.json({ categories: result, needsRefill })
  } catch (err) {
    logger.error('Homepage error:', { error: err.message })
    res.status(500).json({ error: 'Failed to load homepage' })
  }
})

// -----------------------------------------------------------
// POST /api/homepage/viewed
// Marks a homepage_cache video as viewed. Triggers async refill
// if the category drops below the threshold.
// -----------------------------------------------------------
app.post('/api/homepage/viewed', (req, res) => {
  const { id } = req.query
  if (!id) return res.status(400).json({ error: 'Video ID required' })

  try {
    db.prepare('UPDATE homepage_cache SET viewed = 1 WHERE id = ?').run(id)

    // Check if the category needs refill
    const video = db.prepare('SELECT category_key FROM homepage_cache WHERE id = ?').get(id)
    if (video) {
      const unviewed = db.prepare(
        `SELECT COUNT(*) as n FROM homepage_cache
         WHERE category_key = ? AND viewed = 0 AND expires_at > datetime('now')`
      ).get(video.category_key)

      if (unviewed.n < 8) {
        // Trigger async refill (fire-and-forget)
        refillCategory(video.category_key).catch(err =>
          logger.error('Refill error:', { error: err.message })
        )
      }
    }

    res.json({ ok: true })
  } catch (err) {
    logger.error('Mark viewed error:', { error: err.message })
    res.status(500).json({ error: 'Failed to mark as viewed' })
  }
})

// -----------------------------------------------------------
// Async refill: fetch new videos for a category via yt-dlp
// -----------------------------------------------------------
// NSFW site round-robin for even distribution across sources
const _nsfwSites = ['pornhub.com', 'xvideos.com', 'spankbang.com']
let _nsfwSiteIdx = 0

async function refillCategory(categoryKey) {
  const cat = db.prepare('SELECT query, mode FROM categories WHERE key = ?').get(categoryKey)
  if (!cat) return

  let query = cat.query

  // For yt-dlp search strings (not URLs), append personalization tags
  if (!query.startsWith('http')) {
    try {
      const likedTags = db.prepare(
        "SELECT tag FROM tag_preferences WHERE preference = 'liked' ORDER BY RANDOM() LIMIT 2"
      ).all().map(r => r.tag)
      if (likedTags.length > 0) {
        query = `${query} ${likedTags.join(' ')}`
        logger.info(`  🎯 Personalized query for ${categoryKey}: "${query}" (tags: ${likedTags.join(', ')})`)
      }
    } catch { /* tag_preferences may not exist yet — use base query */ }
  }

  logger.info(`  🔄 Refilling category: ${categoryKey} (query: "${query}")`)

  try {
    // Use yt-dlp for YouTube/search queries. For NSFW site URLs, use the
    // registry fallback chain (scraper → yt-dlp) since yt-dlp can't always
    // extract from NSFW sites directly.
    let videos
    if (cat.mode === 'nsfw' && query.startsWith('http')) {
      // Extract domain from URL for site-specific routing
      try {
        const domain = new URL(query).hostname.replace(/^www\./, '')
        videos = await registry.search(query, { site: domain, limit: 12 })
      } catch {
        videos = await registry.search(query, { adapter: 'yt-dlp', limit: 12 })
      }
    } else {
      videos = await registry.search(query, { adapter: 'yt-dlp', limit: 12 })
    }

    const insert = db.prepare(`
      INSERT OR IGNORE INTO homepage_cache (id, category_key, url, title, thumbnail, duration, source, uploader, view_count, tags, fetched_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now', '+24 hours'))
    `)

    let added = 0
    for (const v of videos) {
      try {
        insert.run(v.id, categoryKey, v.url, v.title, v.thumbnail, v.duration, v.source, v.uploader, v.view_count, JSON.stringify(v.tags || []))
        added++
      } catch { /* skip duplicates */ }
    }

    logger.info(`  ✅ Added ${added} videos to ${categoryKey}`)
  } catch (err) {
    logger.error(`  ❌ Refill failed for ${categoryKey}:`, { error: err.message })
  }
}

// -----------------------------------------------------------
// GET /api/feed/next?mode=social|nsfw&count=10
// Return next unwatched videos from feed cache, weighted by
// source preferences. Triggers async refill if cache is low.
// -----------------------------------------------------------
app.get('/api/feed/next', (req, res) => {
  const mode = req.query.mode === 'nsfw' ? 'nsfw' : 'social'
  const count = Math.min(parseInt(req.query.count, 10) || 10, 30)

  // Optional filters
  const sourcesParam = req.query.sources // comma-separated domains
  const tagsParam = req.query.tags // comma-separated tags

  try {
    // Build dynamic WHERE clause based on filters
    let whereExtra = ''
    const params = [mode]

    if (sourcesParam) {
      const domains = sourcesParam.split(',').map(s => s.trim()).filter(Boolean)
      if (domains.length > 0) {
        whereExtra += ` AND fc.source_domain IN (${domains.map(() => '?').join(',')})`
        params.push(...domains)
      }
    }

    params.push(count)

    // Get unwatched videos from cache, ordered by source weight
    // Include stream_url so client doesn't need a second API call
    const videos = db.prepare(`
      SELECT fc.id, fc.url, fc.stream_url AS streamUrl, fc.title, fc.creator AS uploader, fc.thumbnail,
             fc.duration, fc.orientation, fc.source_domain AS source, fc.tags
      FROM feed_cache fc
      LEFT JOIN sources s ON fc.source_domain = s.domain
      WHERE fc.mode = ? AND fc.watched = 0${whereExtra}
      ORDER BY COALESCE(s.weight, 1.0) DESC, RANDOM()
      LIMIT ?
    `).all(...params)

    // Apply tag filter (tags stored as JSON array in feed_cache)
    // Also matches against title as fallback for videos without tags
    let filtered = videos
    if (tagsParam) {
      const filterTags = tagsParam.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
      if (filterTags.length > 0) {
        filtered = videos.filter(v => {
          try {
            const videoTags = JSON.parse(v.tags || '[]').map(t => t.toLowerCase())
            const titleLower = (v.title || '').toLowerCase()
            return filterTags.some(ft => videoTags.includes(ft) || titleLower.includes(ft))
          } catch (e) {
            logger.warn('Malformed tags JSON in feed filter', { url: v.url, tags: v.tags?.slice(0, 100), error: e.message })
            return false
          }
        })
      }
    }

    // Format for client (hls.js handles HLS URLs on non-Safari browsers)
    const formatted = filtered.map(v => ({
      ...v,
      tags: undefined, // Don't send raw tags JSON to client
      durationFormatted: formatDuration(v.duration),
    }))

    // Check if we need more content
    const unviewedCount = db.prepare(
      `SELECT COUNT(*) as n FROM feed_cache
       WHERE mode = ? AND watched = 0`
    ).get(mode)

    if (unviewedCount.n < 20) {
      refillFeedCache(mode).catch(err =>
        logger.error('Feed refill error:', { error: err.message })
      )
    }

    res.json({ videos: formatted })
  } catch (err) {
    logger.error('Feed next error:', { error: err.message })
    res.status(500).json({ error: 'Failed to load feed', videos: [] })
  }
})

// -----------------------------------------------------------
// POST /api/feed/watched?id=...
// Mark a feed video as watched
// -----------------------------------------------------------
app.post('/api/feed/watched', (req, res) => {
  const { id } = req.query
  if (!id) return res.status(400).json({ error: 'Video ID required' })

  try {
    db.prepare('UPDATE feed_cache SET watched = 1 WHERE id = ?').run(id)
    res.json({ ok: true })
  } catch (err) {
    logger.error('Feed watched error:', { error: err.message })
    res.status(500).json({ error: 'Failed to mark watched' })
  }
})

// -----------------------------------------------------------
// POST /api/feed/source-feedback
// Adjust source weight: { domain, action: 'boost' | 'hide' }
// -----------------------------------------------------------
app.post('/api/feed/source-feedback', (req, res) => {
  const { domain, action } = req.body || {}
  if (!domain || !action) return res.status(400).json({ error: 'domain and action required' })

  try {
    if (action === 'hide') {
      db.prepare('UPDATE sources SET active = 0 WHERE domain = ?').run(domain)
    } else if (action === 'boost') {
      db.prepare('UPDATE sources SET weight = MIN(weight + 0.3, 3.0) WHERE domain = ?').run(domain)
    }
    res.json({ ok: true })
  } catch (err) {
    logger.error('Source feedback error:', { error: err.message })
    res.status(500).json({ error: 'Failed to update source' })
  }
})

// -----------------------------------------------------------
// Queue CRUD (3.1 Queue Sync)
// All mutations return the full updated queue so clients stay in sync.
// -----------------------------------------------------------

function getFullQueue() {
  return db.prepare('SELECT id, position, video_url, title, thumbnail, duration, duration_formatted, added_at FROM queue ORDER BY position ASC').all()
}

function reindexQueue() {
  const items = db.prepare('SELECT id FROM queue ORDER BY position ASC').all()
  const update = db.prepare('UPDATE queue SET position = ? WHERE id = ?')
  items.forEach((item, i) => update.run(i, item.id))
}

// GET /api/queue — return ordered queue
app.get('/api/queue', (req, res) => {
  try {
    res.json({ queue: getFullQueue() })
  } catch (err) {
    logger.error('Queue fetch error', { error: err.message })
    res.status(500).json({ error: 'Failed to fetch queue' })
  }
})

// POST /api/queue — add video to end (or at a specific position)
app.post('/api/queue', express.json(), (req, res) => {
  const { video_url, title, thumbnail, duration, duration_formatted, position } = req.body || {}
  if (!video_url) return res.status(400).json({ error: 'video_url required' })

  try {
    const maxPos = db.prepare('SELECT COALESCE(MAX(position), -1) as maxPos FROM queue').get().maxPos
    const insertPos = position !== undefined ? position : maxPos + 1

    // If inserting at a specific position, shift items down
    if (position !== undefined) {
      db.prepare('UPDATE queue SET position = position + 1 WHERE position >= ?').run(insertPos)
    }

    db.prepare(
      'INSERT INTO queue (id, position, video_url, title, thumbnail, duration, duration_formatted) VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?)'
    ).run(insertPos, video_url, title || '', thumbnail || '', duration || 0, duration_formatted || '0:00')

    res.json({ queue: getFullQueue() })
  } catch (err) {
    logger.error('Queue add error', { error: err.message })
    res.status(500).json({ error: 'Failed to add to queue' })
  }
})

// PUT /api/queue — full reorder from ordered array of IDs
app.put('/api/queue', express.json(), (req, res) => {
  const { order } = req.body || {}
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order array required' })

  try {
    const update = db.prepare('UPDATE queue SET position = ? WHERE id = ?')
    order.forEach((id, i) => update.run(i, id))
    res.json({ queue: getFullQueue() })
  } catch (err) {
    logger.error('Queue reorder error', { error: err.message })
    res.status(500).json({ error: 'Failed to reorder queue' })
  }
})

// DELETE /api/queue/:id — remove single item, reindex
app.delete('/api/queue/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM queue WHERE id = ?').run(req.params.id)
    reindexQueue()
    res.json({ queue: getFullQueue() })
  } catch (err) {
    logger.error('Queue remove error', { error: err.message })
    res.status(500).json({ error: 'Failed to remove from queue' })
  }
})

// DELETE /api/queue — clear all
app.delete('/api/queue', (req, res) => {
  try {
    db.prepare('DELETE FROM queue').run()
    res.json({ queue: [] })
  } catch (err) {
    logger.error('Queue clear error', { error: err.message })
    res.status(500).json({ error: 'Failed to clear queue' })
  }
})

// -----------------------------------------------------------
// Async refill: fetch new videos for the feed cache
// -----------------------------------------------------------
const feedRefillInFlight = new Set()
async function refillFeedCache(mode) {
  if (feedRefillInFlight.has(mode)) return
  feedRefillInFlight.add(mode)
  try { await _refillFeedCacheImpl(mode) } finally { feedRefillInFlight.delete(mode) }
}
async function _refillFeedCacheImpl(mode) {
  const sources = db.prepare(
    'SELECT domain, label, query, fetch_interval FROM sources WHERE mode = ? AND active = 1'
  ).all(mode)

  if (sources.length === 0) return

  // Get liked tags for personalization
  let likedTags = []
  try {
    likedTags = db.prepare(
      "SELECT tag FROM tag_preferences WHERE preference = 'liked'"
    ).all().map(r => r.tag)
  } catch { /* tag_preferences may not exist yet */ }

  for (const src of sources) {
    logger.info(`  🔄 Refilling feed: ${src.label} (${mode})`)

    try {
      // Personalize query by mixing in random liked tags
      let query = src.query
      if (likedTags.length > 0) {
        const picked = likedTags.sort(() => Math.random() - 0.5).slice(0, 2)
        query = `${src.query} ${picked.join(' ')}`
        logger.info(`  🎯 Personalized feed query: "${query}"`)
      }
      // Use registry search with fallback chain (scraper → yt-dlp)
      const videos = await registry.search(query, { site: src.domain, limit: 20 })

      const insert = db.prepare(`
        INSERT OR IGNORE INTO feed_cache (id, source_domain, mode, url, title, creator, thumbnail, duration, orientation, tags, fetched_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now', '+6 hours'))
      `)

      let added = 0
      const newVideoUrls = []
      for (const v of videos) {
        try {
          const tags = Array.isArray(v.tags) ? JSON.stringify(v.tags) : (v.tags || '[]')
          const result = insert.run(
            v.id,
            src.domain,
            mode,
            v.url,
            v.title,
            v.uploader,
            v.thumbnail,
            v.duration,
            v.orientation,
            tags
          )
          added++
          if (result.changes > 0 && v.url) {
            newVideoUrls.push(v.url)
          }
        } catch { /* skip duplicates */ }
      }
      // Update last_fetched timestamp
      db.prepare('UPDATE sources SET last_fetched = datetime(\'now\') WHERE domain = ?').run(src.domain)
      logger.info(`  ✅ Added ${added} feed videos from ${src.label}`)

      // Pre-resolve stream URLs for newly added videos (2.8 Tier 1)
      if (newVideoUrls.length > 0) {
        logger.info(`  🔗 Pre-resolving stream URLs for ${newVideoUrls.length} new videos...`)
        await _preResolveStreamUrls(newVideoUrls)
      }
    } catch (err) {
      logger.error(`  ❌ Feed refill failed for ${src.label}:`, { error: err.message })
    }
  }
}

// -----------------------------------------------------------
// Pre-resolve stream URLs for a batch of video page URLs.
// Runs yt-dlp -g concurrently (max 3 at a time) and stores
// results in feed_cache.stream_url so /api/feed/next returns
// ready-to-play URLs without a per-video /api/stream-url call.
// -----------------------------------------------------------
const STREAM_RESOLVE_CONCURRENCY = 3
async function _preResolveStreamUrls(videoUrls) {
  const updateStmt = db.prepare(
    `UPDATE feed_cache SET stream_url = ?, expires_at = datetime('now', '+2 hours') WHERE url = ?`
  )

  let resolved = 0, failed = 0

  // Process in batches of STREAM_RESOLVE_CONCURRENCY
  for (let i = 0; i < videoUrls.length; i += STREAM_RESOLVE_CONCURRENCY) {
    const batch = videoUrls.slice(i, i + STREAM_RESOLVE_CONCURRENCY)
    const results = await Promise.allSettled(
      batch.map(async (url) => {
        // Use registry with fallback chain (yt-dlp → cobalt)
        const cdnUrl = await registry.getStreamUrl(url)
        updateStmt.run(cdnUrl, url)
        return cdnUrl
      })
    )

    for (const r of results) {
      if (r.status === 'fulfilled') resolved++
      else failed++
    }
  }

  logger.info(`  🔗 Stream URLs resolved: ${resolved} OK, ${failed} failed`)
}

// -----------------------------------------------------------
// Scheduled feed refill: check all sources and refill any
// whose last_fetched is older than their fetch_interval
// -----------------------------------------------------------
function startScheduledFeedRefill() {
  const CHECK_INTERVAL = 60_000 // Check every 60 seconds

  return setInterval(() => {
    try {
      const stale = db.prepare(`
        SELECT domain, mode, label FROM sources
        WHERE active = 1
          AND (last_fetched IS NULL
               OR datetime(last_fetched, '+' || fetch_interval || ' seconds') < datetime('now'))
      `).all()

      for (const src of stale) {
        refillFeedCache(src.mode).catch(err =>
          logger.error(`Scheduled refill error (${src.label}):`, { error: err.message })
        )
      }
    } catch (err) {
      logger.error('Scheduled refill check error:', { error: err.message })
    }
  }, CHECK_INTERVAL)
}

// -----------------------------------------------------------
// Scheduled trending/category refresh: periodically fetch
// trending content from all NSFW sites and populate homepage
// cache. Rotates through sites to spread load.
// -----------------------------------------------------------
function startScheduledTrendingRefresh() {
  const TRENDING_INTERVAL = 30 * 60_000 // Every 30 minutes
  const sites = scraperAdapter.supportedDomains

  let siteIndex = 0

  // SFW category round-robin: refill one SFW category per tick
  const sfwCategories = db.prepare("SELECT key FROM categories WHERE mode = 'social'").all()
  let sfwCatIndex = 0

  return setInterval(async () => {
    // --- NSFW: rotate through scraper sites for trending ---
    const site = sites[siteIndex % sites.length]
    siteIndex++

    logger.info(`  📡 Scheduled trending refresh: ${site}`)

    try {
      const videos = await scraperAdapter.fetchTrending({ site, limit: 20 })

      const insert = db.prepare(`
        INSERT OR IGNORE INTO homepage_cache (id, category_key, url, title, thumbnail, duration, source, uploader, view_count, tags, fetched_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now', '+24 hours'))
      `)

      let added = 0
      for (const v of videos) {
        try {
          insert.run(v.id, 'nsfw-trending', v.url, v.title, v.thumbnail, v.duration, v.source || site, v.uploader, v.view_count, JSON.stringify(v.tags || []))
          added++
        } catch { /* skip duplicates */ }
      }

      logger.info(`  ✅ Trending refresh: added ${added} videos from ${site}`)
    } catch (err) {
      logger.error(`  ❌ Trending refresh failed for ${site}:`, { error: err.message })
    }

    // --- SFW: refill one category per tick via yt-dlp ---
    if (sfwCategories.length > 0) {
      const sfwCat = sfwCategories[sfwCatIndex % sfwCategories.length]
      sfwCatIndex++
      refillCategory(sfwCat.key).catch(err =>
        logger.error(`  ❌ SFW refresh error (${sfwCat.key}):`, { error: err.message })
      )
    }
  }, TRENDING_INTERVAL)
}

// -----------------------------------------------------------
// Proactive stream URL TTL monitoring: re-resolve stream URLs
// that are about to expire (within 15 minutes) so users never
// hit stale URLs during playback.
// -----------------------------------------------------------
function startStreamUrlTTLMonitor() {
  const TTL_CHECK_INTERVAL = 5 * 60_000 // Check every 5 minutes

  return setInterval(async () => {
    try {
      // First pass: clear already-expired URLs (they'll be resolved on demand)
      const cleared = db.prepare(`
        UPDATE feed_cache SET stream_url = NULL, expires_at = NULL
        WHERE stream_url IS NOT NULL
          AND expires_at IS NOT NULL
          AND expires_at < datetime('now')
      `).run()
      if (cleared.changes > 0) {
        logger.info(`  🧹 TTL monitor: cleared ${cleared.changes} expired stream URLs`)
      }

      // Second pass: pre-resolve URLs expiring in the next 15 minutes
      const expiring = db.prepare(`
        SELECT url FROM feed_cache
        WHERE stream_url IS NOT NULL
          AND expires_at IS NOT NULL
          AND expires_at <= datetime('now', '+15 minutes')
          AND expires_at > datetime('now')
        LIMIT 10
      `).all()

      if (expiring.length === 0) return

      logger.info(`  🔄 TTL monitor: ${expiring.length} stream URLs expiring soon, re-resolving...`)
      await _preResolveStreamUrls(expiring.map(v => v.url))
    } catch (err) {
      logger.error('TTL monitor error:', { error: err.message })
    }
  }, TTL_CHECK_INTERVAL)
}

// -----------------------------------------------------------
// Helper: seconds → "3:45"
// -----------------------------------------------------------
function formatDuration(seconds) {
  if (!seconds) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = String(Math.floor(seconds % 60)).padStart(2, '0')
  return `${m}:${s}`
}

// -----------------------------------------------------------
// Process-level crash handlers — log reason before dying
// -----------------------------------------------------------
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack })
  process.exit(1)
})
process.on('unhandledRejection', (reason) => {
  // Log but don't crash — transient network errors in background tasks
  // (feed refill, category refresh) shouldn't take down the server
  logger.warn('Unhandled rejection', { reason: String(reason) })
})
const _intervalIds = []
process.on('SIGTERM', async () => {
  logger.info('Shutting down...')
  for (const id of _intervalIds) clearInterval(id)
  await closeAllSources()
  db.close()
  process.exit(0)
})

// -----------------------------------------------------------
// TikTok Import API
// -----------------------------------------------------------

// Status of TikTok imports (pending/done/failed counts)
app.get('/api/tiktok/status', (req, res) => {
  try {
    const counts = db.prepare(`
      SELECT status, COUNT(*) as count FROM tiktok_imports GROUP BY status
    `).all()
    const byMode = db.prepare(`
      SELECT mode, status, COUNT(*) as count FROM tiktok_imports GROUP BY mode, status
    `).all()
    const watchHistory = db.prepare(`
      SELECT mode, COUNT(*) as count FROM tiktok_watch_history GROUP BY mode
    `).all()

    const summary = { pending: 0, done: 0, failed: 0 }
    for (const row of counts) summary[row.status] = row.count

    res.json({ summary, byMode, watchHistory })
  } catch (err) {
    // Tables may not exist yet
    res.json({ summary: { pending: 0, done: 0, failed: 0 }, byMode: [], watchHistory: [] })
  }
})

// Recent imports (processed videos)
app.get('/api/tiktok/recent', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200)
    const mode = req.query.mode
    const whereMode = mode ? 'AND ti.mode = ?' : ''
    const params = mode ? ['done', limit, mode] : ['done', limit]

    // Reorder params for the query
    const rows = db.prepare(`
      SELECT ti.url, ti.source, ti.tiktok_date, ti.mode, ti.processed_at,
             v.title, v.thumbnail, v.duration, v.tags
      FROM tiktok_imports ti
      LEFT JOIN videos v ON v.url = ti.url
      WHERE ti.status = ? ${whereMode}
      ORDER BY ti.processed_at DESC
      LIMIT ?
    `).all(...(mode ? ['done', mode, limit] : ['done', limit]))

    res.json(rows)
  } catch (err) {
    res.json([])
  }
})

// Failed imports
app.get('/api/tiktok/failed', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200)
    const rows = db.prepare(`
      SELECT url, source, mode, error, processed_at
      FROM tiktok_imports WHERE status = 'failed'
      ORDER BY processed_at DESC LIMIT ?
    `).all(limit)
    res.json(rows)
  } catch (err) {
    res.json([])
  }
})

// Watch history
app.get('/api/tiktok/watch-history', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500)
    const mode = req.query.mode
    const rows = mode
      ? db.prepare('SELECT * FROM tiktok_watch_history WHERE mode = ? ORDER BY watched_at DESC LIMIT ?').all(mode, limit)
      : db.prepare('SELECT * FROM tiktok_watch_history ORDER BY watched_at DESC LIMIT ?').all(limit)
    res.json(rows)
  } catch (err) {
    res.json([])
  }
})

// SPA catch-all: serve index.html for non-API routes (client-side routing)
if (existsSync(distPath)) {
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(join(distPath, 'index.html'))
    }
  })
}

// -----------------------------------------------------------
// Start server
// -----------------------------------------------------------
initDatabase()

app.listen(PORT, '0.0.0.0', () => {
  logger.info(`\n  📡 Server running at http://localhost:${PORT}`)

  // Print local network URL for mobile testing
  try {
    const nets = networkInterfaces()
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          logger.info(`     Network: http://${net.address}:${PORT}`)
        }
      }
    }
  } catch {}

  logger.info(`     Health check: http://localhost:${PORT}/api/health\n`)

  // Flush stale stream URLs from previous session — metadata stays intact
  try {
    const flushedFeed = db.prepare("UPDATE feed_cache SET stream_url = NULL, expires_at = NULL WHERE stream_url IS NOT NULL").run()
    if (flushedFeed.changes) {
      logger.info(`  🧹 Flushed ${flushedFeed.changes} stale stream URLs from feed_cache`)
    }
  } catch (err) {
    logger.warn('Stream URL flush failed:', { error: err.message })
  }

  _intervalIds.push(startScheduledFeedRefill())
  _intervalIds.push(startScheduledTrendingRefresh())
  _intervalIds.push(startStreamUrlTTLMonitor())

  // First-boot population: if homepage_cache is empty, sequentially refill all categories
  const cacheCount = db.prepare('SELECT COUNT(*) as n FROM homepage_cache').get()
  if (cacheCount.n === 0) {
    logger.info('  🚀 First boot: populating homepage cache...')
    const allCats = db.prepare('SELECT key FROM categories').all()
    ;(async () => {
      for (const cat of allCats) {
        try {
          await refillCategory(cat.key)
        } catch (err) {
          logger.error(`  First boot refill error (${cat.key}):`, { error: err.message })
        }
      }
      logger.info('  ✅ First boot: homepage cache population complete')
    })()
  }
})
