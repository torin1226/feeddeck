// ============================================================
// yt-dlp Adapter
// Wraps yt-dlp CLI for metadata extraction and stream URL
// resolution. This is the existing workhorse, now behind
// the adapter interface so it can be swapped or supplemented.
// ============================================================

import { execFile, execFileSync, spawn } from 'child_process'
import { promisify } from 'util'
import { SourceAdapter } from './base.js'

const execFileAsync = promisify(execFile)

// yt-dlp supports 1000+ sites, so we don't restrict by domain.
// It acts as the universal fallback for extraction.
const YTDLP_TIMEOUT = 30_000
const YTDLP_SEARCH_TIMEOUT = 120_000
const MAX_BUFFER = 50 * 1024 * 1024

// Safe yt-dlp execution — uses execFile (no shell) to prevent command injection
async function ytdlp(args, options = {}) {
  const { stdout } = await execFileAsync('yt-dlp', args, {
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

  async extractMetadata(url) {
    if (!this.isAvailable()) throw new Error('yt-dlp not installed')
    const stdout = await ytdlp(['--dump-json', '--no-download', url])
    const data = JSON.parse(stdout)
    return this.normalizeVideo(data)
  }

  async getStreamUrl(url) {
    if (!this.isAvailable()) throw new Error('yt-dlp not installed')

    const formatStr = '480p/240p/720p/best[height<=480][protocol=https][ext=mp4][vcodec!*=av01]/best[height<=480][ext=mp4]/18/best[ext=mp4]/best'
    const stdout = await ytdlp(['-g', '-f', formatStr, url])

    let cdnUrl = stdout.trim().split('\n')[0]

    // If yt-dlp returned HLS, retry with direct MP4 formats
    if (cdnUrl.includes('.m3u8')) {
      try {
        const mp4Out = await ytdlp(['-g', '-f', '480p/240p/720p/18', url])
        cdnUrl = mp4Out.trim().split('\n')[0]
      } catch { /* keep original if format 18 fails */ }
    }

    return cdnUrl
  }

  async search(query, options = {}) {
    if (!this.isAvailable()) throw new Error('yt-dlp not installed')

    const { site, limit = 12 } = options
    let searchUrl

    if (site && site.includes('pornhub')) {
      searchUrl = `https://www.pornhub.com/video/search?search=${encodeURIComponent(query)}`
    } else if (site && site.includes('xvideos')) {
      searchUrl = `https://www.xvideos.com/?k=${encodeURIComponent(query)}`
    } else if (site && site.includes('spankbang')) {
      searchUrl = `https://spankbang.com/s/${encodeURIComponent(query)}/`
    } else {
      // Default: YouTube search
      searchUrl = `ytsearch${limit}:${query}`
    }

    return this._fetchPlaylist(searchUrl, limit)
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
      ['--dump-json', '--playlist-end', String(limit), '--no-download', url],
      { timeout: YTDLP_SEARCH_TIMEOUT }
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

    const child = spawn('yt-dlp', ['--dump-json', '--playlist-end', String(limit), searchUrl])

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
