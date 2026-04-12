// ============================================================
// yt-dlp Adapter
// Wraps yt-dlp CLI for metadata extraction and stream URL
// resolution. This is the existing workhorse, now behind
// the adapter interface so it can be swapped or supplemented.
// ============================================================

import { execFile, execFileSync, spawn } from 'child_process'
import { promisify } from 'util'
import { SourceAdapter } from './base.js'
import { getCookieArgs } from '../cookies.js'
import { logger } from '../logger.js'
import { cacheSubscriptionChannels, buildSubscriptionFallbackQueries } from '../sub-channel-cache.js'

const execFileAsync = promisify(execFile)

// yt-dlp supports 1000+ sites, so we don't restrict by domain.
// It acts as the universal fallback for extraction.
const YTDLP_TIMEOUT = 30_000
const YTDLP_SEARCH_TIMEOUT = 120_000
const MAX_BUFFER = 50 * 1024 * 1024

// Track domains with expired cookies to skip them immediately on subsequent calls
const _expiredCookieDomains = new Set()

// Safe yt-dlp execution — uses execFile (no shell) to prevent command injection
// Routes cookies per-domain based on the URL being fetched
// Accepts optional mode ('social'|'nsfw') for mode-specific cookie file fallback
async function ytdlp(args, url, options = {}) {
  // Skip cookies if we already know they're expired for this domain
  const domain = _extractDomain(url)
  const skipCookies = domain && _expiredCookieDomains.has(domain)
  const cookieArgs = skipCookies ? [] : getCookieArgs(url, options.mode)
  const finalArgs = ['--js-runtimes', 'node', ...cookieArgs, ...args]
  try {
    const { stdout, stderr } = await execFileAsync('yt-dlp', finalArgs, {
      encoding: 'utf8',
      timeout: options.timeout || YTDLP_TIMEOUT,
      maxBuffer: options.maxBuffer || MAX_BUFFER,
      windowsHide: true,
    })
    // Check stderr for cookie warnings even on success (yt-dlp warns but continues)
    if (stderr?.includes('cookies are no longer valid') && domain) {
      _expiredCookieDomains.add(domain)
      logger.warn(`yt-dlp: marking ${domain} cookies as expired (will skip in future)`)
    }
    return stdout
  } catch (err) {
    // With --ignore-errors, yt-dlp may exit non-zero but still produce valid output
    if (args.includes('--ignore-errors') && err.stdout?.trim()) {
      // Still check for cookie warnings
      if (err.stderr?.includes('cookies are no longer valid') && domain) {
        _expiredCookieDomains.add(domain)
      }
      return err.stdout
    }
    // If cookies are expired/invalid, mark domain and retry without them
    const errMsg = err.stderr || err.message || ''
    if (cookieArgs.length > 0 && errMsg.includes('cookies are no longer valid')) {
      if (domain) _expiredCookieDomains.add(domain)
      logger.warn(`yt-dlp: cookies expired for ${domain}, retrying without cookies`)
      const noCookieArgs = ['--js-runtimes', 'node', ...args]
      try {
        const { stdout } = await execFileAsync('yt-dlp', noCookieArgs, {
          encoding: 'utf8',
          timeout: options.timeout || YTDLP_TIMEOUT,
          maxBuffer: options.maxBuffer || MAX_BUFFER,
          windowsHide: true,
        })
        return stdout
      } catch (retryErr) {
        if (args.includes('--ignore-errors') && retryErr.stdout?.trim()) {
          return retryErr.stdout
        }
        throw retryErr
      }
    }
    throw err
  }
}

// Extract domain from URL or yt-dlp search string
function _extractDomain(url) {
  if (!url) return null
  if (/^ytsearch\w*:/i.test(url)) return 'youtube.com'
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return null }
}

// Export the raw yt-dlp exec helper so other adapters (e.g., CreatorAdapter) can reuse it
export { ytdlp as ytdlpExec, _extractDomain, YTDLP_TIMEOUT, YTDLP_SEARCH_TIMEOUT }

export class YtDlpAdapter extends SourceAdapter {
  constructor() {
    super({
      name: 'yt-dlp',
      supportedDomains: [], // handles everything as fallback
      capabilities: {
        search: true,
        categories: true,
        trending: true,
        metadata: true,
        streamUrl: true,
      },
    })
    this.available = null // lazy check
  }

  // Check if yt-dlp is installed
  isAvailable() {
    if (this.available !== null) return this.available
    try {
      this.version = execFileSync('yt-dlp', ['--js-runtimes', 'node', '--version'], { encoding: 'utf8', windowsHide: true }).trim()
      this.available = true
    } catch {
      this.available = false
    }
    return this.available
  }

  // Always handle any domain (universal fallback)
  handlesDomain() {
    return true
  }

  async extractMetadata(url) {
    if (!this.isAvailable()) throw new Error('yt-dlp not installed')
    const stdout = await ytdlp(['--dump-json', '--no-download', url], url)
    let data
    try {
      data = JSON.parse(stdout)
    } catch {
      throw new Error(`yt-dlp returned invalid JSON for ${url}: ${stdout.slice(0, 500)}`)
    }
    return this.normalizeVideo(data)
  }

  async getStreamUrl(url, options = {}) {
    if (!this.isAvailable()) throw new Error('yt-dlp not installed')

    // Use caller-specified format (from quality selector) or fall back to default preference
    const formatStr = options?.format
      || '480p/240p/720p/best[height<=480][protocol=https][ext=mp4][vcodec!*=av01]/best[height<=480][ext=mp4]/18/best[ext=mp4]/best'
    const stdout = await ytdlp(['-g', '-f', formatStr, url], url)

    let cdnUrl = stdout.trim().split('\n')[0]

    // If yt-dlp returned HLS and no explicit format was requested, retry with direct MP4 formats
    if (cdnUrl.includes('.m3u8') && !options?.format) {
      try {
        const mp4Out = await ytdlp(['-g', '-f', '480p/240p/720p/18', url], url)
        cdnUrl = mp4Out.trim().split('\n')[0]
      } catch { /* keep original if format 18 fails */ }
    }

    return cdnUrl
  }

  async search(query, options = {}) {
    if (!this.isAvailable()) throw new Error('yt-dlp not installed')

    const { site, limit = 12 } = options
    let searchUrl

    // If query is a yt-dlp search string (ytsearch:), use directly
    if (/^ytsearch\w*:/i.test(query)) {
      searchUrl = query
    } else if (query.startsWith('http')) {
      // URL-based query: check if it's a social feed URL that needs auth
      // Social feed URLs (youtube.com/feed/*, tiktok.com/foryou, reddit.com/r/*/hot)
      // don't work without cookies — convert to search queries instead
      // Subscription feed URLs have cookies and should be passed directly to yt-dlp
      const isSubscriptionFeed = /youtube\.com\/feed\/subscriptions/i.test(query)
      const isSocialFeedUrl = !isSubscriptionFeed && (
        /youtube\.com\/feed\//i.test(query) ||
        /tiktok\.com\/(foryou|discover)/i.test(query) ||
        /reddit\.com\/r\/\w+\/(hot|top|new)/i.test(query)
      )

      if (isSubscriptionFeed) {
        // Subscription feed: try with cookies first, fall back to cached channels
        const domain = _extractDomain(query)
        if (domain && _expiredCookieDomains.has(domain)) {
          // Cookies already known expired: use channel cache fallback
          return this._subscriptionFallback(limit)
        }
        // Try the real feed; if it fails, catch and fallback below
        try {
          const results = await this._fetchPlaylistWithChannelCache(query, limit)
          return results
        } catch (err) {
          const errMsg = err.stderr || err.message || ''
          if (errMsg.includes('cookies are no longer valid') || errMsg.includes('login required')) {
            logger.warn('yt-dlp: subscription feed failed, attempting channel cache fallback')
            return this._subscriptionFallback(limit)
          }
          throw err
        }
      } else if (isSocialFeedUrl) {
        // Extract a useful search term from the URL
        const searchTerm = this._socialFeedToSearch(query, limit)
        searchUrl = searchTerm
      } else {
        // Regular URL (category page, playlist, etc.) — use directly
        searchUrl = query
      }
    } else if (site && site.includes('pornhub')) {
      searchUrl = `https://www.pornhub.com/video/search?search=${encodeURIComponent(query)}`
    } else if (site && site.includes('xvideos')) {
      searchUrl = `https://www.xvideos.com/?k=${encodeURIComponent(query)}`
    } else if (site && site.includes('spankbang')) {
      searchUrl = `https://spankbang.com/s/${encodeURIComponent(query)}/`
    } else if (site && (site.includes('tiktok') || site.includes('reddit'))) {
      // Social sites without URL: use YouTube search as proxy (yt-dlp doesn't search TikTok/Reddit)
      searchUrl = `ytsearch${limit}:${query}`
    } else {
      // Default: YouTube search
      searchUrl = `ytsearch${limit}:${query}`
    }

    return this._fetchPlaylist(searchUrl, limit)
  }

  // Fetch subscription feed and cache the channels we see for fallback use
  async _fetchPlaylistWithChannelCache(url, limit) {
    if (!this.isAvailable()) throw new Error('yt-dlp not installed')

    const stdout = await ytdlp(
      ['--dump-json', '--playlist-end', String(limit), '--no-download', '--ignore-errors', url],
      url,
      { timeout: YTDLP_SEARCH_TIMEOUT }
    )

    const lines = stdout.trim().split('\n').filter(l => l.trim())
    const rawEntries = []
    const videos = []

    for (const line of lines) {
      try {
        const raw = JSON.parse(line)
        rawEntries.push(raw)
        videos.push(this.normalizeVideo(raw))
      } catch { /* skip malformed lines */ }
    }

    // Cache the channels we just saw for fallback use
    if (rawEntries.length > 0) {
      cacheSubscriptionChannels(rawEntries)
    }

    return videos
  }

  // Fallback: use cached subscription channels to approximate the subscription feed
  // Returns videos with a _fallback flag so the frontend can show a warning banner
  async _subscriptionFallback(limit) {
    const { queries, channelNames } = buildSubscriptionFallbackQueries(limit)

    if (queries.length === 0) {
      logger.warn('yt-dlp: no cached channels for subscription fallback, using generic trending')
      const results = await this._fetchPlaylist(`ytsearch${limit}:trending videos today`, limit)
      return results.map(v => ({ ...v, _fallback: 'no-cache' }))
    }

    logger.info(`yt-dlp: subscription fallback using ${queries.length} cached channels: ${channelNames.slice(0, 5).join(', ')}...`)

    // Fetch from each channel URL/search in parallel (capped at 5 concurrent)
    const CONCURRENCY = 5
    const allVideos = []

    for (let i = 0; i < queries.length; i += CONCURRENCY) {
      const batch = queries.slice(i, i + CONCURRENCY)
      const batchResults = await Promise.allSettled(
        batch.map(q => this._fetchPlaylist(q, 3).catch(() => []))
      )
      for (const result of batchResults) {
        if (result.status === 'fulfilled' && Array.isArray(result.value)) {
          allVideos.push(...result.value)
        }
      }
      // Stop early if we have enough
      if (allVideos.length >= limit) break
    }

    // Dedupe by video ID, shuffle, and cap at limit
    const seen = new Set()
    const deduped = allVideos.filter(v => {
      if (seen.has(v.id)) return false
      seen.add(v.id)
      return true
    })

    // Shuffle so it's not just the first N channels dominating
    for (let i = deduped.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deduped[i], deduped[j]] = [deduped[j], deduped[i]]
    }

    const results = deduped.slice(0, limit)
    // Tag every video so the frontend knows this is fallback data
    return results.map(v => ({ ...v, _fallback: 'channel-cache' }))
  }

  // Convert social feed URLs (that require auth) to yt-dlp search queries
  _socialFeedToSearch(feedUrl, limit) {
    if (/youtube\.com\/feed\/trending/i.test(feedUrl)) {
      // YouTube trending: use the trending music/videos playlist (public, no auth)
      return 'https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf'
    }
    if (/youtube\.com\/feed\//i.test(feedUrl)) {
      // Other YouTube feeds (subscriptions, etc.) — fallback to popular search
      return `ytsearch${limit}:trending videos today`
    }
    if (/tiktok\.com/i.test(feedUrl)) {
      return `ytsearch${limit}:tiktok viral trending`
    }
    if (/reddit\.com\/r\/(\w+)/i.test(feedUrl)) {
      const sub = feedUrl.match(/reddit\.com\/r\/(\w+)/i)[1]
      return `ytsearch${limit}:reddit ${sub} best`
    }
    // Fallback
    return `ytsearch${limit}:trending videos`
  }

  async fetchCategory(categoryUrl, options = {}) {
    const { limit = 20 } = options
    return this._fetchPlaylist(categoryUrl, limit)
  }

  async fetchTrending(options = {}) {
    const { site = 'youtube.com', limit = 20 } = options

    const trendingUrls = {
      'youtube.com': 'https://www.youtube.com/feed/trending',
      'pornhub.com': 'https://www.pornhub.com/video?o=tr',
      'xvideos.com': 'https://www.xvideos.com/best',
      'spankbang.com': 'https://spankbang.com/trending_videos/',
    }

    const url = trendingUrls[site]
    if (!url) throw new Error(`No trending URL configured for ${site}`)

    return this._fetchPlaylist(url, limit)
  }

  // Core: run yt-dlp on a playlist/search URL and return normalized videos
  async _fetchPlaylist(url, limit = 12) {
    if (!this.isAvailable()) throw new Error('yt-dlp not installed')

    const stdout = await ytdlp(
      ['--dump-json', '--playlist-end', String(limit), '--no-download', '--ignore-errors', url],
      url,
      { timeout: YTDLP_SEARCH_TIMEOUT }
    )

    const lines = stdout.trim().split('\n')
    const videos = []

    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const data = JSON.parse(line)
        videos.push(this.normalizeVideo(data))
      } catch (err) {
        logger.warn(`yt-dlp search: malformed JSON line (${line.slice(0, 80)}...): ${err.message}`)
      }
    }

    return videos
  }

  // SSE streaming search (emits results as they arrive)
  streamSearch(query, options = {}) {
    if (!this.isAvailable()) throw new Error('yt-dlp not installed')

    const { site, limit = 12 } = options
    let searchUrl

    if (site && site.includes('pornhub')) {
      searchUrl = `https://www.pornhub.com/video/search?search=${encodeURIComponent(query)}`
    } else {
      searchUrl = `ytsearch${limit}:${query}`
    }

    const child = spawn('yt-dlp', ['--js-runtimes', 'node', ...getCookieArgs(searchUrl, options.mode), '--dump-json', '--playlist-end', String(limit), searchUrl])

    // Kill subprocess after 60s to prevent resource leaks
    const timeout = setTimeout(() => { try { child.kill('SIGTERM') } catch {} }, 60000)
    child.on('close', () => clearTimeout(timeout))

    return {
      child,
      onVideo: (callback) => {
        let buffer = ''
        child.stdout.on('data', (chunk) => {
          buffer += chunk.toString()
          const lines = buffer.split('\n')
          buffer = lines.pop()
          for (const line of lines) {
            if (!line.trim()) continue
            try {
              const data = JSON.parse(line)
              callback(this.normalizeVideo(data))
            } catch (err) {
              logger.warn(`yt-dlp streamSearch: malformed JSON line (${line.slice(0, 80)}...): ${err.message}`)
            }
          }
        })
      },
      onDone: (callback) => child.on('close', callback),
      onError: (callback) => child.on('error', callback),
      kill: () => child.kill(),
    }
  }
}