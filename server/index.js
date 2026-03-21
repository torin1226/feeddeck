import express from 'express'
import cors from 'cors'
import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import { networkInterfaces } from 'os'
import { initDatabase, db } from './database.js'

const execFileAsync = promisify(execFile)

// Safe yt-dlp execution — uses execFile (no shell) to prevent command injection
async function ytdlp(args, options = {}) {
  const { stdout } = await execFileAsync('yt-dlp', args, {
    encoding: 'utf8',
    timeout: options.timeout || 30000,
    maxBuffer: options.maxBuffer || 50 * 1024 * 1024,
    windowsHide: true,
    ...options,
  })
  return stdout
}

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
const PORT = 3001

app.use(cors())
app.use(express.json())

// -----------------------------------------------------------
// Health check
// -----------------------------------------------------------
app.get('/api/health', async (req, res) => {
  let ytdlpVersion = null
  try {
    ytdlpVersion = (await ytdlp(['--version'], { timeout: 5000 })).trim()
  } catch {
    // yt-dlp not installed
  }

  res.json({
    status: 'ok',
    ytdlp: ytdlpVersion || 'not found',
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
    const result = await ytdlp(['--dump-json', '--no-download', url])

    const data = JSON.parse(result)

    const metadata = {
      id: data.id || crypto.randomUUID(),
      title: data.title || 'Untitled',
      thumbnail: data.thumbnail || '',
      duration: data.duration || 0,
      tags: data.tags || [],
      source: data.extractor || new URL(url).hostname,
      view_count: data.view_count || 0,
      uploader: data.uploader || '',
      upload_date: data.upload_date || '',
      url: url,
    }

    // Save to database
    try {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO videos (id, url, title, thumbnail, duration, tags, source, added_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `)
      stmt.run(
        metadata.id,
        url,
        metadata.title,
        metadata.thumbnail,
        metadata.duration,
        JSON.stringify(metadata.tags),
        metadata.source
      )
    } catch (dbErr) {
      console.warn('DB save failed:', dbErr.message)
    }

    res.json(metadata)
  } catch (err) {
    console.error('yt-dlp error:', err.message)

    // Parse common errors
    if (err.message.includes('not found') || err.message.includes('not recognized')) {
      return res.status(500).json({ error: 'yt-dlp not installed. See SETUP.md' })
    }
    if (err.message.includes('Video unavailable') || err.message.includes('Private video')) {
      return res.status(404).json({ error: 'Video unavailable or private' })
    }
    if (err.message.includes('Unsupported URL')) {
      return res.status(400).json({ error: 'This site is not supported' })
    }

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
  const { url } = req.query
  if (!url) return res.status(400).json({ error: 'URL required' })

  // Check feed_cache for a cached stream URL
  try {
    const cached = db.prepare(
      `SELECT stream_url FROM feed_cache
       WHERE url = ? AND stream_url IS NOT NULL`
    ).get(url)

    if (cached?.stream_url) {
      return res.json({ streamUrl: cached.stream_url })
    }
  } catch { /* fall through to yt-dlp */ }

  try {
    // Format priority:
    // 1. PornHub direct MP4 format IDs (480p, 240p, 720p) — clean HTTPS URLs, no HLS
    // 2. Generic best MP4 ≤480p with HTTPS protocol
    // 3. Format 18 (YouTube 360p MP4 fallback)
    // 4. Any MP4, then any format
    const formatStr = '480p/240p/720p/best[height<=480][protocol=https][ext=mp4][vcodec!*=av01]/best[height<=480][ext=mp4]/18/best[ext=mp4]/best'
    const stdout = await ytdlp(['-g', '-f', formatStr, url])

    let cdnUrl = stdout.trim().split('\n')[0]

    // If yt-dlp still returned HLS (.m3u8), retry with explicit PornHub MP4 formats
    if (cdnUrl.includes('.m3u8')) {
      console.warn('Got HLS URL, retrying with explicit MP4 formats for:', url)
      try {
        const mp4Out = await ytdlp(['-g', '-f', '480p/240p/720p/18', url])
        const mp4Url = mp4Out.trim().split('\n')[0]
        if (!mp4Url.includes('.m3u8')) {
          cdnUrl = mp4Url
        }
      } catch { /* keep original if retry fails */ }
    }

    console.log('Resolved stream URL:', cdnUrl.includes('.m3u8') ? 'HLS' : 'MP4', cdnUrl.substring(0, 80))

    // Cache the resolved stream URL (expires in 2 hours — PornHub CDN URLs expire ~2hr)
    try {
      db.prepare(
        `UPDATE feed_cache SET stream_url = ?, expires_at = datetime('now', '+2 hours') WHERE url = ?`
      ).run(cdnUrl, url)
    } catch { /* cache miss is fine */ }

    // Return the raw CDN URL — phone plays it directly
    res.json({ streamUrl: cdnUrl })
  } catch (err) {
    console.error('Stream URL error:', err.message)
    const msg = err.message || ''
    if (msg.includes('Video unavailable') || msg.includes('Private video') || msg.includes('been removed')) {
      return res.status(404).json({ error: 'Video unavailable or taken down' })
    }
    if (msg.includes('blocked') || msg.includes('geo') || msg.includes('not available in your country')) {
      return res.status(403).json({ error: 'Video is geo-blocked in your region' })
    }
    if (msg.includes('429') || msg.includes('Too Many') || msg.includes('rate') || msg.includes('throttl')) {
      return res.status(429).json({ error: 'Rate limited — try again in a minute' })
    }
    if (msg.includes('Unsupported URL')) {
      return res.status(400).json({ error: 'This site is not supported by yt-dlp' })
    }
    res.status(500).json({ error: 'Could not get streaming URL' })
  }
})

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

    const upstream = await fetch(url, { headers })

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
    nodeStream.pipe(res)
    nodeStream.on('error', () => { if (!res.writableEnded) res.end() })
    res.on('close', () => { nodeStream.destroy() })
  } catch (err) {
    console.error('Proxy stream error:', err.message)
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

    const upstream = await fetch(url, { headers })

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
    console.error('HLS proxy error:', err.message)
    if (!res.headersSent) res.status(500).send('HLS proxy failed')
  }
})

// -----------------------------------------------------------
// GET /api/videos
// Return all videos from database
// -----------------------------------------------------------
app.get('/api/videos', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM videos ORDER BY added_at DESC').all()
    const videos = rows.map((row) => ({
      ...row,
      tags: row.tags ? JSON.parse(row.tags) : [],
      durationFormatted: formatDuration(row.duration),
    }))
    res.json({ videos })
  } catch (err) {
    console.error('DB read error:', err.message)
    res.json({ videos: [] })
  }
})

// -----------------------------------------------------------
// GET /api/search?q=...&count=12
// SSE stream — emits one JSON video object per event as yt-dlp
// fetches full metadata for each result. Client gets real
// thumbnails/duration immediately without waiting for all results.
// -----------------------------------------------------------
app.get('/api/search', (req, res) => {
  const { q, count = 12 } = req.query
  if (!q) return res.status(400).json({ error: 'Search query required' })

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })

  const searchUrl = `https://www.pornhub.com/video/search?search=${encodeURIComponent(q)}`
  const limit = parseInt(count, 10)
  const child = spawn('yt-dlp', ['--dump-json', '--playlist-end', String(limit), searchUrl])

  // Consume stderr so it doesn't fill the buffer and hang the process
  child.stderr.on('data', (chunk) => {
    console.error('[yt-dlp]', chunk.toString().trim())
  })

  let buffer = ''
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop() // hold incomplete last line
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const data = JSON.parse(line)
        const video = {
          id: data.id,
          title: data.title,
          thumbnail: data.thumbnail || data.thumbnails?.[0]?.url || '',
          duration: data.duration || 0,
          durationFormatted: formatDuration(data.duration),
          url: data.webpage_url || data.url || '',
          source: data.extractor || 'unknown',
          uploader: data.uploader || '',
          view_count: data.view_count || 0,
          tags: data.tags || [],
        }
        res.write(`data: ${JSON.stringify(video)}\n\n`)
      } catch {
        // skip malformed lines
      }
    }
  })

  child.on('close', () => {
    res.write('data: [done]\n\n')
    res.end()
  })

  child.on('error', (err) => {
    console.error('Search spawn error:', err.message)
    res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`)
    res.end()
  })

  // Kill yt-dlp if client disconnects
  req.on('close', () => child.kill())
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
            console.error('Refill error:', err.message)
          )
        }
      }
    }

    res.json({ categories: result, needsRefill })
  } catch (err) {
    console.error('Homepage error:', err.message)
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
          console.error('Refill error:', err.message)
        )
      }
    }

    res.json({ ok: true })
  } catch (err) {
    console.error('Mark viewed error:', err.message)
    res.status(500).json({ error: 'Failed to mark as viewed' })
  }
})

// -----------------------------------------------------------
// Async refill: fetch new videos for a category via yt-dlp
// -----------------------------------------------------------
async function refillCategory(categoryKey) {
  const cat = db.prepare('SELECT query, mode FROM categories WHERE key = ?').get(categoryKey)
  if (!cat) return

  console.log(`  🔄 Refilling category: ${categoryKey}`)

  // Build search URL based on mode
  const searchUrl = cat.mode === 'nsfw'
    ? `https://www.pornhub.com/video/search?search=${encodeURIComponent(cat.query)}`
    : `ytsearch12:${cat.query}`

  try {
    const stdout = await ytdlp(
      ['--dump-json', '--playlist-end', '12', '--no-download', searchUrl],
      { timeout: 90000 }
    )

    const lines = stdout.trim().split('\n')
    const insert = db.prepare(`
      INSERT OR IGNORE INTO homepage_cache (id, category_key, url, title, thumbnail, duration, source, uploader, view_count, tags, fetched_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now', '+24 hours'))
    `)

    let added = 0
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const data = JSON.parse(line)
        insert.run(
          data.id || crypto.randomUUID(),
          categoryKey,
          data.webpage_url || data.url || '',
          data.title || 'Untitled',
          data.thumbnail || data.thumbnails?.[0]?.url || '',
          data.duration || 0,
          data.extractor || 'unknown',
          data.uploader || '',
          data.view_count || 0,
          JSON.stringify(data.tags || [])
        )
        added++
      } catch { /* skip malformed */ }
    }

    console.log(`  ✅ Added ${added} videos to ${categoryKey}`)
  } catch (err) {
    console.error(`  ❌ Refill failed for ${categoryKey}:`, err.message)
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

  try {
    // Get unwatched videos from cache, ordered by source weight
    // Include stream_url so client doesn't need a second API call
    const videos = db.prepare(`
      SELECT fc.id, fc.url, fc.stream_url AS streamUrl, fc.title, fc.creator AS uploader, fc.thumbnail,
             fc.duration, fc.orientation, fc.source_domain AS source
      FROM feed_cache fc
      LEFT JOIN sources s ON fc.source_domain = s.domain
      WHERE fc.mode = ? AND fc.watched = 0
      ORDER BY COALESCE(s.weight, 1.0) DESC, RANDOM()
      LIMIT ?
    `).all(mode, count)

    // Format for client (hls.js handles HLS URLs on non-Safari browsers)
    const formatted = videos.map(v => ({
      ...v,
      durationFormatted: formatDuration(v.duration),
    }))

    // Check if we need more content
    const unviewedCount = db.prepare(
      `SELECT COUNT(*) as n FROM feed_cache
       WHERE mode = ? AND watched = 0`
    ).get(mode)

    if (unviewedCount.n < 20) {
      refillFeedCache(mode).catch(err =>
        console.error('Feed refill error:', err.message)
      )
    }

    res.json({ videos: formatted })
  } catch (err) {
    console.error('Feed next error:', err.message)
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
    console.error('Feed watched error:', err.message)
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
    console.error('Source feedback error:', err.message)
    res.status(500).json({ error: 'Failed to update source' })
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

  for (const src of sources) {
    console.log(`  🔄 Refilling feed: ${src.label} (${mode})`)

    const searchUrl = mode === 'nsfw'
      ? `https://www.pornhub.com/video/search?search=${encodeURIComponent(src.query)}`
      : src.query // Already in ytsearch format

    try {
      const stdout = await ytdlp(
        ['--dump-json', '--playlist-end', '20', '--no-download', searchUrl],
        { timeout: 120000 }
      )

      const lines = stdout.trim().split('\n')
      const insert = db.prepare(`
        INSERT OR IGNORE INTO feed_cache (id, source_domain, mode, url, title, creator, thumbnail, duration, orientation, fetched_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now', '+6 hours'))
      `)

      let added = 0
      const newVideoUrls = []
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const data = JSON.parse(line)
          const w = data.width || 1920
          const h = data.height || 1080
          const orientation = h > w ? 'vertical' : 'horizontal'
          const videoUrl = data.webpage_url || data.url || ''

          const result = insert.run(
            data.id || crypto.randomUUID(),
            src.domain,
            mode,
            videoUrl,
            data.title || 'Untitled',
            data.uploader || data.channel || '',
            data.thumbnail || data.thumbnails?.[0]?.url || '',
            data.duration || 0,
            orientation
          )
          added++
          // Track newly inserted videos (changes > 0 means it wasn't a duplicate)
          if (result.changes > 0 && videoUrl) {
            newVideoUrls.push(videoUrl)
          }
        } catch { /* skip malformed */ }
      }
      // Update last_fetched timestamp
      db.prepare('UPDATE sources SET last_fetched = datetime(\'now\') WHERE domain = ?').run(src.domain)
      console.log(`  ✅ Added ${added} feed videos from ${src.label}`)

      // Pre-resolve stream URLs for newly added videos (2.8 Tier 1)
      if (newVideoUrls.length > 0) {
        console.log(`  🔗 Pre-resolving stream URLs for ${newVideoUrls.length} new videos...`)
        await _preResolveStreamUrls(newVideoUrls)
      }
    } catch (err) {
      console.error(`  ❌ Feed refill failed for ${src.label}:`, err.message)
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
  const formatStr = '480p/240p/720p/best[height<=480][protocol=https][ext=mp4][vcodec!*=av01]/best[height<=480][ext=mp4]/18/best[ext=mp4]/best'
  const updateStmt = db.prepare(
    `UPDATE feed_cache SET stream_url = ?, expires_at = datetime('now', '+2 hours') WHERE url = ?`
  )

  let resolved = 0, failed = 0

  // Process in batches of STREAM_RESOLVE_CONCURRENCY
  for (let i = 0; i < videoUrls.length; i += STREAM_RESOLVE_CONCURRENCY) {
    const batch = videoUrls.slice(i, i + STREAM_RESOLVE_CONCURRENCY)
    const results = await Promise.allSettled(
      batch.map(async (url) => {
        const stdout = await ytdlp(['-g', '-f', formatStr, url], { timeout: 30000 })
        let cdnUrl = stdout.trim().split('\n')[0]

        // If HLS returned, retry with explicit MP4 formats
        if (cdnUrl.includes('.m3u8')) {
          try {
            const mp4Out = await ytdlp(['-g', '-f', '480p/240p/720p/18', url], { timeout: 20000 })
            const mp4Url = mp4Out.trim().split('\n')[0]
            if (!mp4Url.includes('.m3u8')) cdnUrl = mp4Url
          } catch { /* keep original */ }
        }

        updateStmt.run(cdnUrl, url)
        return cdnUrl
      })
    )

    for (const r of results) {
      if (r.status === 'fulfilled') resolved++
      else failed++
    }
  }

  console.log(`  🔗 Stream URLs resolved: ${resolved} OK, ${failed} failed`)
}

// -----------------------------------------------------------
// Scheduled feed refill: check all sources and refill any
// whose last_fetched is older than their fetch_interval
// -----------------------------------------------------------
function startScheduledFeedRefill() {
  const CHECK_INTERVAL = 60_000 // Check every 60 seconds

  setInterval(() => {
    try {
      const stale = db.prepare(`
        SELECT domain, mode, label FROM sources
        WHERE active = 1
          AND (last_fetched IS NULL
               OR datetime(last_fetched, '+' || fetch_interval || ' seconds') < datetime('now'))
      `).all()

      for (const src of stale) {
        refillFeedCache(src.mode).catch(err =>
          console.error(`Scheduled refill error (${src.label}):`, err.message)
        )
      }
    } catch (err) {
      console.error('Scheduled refill check error:', err.message)
    }
  }, CHECK_INTERVAL)
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
  console.error('\n[CRASH] Uncaught exception:', err)
  process.exit(1)
})
process.on('unhandledRejection', (reason) => {
  // Log but don't crash — transient network errors in background tasks
  // (feed refill, category refresh) shouldn't take down the server
  console.error('\n[WARN] Unhandled rejection:', reason)
})

// -----------------------------------------------------------
// Start server
// -----------------------------------------------------------
initDatabase()

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  📡 Server running at http://localhost:${PORT}`)

  // Print local network URL for mobile testing
  try {
    const nets = networkInterfaces()
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          console.log(`     Network: http://${net.address}:${PORT}`)
        }
      }
    }
  } catch {}

  console.log(`     Health check: http://localhost:${PORT}/api/health\n`)
  startScheduledFeedRefill()
})
