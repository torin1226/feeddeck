// ============================================================
// Cobalt Adapter
// Uses cobalt.tools API for SFW video extraction as a fallback
// when yt-dlp fails. Cobalt supports YouTube, TikTok, Instagram,
// Twitter, Reddit, and others.
//
// PUBLIC API STATUS: The public api.cobalt.tools was shut down
// on Nov 11, 2024 (GitHub discussion #860). No free tier or
// registration exists. The web UI still works via Turnstile
// captcha, but the programmatic API is gone.
//
// SELF-HOSTED: Works without auth by default. Deploy via Docker
// (~4 steps). Set COBALT_API_URL env var to point at your
// instance. Optionally set COBALT_API_KEY if the instance has
// API_AUTH_REQUIRED=1.
//
// When no instance is configured, this adapter auto-disables.
// ============================================================

import { SourceAdapter } from './base.js'

const COBALT_API = process.env.COBALT_API_URL || 'https://api.cobalt.tools'
const COBALT_API_KEY = process.env.COBALT_API_KEY || ''
const REQUEST_TIMEOUT = 30_000

// Auto-disable if using default public API (requires Turnstile)
const IS_SELF_HOSTED = !!process.env.COBALT_API_URL

export class CobaltAdapter extends SourceAdapter {
  constructor() {
    super({
      name: 'cobalt',
      supportedDomains: [
        'youtube.com', 'youtu.be',
        'tiktok.com',
        'instagram.com',
        'twitter.com', 'x.com',
        'reddit.com',
        'vimeo.com',
        'twitch.tv',
        'soundcloud.com',
      ],
      capabilities: {
        search: false,
        categories: false,
        trending: false,
        // Only enable if self-hosted instance is configured
        metadata: IS_SELF_HOSTED,
        streamUrl: IS_SELF_HOSTED,
      },
    })
  }

  async _request(url) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)

    try {
      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      }
      if (COBALT_API_KEY) {
        headers['Authorization'] = `Api-Key ${COBALT_API_KEY}`
      }
      const response = await fetch(`${COBALT_API}/`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          url,
          videoQuality: '480',
          filenameStyle: 'pretty',
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`Cobalt API error ${response.status}: ${text}`)
      }

      return response.json()
    } finally {
      clearTimeout(timeout)
    }
  }

  async extractMetadata(url) {
    // Cobalt doesn't return rich metadata, but we can get the basics
    // from the URL itself and the API response
    const result = await this._request(url)

    return this.normalizeVideo({
      id: this._urlToId(url),
      webpage_url: url,
      title: (result.filename && typeof result.filename === 'string') ? result.filename : 'Untitled',
      source: new URL(url).hostname.replace(/^www\./, ''),
    })
  }

  async getStreamUrl(url) {
    const result = await this._request(url)

    if (result.url) {
      return result.url
    }

    // Cobalt sometimes returns a picker (multiple formats)
    if (result.picker && result.picker.length > 0) {
      // Pick the first video option
      const video = result.picker.find(p => p.type === 'video') || result.picker[0]
      if (!video?.url) throw new Error('Cobalt picker entry missing URL')
      return video.url
    }

    throw new Error('Cobalt returned no stream URL')
  }

  _urlToId(url) {
    return url.replace(/https?:\/\/(www\.)?/, '').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 64)
  }
}
