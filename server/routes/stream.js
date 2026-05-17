import { Router } from 'express'
import { Readable } from 'stream'
import { db } from '../database.js'
import { getCookieArgs } from '../cookies.js'
import { registry, ytdlp as ytdlpAdapter } from '../sources/index.js'
import { logger } from '../logger.js'
import { boundary } from '../boundary/index.js'
import { isAllowedCdnUrl, inferMode, safeParse, getRefererForUrl } from '../utils.js'

// Map a boundary outcome from `boundary.exec` to the HTTP status this
// route should return. Explicit branching replaces the prior message-
// substring catch block — see M7 (reliability snitch wrapper) for the
// rationale.
function statusForOutcome(outcome) {
  switch (outcome) {
    case 'rate_limited':  return 429
    case 'timeout':       return 504
    case 'blocked':       return 403
    case 'auth_failed':   return 502
    case 'wrong_shape':   return 502
    case 'empty':         return 502
    default:              return 500 // unknown_error and anything new
  }
}

const router = Router()

// True if `url` is marked dead in ANY of the three URL-bearing cache tables.
// A URL is dead when the pre-resolve pipeline saw yt-dlp return a permanent
// failure (404 / 410 / removed). Once dead, the stream-url route refuses
// to re-attempt resolution. Statements are lazily prepared because the
// `dead` column was added by a migration — a fresh dev DB doesn't have it
// until initDatabase() runs, and importing this module happens earlier.
let _deadFeedStmt, _deadHpStmt, _deadPersistentStmt
function _isUrlDead(url) {
  if (!_deadFeedStmt) {
    _deadFeedStmt = db.prepare(`SELECT 1 FROM feed_cache WHERE url = ? AND dead = 1 LIMIT 1`)
  }
  if (!_deadHpStmt) {
    _deadHpStmt = db.prepare(`SELECT 1 FROM homepage_cache WHERE url = ? AND dead = 1 LIMIT 1`)
  }
  if (!_deadPersistentStmt) {
    _deadPersistentStmt = db.prepare(`SELECT 1 FROM persistent_row_items WHERE video_url = ? AND dead = 1 LIMIT 1`)
  }
  return !!(_deadFeedStmt.get(url) || _deadHpStmt.get(url) || _deadPersistentStmt.get(url))
}

// -----------------------------------------------------------
// Liveness check — process is alive
// -----------------------------------------------------------
router.get('/api/health', async (req, res) => {
  const ytdlpAvailable = ytdlpAdapter.isAvailable()

  res.json({
    status: 'ok',
    ytdlp: ytdlpAvailable ? (ytdlpAdapter.version || 'available') : 'not found',
    adapters: registry.adapters.map(a => a.name),
    database: db ? 'connected' : 'disconnected',
  })
})

// -----------------------------------------------------------
// Readiness check — server can serve content
//
// 200 = ready: warm-cache has completed AND homepage_cache has
//       at least one fresh-unviewed row (i.e. /api/homepage will
//       return content, not state:'warming').
// 503 = not ready: still cold-starting. Deployment platforms
//       (systemd, Beelink ship) should wait before routing traffic.
// -----------------------------------------------------------
let _readyStmt
router.get('/api/health/ready', async (_req, res) => {
  if (!_readyStmt) {
    _readyStmt = db.prepare(
      `SELECT COUNT(*) AS n FROM homepage_cache
       WHERE viewed = 0 AND expires_at > datetime('now')`
    )
  }
  const cacheCount = _readyStmt.get().n
  const { isFirstWarmComplete } = await import('../index.js')
  const warmComplete = isFirstWarmComplete()
  const ready = warmComplete && cacheCount > 0
  res.status(ready ? 200 : 503).json({ ready, warmComplete, cacheCount })
})

// -----------------------------------------------------------
// GET /api/metadata?url=...
// Extract video metadata using yt-dlp
// -----------------------------------------------------------
router.get('/api/metadata', async (req, res) => {
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
router.get('/api/stream-url', async (req, res) => {
  const { url, format } = req.query
  if (!url) return res.status(400).json({ error: 'URL required' })

  // Dead-URL short-circuit (2026-05-16 fix). If any of the three cache
  // tables has marked this URL dead (yt-dlp returned a permanent-failure
  // error in a prior pass), refuse to re-attempt resolution. The hero
  // autoplay treats a 404 here as "skip this candidate", which is the
  // same behavior as if yt-dlp had failed — but it's free instead of
  // burning a yt-dlp process and re-flooding the boundary tally.
  // Defense-in-depth: dead wins even when format= is set (no force-
  // refresh on dead URLs) and even when another table has a fresh-
  // looking stream_url (that CDN URL is almost certainly already 403ing).
  try {
    const deadInAny = _isUrlDead(url)
    if (deadInAny) {
      return res.status(404).json({ error: 'Video unavailable or taken down' })
    }
  } catch { /* missing dead column on legacy DBs → fall through */ }

  // Check feed_cache, homepage_cache, and persistent_row_items for a cached,
  // non-expired stream URL (skip cache if specific format requested). Each
  // surface has its own table: feed items live in feed_cache, homepage cards
  // in homepage_cache, pinned static rows (ph_likes, ph_subs, ph_model_*) in
  // persistent_row_items. Read all three; prefer feed_cache when fresh, then
  // fall through to the freshest of the rest.
  if (!format) {
    try {
      const feedRow = db.prepare(
        `SELECT stream_url, expires_at FROM feed_cache
         WHERE url = ? AND stream_url IS NOT NULL`
      ).get(url)
      const homepageRow = (() => {
        try {
          return db.prepare(
            `SELECT stream_url, stream_url_expires_at AS expires_at FROM homepage_cache
             WHERE url = ? AND stream_url IS NOT NULL
             ORDER BY stream_url_expires_at DESC
             LIMIT 1`
          ).get(url)
        } catch { return null }
      })()
      const persistentRow = (() => {
        try {
          return db.prepare(
            `SELECT stream_url, stream_url_expires_at AS expires_at FROM persistent_row_items
             WHERE video_url = ? AND stream_url IS NOT NULL
             ORDER BY stream_url_expires_at DESC
             LIMIT 1`
          ).get(url)
        } catch { return null }
      })()

      // A null expires_at means we have a stream_url but no record of when
      // it was minted — could be from an older schema, a partial migration,
      // or a future code path that forgets to set it. Treat as unknown,
      // not as "fresh forever". The re-resolve path below will overwrite
      // it with a proper expiry on the next request.
      const isFresh = (row) => {
        if (!row?.stream_url) return false
        if (!row.expires_at) return false
        return new Date(row.expires_at + 'Z') > new Date()
      }

      if (isFresh(feedRow)) {
        return res.json({ streamUrl: feedRow.stream_url })
      }
      if (isFresh(homepageRow)) {
        return res.json({ streamUrl: homepageRow.stream_url })
      }
      if (isFresh(persistentRow)) {
        return res.json({ streamUrl: persistentRow.stream_url })
      }
      if (feedRow?.stream_url || homepageRow?.stream_url || persistentRow?.stream_url) {
        // Expired — fall through to re-resolve
        logger.info('Stream URL expired, re-resolving', { url: url.substring(0, 60) })
      }
    } catch { /* fall through to yt-dlp */ }
  }

  try {
    // Use registry with fallback chain (yt-dlp → cobalt)
    const cdnUrl = await registry.getStreamUrl(url, format ? { format } : undefined)

    logger.info('Resolved stream URL', { format: cdnUrl.includes('.m3u8') ? 'HLS' : 'MP4', url: cdnUrl.substring(0, 80) })

    // Cache the resolved stream URL in all three tables (expires in 2 hours).
    // Each UPDATE is a no-op when the URL doesn't exist in that table;
    // homepage_cache and persistent_row_items may have multiple rows for the
    // same URL across categories / pinned rows, so all matching rows get
    // refreshed.
    try {
      db.prepare(
        `UPDATE feed_cache SET stream_url = ?, expires_at = datetime('now', '+2 hours') WHERE url = ?`
      ).run(cdnUrl, url)
    } catch { /* cache miss is fine */ }
    try {
      db.prepare(
        `UPDATE homepage_cache SET stream_url = ?, stream_url_expires_at = datetime('now', '+2 hours') WHERE url = ?`
      ).run(cdnUrl, url)
    } catch { /* column may not exist on older DBs; ignore */ }
    try {
      db.prepare(
        `UPDATE persistent_row_items SET stream_url = ?, stream_url_expires_at = datetime('now', '+2 hours') WHERE video_url = ?`
      ).run(cdnUrl, url)
    } catch { /* column may not exist on older DBs; ignore */ }

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
router.get('/api/stream-formats', async (req, res) => {
  const { url } = req.query
  if (!url) return res.status(400).json({ error: 'URL required' })

  const { outcome, value: stdout } = await boundary.exec(
    'yt-dlp',
    [...getCookieArgs(url), '-j', '--no-warnings', '--no-playlist', url],
    { name: 'yt-dlp-stream-formats', timeoutMs: 30000 }
  )

  if (outcome !== 'ok') {
    logger.error('Stream formats error', { outcome, url: String(url).slice(0, 80) })
    return res.status(statusForOutcome(outcome)).json({ error: 'Could not list formats', outcome })
  }

  const info = safeParse(stdout)
  if (!info) return res.status(502).json({ error: 'yt-dlp returned invalid JSON' })
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
})

// -----------------------------------------------------------
// GET /api/proxy-stream?url=...
// Proxies the video bytes from the CDN, adding the required
// Referer header. Supports Range requests for seeking.
// -----------------------------------------------------------
router.get('/api/proxy-stream', async (req, res) => {
  const { url } = req.query
  if (!url) return res.status(400).send('URL required')
  if (!isAllowedCdnUrl(url)) return res.status(403).send('Domain not allowed')

  const referer = getRefererForUrl(url)

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
    'Referer': referer,
    'Origin': referer.replace(/\/$/, ''),
  }

  // Pass through Range header for seeking support
  if (req.headers.range) {
    headers['Range'] = req.headers.range
  }

  // PLAYBACK: 15s timeout applies to GETTING HEADERS only. Once headers
  // arrive, clear the timer — the body stream can take much longer than 15s
  // because the browser buffers ~30-50s ahead, then pauses (backpressure).
  // AbortSignal.timeout() is wallclock and would terminate the upstream
  // socket mid-playback, causing video to stop after the buffer drains
  // (the user-reported "stops around 50s" symptom).
  //
  // Routed through boundary.streamingFetch (M7.6). The streaming variant
  // classifies on HTTP status only and returns the live Response so the
  // body can pipe through without being buffered or UTF-8 decoded.
  const controller = new AbortController()
  const headersTimeout = setTimeout(() => controller.abort(), 15000)
  let result
  try {
    result = await boundary.streamingFetch(url, {
      name: 'proxy-stream',
      headers,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(headersTimeout)
  }

  const { outcome, response: upstream } = result
  if (outcome !== 'ok') {
    logger.error('Proxy stream error', { outcome, status: result.status })
    if (!res.headersSent) res.status(statusForOutcome(outcome)).send('Stream proxy failed')
    return
  }

  // Forward status and key headers
  res.status(upstream.status)
  const fwd = ['content-type', 'content-length', 'content-range', 'accept-ranges']
  for (const h of fwd) {
    const val = upstream.headers.get(h)
    if (val) res.setHeader(h, val)
  }
  // PROXY: always declare Range support regardless of what the upstream sent.
  // CDNs omit Accept-Ranges on 206 responses; without this the browser may
  // not know seeking is supported after a Range-initiated connection.
  res.setHeader('Accept-Ranges', 'bytes')

  // Defensive: a 2xx with no body (e.g. 204 or upstream HEAD-shaped response)
  // would throw inside Readable.fromWeb(null). End cleanly instead.
  if (!upstream.body) {
    res.end()
    return
  }

  // Pipe the body using Node streams (more robust than manual reader pump).
  // FALLBACK: cleanup happens via res.on('close') when client disconnects —
  // we abort the upstream then so dangling sockets don't leak.
  // HYDRATION: do NOT add a per-chunk timeout here -- when the browser fills
  // its media buffer (~30s), it stops draining and pipe() applies backpressure,
  // pausing the readable. A "no data for N seconds" timer cannot distinguish
  // backpressure (normal) from upstream stall (bad), so it kills healthy
  // streams mid-playback. Match the HLS proxy pattern below.
  const nodeStream = Readable.fromWeb(upstream.body)
  nodeStream.pipe(res)
  nodeStream.on('error', () => { if (!res.writableEnded) res.end() })
  res.on('close', () => { nodeStream.destroy(); controller.abort() })
})

// -----------------------------------------------------------
// GET /api/hls-proxy?url=...
// Proxies HLS playlists and segments from CDN.
// For .m3u8 files: rewrites segment URLs to also go through this proxy.
// For .ts segments: streams the bytes directly.
// This avoids Chrome's ORB (Opaque Response Blocking) which blocks
// hls.js and even native cross-origin media fetches on desktop Chrome.
// -----------------------------------------------------------
router.get('/api/hls-proxy', async (req, res) => {
  const { url } = req.query
  if (!url) return res.status(400).send('URL required')
  if (!isAllowedCdnUrl(url)) return res.status(403).send('Domain not allowed')

  const referer = getRefererForUrl(url)

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': referer,
  }
  if (req.headers.range) headers['Range'] = req.headers.range

  // PLAYBACK: 15s applies to headers only. See proxy-stream above for rationale —
  // segment downloads can take longer than 15s under browser backpressure.
  // Routed through boundary.streamingFetch (M7.6) so HLS failures surface in
  // /debug/boundary-stats under the names `hls-proxy-playlist` and
  // `hls-proxy-segment`. Two names so the snitch tally can distinguish a
  // playlist 403 (whole stream broken) from a single-segment 403 (mid-playback
  // glitch) — they have very different user impact.
  const controller = new AbortController()
  const headersTimeout = setTimeout(() => controller.abort(), 15000)
  const isPlaylist = url.includes('.m3u8')
  let result
  try {
    result = await boundary.streamingFetch(url, {
      name: isPlaylist ? 'hls-proxy-playlist' : 'hls-proxy-segment',
      headers,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(headersTimeout)
  }

  const { outcome, response: upstream } = result
  if (outcome !== 'ok') {
    logger.error('HLS proxy error', { outcome, status: result.status, kind: isPlaylist ? 'playlist' : 'segment' })
    if (!res.headersSent) res.status(statusForOutcome(outcome)).send('HLS proxy failed')
    return
  }

  if (isPlaylist) {
    // Rewrite m3u8 playlist: proxy ALL non-comment lines (segments, variant playlists)
    const text = await upstream.text()
    const baseUrl = url.substring(0, url.lastIndexOf('/') + 1)
    const rewritten = text.replace(/^(?!#)(\S+)$/gm, (line) => {
      const segUrl = line.startsWith('http') ? line : baseUrl + line
      return `/api/hls-proxy?url=${encodeURIComponent(segUrl)}`
    })
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl')
    res.setHeader('Access-Control-Allow-Origin', '*')
    // PROXY: HLS playlists reference CDN URLs that expire in ~2hr; stale
    // cached playlists cause segment 403s mid-playback. Never cache.
    res.setHeader('Cache-Control', 'no-store')
    res.send(rewritten)
  } else {
    // Stream segment bytes using Node streams
    res.status(upstream.status)
    const ct = upstream.headers.get('content-type')
    if (ct) res.setHeader('Content-Type', ct)
    const cl = upstream.headers.get('content-length')
    if (cl) res.setHeader('Content-Length', cl)
    res.setHeader('Access-Control-Allow-Origin', '*')

    // Same null-body guard as proxy-stream above.
    if (!upstream.body) {
      res.end()
      return
    }

    const nodeStream = Readable.fromWeb(upstream.body)
    nodeStream.pipe(res)
    nodeStream.on('error', () => { if (!res.writableEnded) res.end() })
    res.on('close', () => { nodeStream.destroy(); controller.abort() })
  }
})

export default router
