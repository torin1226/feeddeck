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

const execFileAsync = promisify(execFile)

// yt-dlp supports 1000+ sites, so we don't restrict by domain.
// It acts as the universal fallback for extraction.
const YTDLP_TIMEOUT = 30_000
const YTDLP_SEARCH_TIMEOUT = 120_000
const MAX_BUFFER = 50 * 1024 * 1024

// Safe yt-dlp execution — uses execFile (no shell) to prevent command injection
// Routes cookies per-domain based on the URL being fetched
async function ytdlp(args, url, options = {}) {
  const finalArgs = [...getCookieArgs(url, options.mode), ...args]
  const { stdout } = await execFileAsync('yt-dlp', finalArgs, {
    encoding: 'utf8',
    timeout: options.timeout || YTDLP_TIMEOUT,
    maxBuffer: options.maxBuffer || MAX_BUFFER,
    windowsHide: true,
  })
  return stdout
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
      this.version = execFileSync('yt-dlp', ['--version'], { encoding: 'utf8', windowsHide: true }).trim()
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

  async extractMetadata(url, options = {}) {
    if (!this.isAvailable()) throw new Error('yt-dlp not installed')
    const stdout = await ytdlp(['--dump-json', '--no-download', url], url, options)
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

    const formatStr = '480p/240p/720p/best[height<=480][protocol=https][ext=mp4][vcodec!*=av01]/best[height<=480][ext=mp4]/18/best[ext=mp4]/best'
    const stdout = await ytdlp(['-g', '-f', formatStr, url], url, options)

    let cdnUrl = stdout.trim().split('\n')[0]

    // If yt-dlp returned HLS, retry with direct MP4 formats
    if (cdnUrl.includes('.m3u8')) {
      try {
        const mp4Out = await ytdlp(['-g', '-f', '480p/240p/720p/18', url], url, options)
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
      const isSocialFeedUrl = /youtube\.com\/feed\//i.test(query) ||
        /tiktok\.com\/(foryou|discover)/i.test(query) ||
        /reddit\.com\/r\/\w+\/(hot|top|new)/i.test(query)

      if (isSocialFeedUrl) {
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

    return this._fetchPlaylist(searchUrl, limit, options)
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
    return this._fetchPlaylist(categoryUrl, limit, options)
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

    return this._fetchPlaylist(url, limit, options)
  }

  // Core: run yt-dlp on a playlist/search URL and return normalized videos
  async _fetchPlaylist(url, limit = 12, options = {}) {
    if (!this.isAvailable()) throw new Error('yt-dlp not installed')

    const stdout = await ytdlp(
      ['--dump-json', '--playlist-end', String(limit), '--no-download', url],
      url,
      { timeout: YTDLP_SEARCH_TIMEOUT, ...options }
    )

    const lines = stdout.trim().split('\n')
    const videos = []

    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const data = JSON.parse(line)
        videos.push(this.normalizeVideo(data))
      } catch { /* skip malformed */ }
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

    const child = spawn('yt-dlp', [...getCookieArgs(searchUrl, options.mode), '--dump-json', '--playlist-end', String(limit), searchUrl])

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
            } catch { /* skip */ }
          }
        })
      },
      onDone: (callback) => child.on('close', callback),
      onError: (callback) => child.on('error', callback),
      kill: () => child.kill(),
    }
  }
}
