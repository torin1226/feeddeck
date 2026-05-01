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
import { probeCookieForDomain } from '../cookie-health.js'

const execFileAsync = promisify(execFile)

// yt-dlp supports 1000+ sites, so we don't restrict by domain.
// It acts as the universal fallback for extraction.
const YTDLP_TIMEOUT = 30_000
const YTDLP_SEARCH_TIMEOUT = 120_000
const MAX_BUFFER = 50 * 1024 * 1024

// Domains we believe have expired cookies, mapped to the wall-clock time
// at which the entry expires. After expiry the domain is eligible to retry
// with cookies. Bounds blast radius: a transient stderr warning can no
// longer disable cookies for the entire process lifetime (see
// 2026-04-30 hydration session).
const COOKIE_EXPIRED_TTL_MS = 10 * 60 * 1000 // 10 minutes
const _expiredCookieDomains = new Map()

// Domains with an in-flight async verification probe — dedupes concurrent
// probes when many requests hit the same warning at once.
const _verifyingDomains = new Set()

function _isCookieExpired(domain) {
  if (!domain) return false
  const expireAt = _expiredCookieDomains.get(domain)
  if (!expireAt) return false
  if (Date.now() >= expireAt) {
    _expiredCookieDomains.delete(domain)
    return false
  }
  return true
}

function _markCookieExpired(domain) {
  if (!domain) return
  _expiredCookieDomains.set(domain, Date.now() + COOKIE_EXPIRED_TTL_MS)
}

// On stderr-only "cookies are no longer valid" signals (the call still
// succeeded), don't trust the warning blindly. Run a real cookie probe;
// only mark the domain expired if the probe also says expired. If no probe
// exists for the domain (e.g. xvideos, fikfap), fall back to immediate
// TTL'd marking — the warning is the only signal we have.
function _verifyAndMarkExpired(domain) {
  if (!domain || _verifyingDomains.has(domain)) return
  _verifyingDomains.add(domain)
  ;(async () => {
    try {
      const probe = await probeCookieForDomain(domain)
      if (probe == null) {
        _markCookieExpired(domain)
        logger.warn(`yt-dlp: ${domain} cookies marked expired (no probe; TTL ${COOKIE_EXPIRED_TTL_MS / 60000}min)`)
        return
      }
      if (probe.status === 'expired' || probe.status === 'missing') {
        _markCookieExpired(domain)
        logger.warn(`yt-dlp: ${domain} cookies confirmed ${probe.status} by probe (TTL ${COOKIE_EXPIRED_TTL_MS / 60000}min)`)
      } else {
        logger.info(`yt-dlp: stderr warning for ${domain} but probe reports ${probe.status} — not poisoning skip set`)
      }
    } catch (err) {
      logger.warn(`yt-dlp: cookie probe for ${domain} threw (${err.message}); not marking expired`)
    } finally {
      _verifyingDomains.delete(domain)
    }
  })()
}

// Safe yt-dlp execution — uses execFile (no shell) to prevent command injection
// Routes cookies per-domain based on the URL being fetched
// Accepts optional mode ('social'|'nsfw') for mode-specific cookie file fallback
async function ytdlp(args, url, options = {}) {
  // Skip cookies if we already know they're expired for this domain (TTL'd).
  const domain = _extractDomain(url)
  const skipCookies = _isCookieExpired(domain)
  const cookieArgs = skipCookies ? [] : getCookieArgs(url, options.mode)
  const finalArgs = ['--js-runtimes', 'node', ...cookieArgs, ...args]
  try {
    const { stdout, stderr } = await execFileAsync('yt-dlp', finalArgs, {
      encoding: 'utf8',
      timeout: options.timeout || YTDLP_TIMEOUT,
      maxBuffer: options.maxBuffer || MAX_BUFFER,
      windowsHide: true,
    })
    // Stderr warning on a *successful* run is weak evidence — yt-dlp still
    // returned valid output. Don't poison the skip set on warnings alone;
    // schedule an async verification probe instead.
    if (stderr?.includes('cookies are no longer valid') && domain) {
      _verifyAndMarkExpired(domain)
    }
    return stdout
  } catch (err) {
    // With --ignore-errors, yt-dlp may exit non-zero but still produce valid output
    if (args.includes('--ignore-errors') && err.stdout?.trim()) {
      // Stderr warning on a partial-success run is also weak — verify async.
      if (err.stderr?.includes('cookies are no longer valid') && domain) {
        _verifyAndMarkExpired(domain)
      }
      return err.stdout
    }
    // If cookies are expired/invalid AND the call hard-failed, mark immediately:
    // the failure itself is evidence; no probe round-trip needed.
    const errMsg = err.stderr || err.message || ''
    if (cookieArgs.length > 0 && errMsg.includes('cookies are no longer valid')) {
      _markCookieExpired(domain)
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

// Export the raw yt-dlp exec helper so other adapters (e.g., CreatorAdapter) can reuse it.
// _isCookieExpired / _markCookieExpired / _resetExpiredCookieDomains / COOKIE_EXPIRED_TTL_MS
// are exported for tests and for callers that want to consult/clear the skip set.
function _resetExpiredCookieDomains() {
  _expiredCookieDomains.clear()
  _verifyingDomains.clear()
}
export {
  ytdlp as ytdlpExec,
  _extractDomain,
  YTDLP_TIMEOUT,
  YTDLP_SEARCH_TIMEOUT,
  _isCookieExpired,
  _markCookieExpired,
  _verifyAndMarkExpired,
  _resetExpiredCookieDomains,
  COOKIE_EXPIRED_TTL_MS,
}

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
      || '1080p/720p/480p/best[height<=1080][protocol=https][ext=mp4][vcodec!*=av01]/best[height<=1080][ext=mp4]/18/best[ext=mp4]/best'
    const stdout = await ytdlp(['-g', '-f', formatStr, url], url)

    let cdnUrl = stdout.trim().split('\n')[0]

    // If yt-dlp returned HLS and no explicit format was requested, retry with direct MP4 formats
    if (cdnUrl.includes('.m3u8') && !options?.format) {
      try {
        const mp4Out = await ytdlp(['-g', '-f', '1080p/720p/480p/18', url], url)
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
        if (_isCookieExpired(domain)) {
          // Cookies already known expired (within TTL): use channel cache fallback
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
      return `ytsearch${limit}:trending videos today`
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
