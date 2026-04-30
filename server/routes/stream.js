import { Router } from 'express'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { Readable } from 'stream'
import { db } from '../database.js'
import { getCookieArgs } from '../cookies.js'
import { registry, ytdlp as ytdlpAdapter } from '../sources/index.js'
import { logger } from '../logger.js'
import { isAllowedCdnUrl, inferMode, safeParse, getRefererForUrl } from '../utils.js'

const execFileAsync = promisify(execFile)

const router = Router()

// -----------------------------------------------------------
// Health check
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
router.get('/api/stream-formats', async (req, res) => {
  const { url } = req.query
  if (!url) return res.status(400).json({ error: 'URL required' })

  try {
    const { stdout } = await execFileAsync('yt-dlp', [
      ...getCookieArgs(url), '-j', '--no-warnings', '--no-playlist', url
    ], { timeout: 30000 })

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
  } catch (err) {
    logger.error('Stream formats error', { error: err.message })
    res.status(500).json({ error: 'Could not list formats' })
  }
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

  try {
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

    // 15s timeout to prevent hanging on slow/dead CDNs
    const upstream = await fetch(url, { headers, signal: AbortSignal.timeout(15000) })

    // Forward status and key headers
    res.status(upstream.status)
    const fwd = ['content-type', 'content-length', 'content-range', 'accept-ranges']
    for (const h of fwd) {
      const val = upstream.headers.get(h)
      if (val) res.setHeader(h, val)
    }

    // Pipe the body using Node streams (more robust than manual reader pump).
    // FALLBACK: cleanup happens via res.on('close') when client disconnects.
    // HYDRATION: do NOT add a per-chunk timeout here -- when the browser fills
    // its media buffer (~30s), it stops draining and pipe() applies backpressure,
    // pausing the readable. A "no data for N seconds" timer cannot distinguish
    // backpressure (normal) from upstream stall (bad), so it kills healthy
    // streams mid-playback. Match the HLS proxy pattern below.
    const nodeStream = Readable.fromWeb(upstream.body)
    nodeStream.pipe(res)
    nodeStream.on('error', () => { if (!res.writableEnded) res.end() })
    res.on('close', () => { nodeStream.destroy() })
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
router.get('/api/hls-proxy', async (req, res) => {
  const { url } = req.query
  if (!url) return res.status(400).send('URL required')
  if (!isAllowedCdnUrl(url)) return res.status(403).send('Domain not allowed')

  try {
    const referer = getRefererForUrl(url)

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

export default router
