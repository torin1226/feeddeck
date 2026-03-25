// ============================================================
// Cobalt Adapter
// Uses cobalt.tools API for SFW video extraction as a fallback
// when yt-dlp fails. Cobalt supports YouTube, TikTok, Instagram,
// Twitter, Reddit, and others.
//
// Free API, no auth needed. Only handles publicly accessible content.
// Primarily an extraction tool (metadata + stream URLs), not discovery.
// ============================================================

import { SourceAdapter } from './base.js'

const COBALT_API = 'https://api.cobalt.tools'
const REQUEST_TIMEOUT = 30_000

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
        search: false,      // Cobalt doesn't do search
        categories: false,
        trending: false,
        metadata: true,     // Can extract basic metadata
        streamUrl: true,    // Can resolve direct stream URLs
      },
    })
  }

  async _request(url) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)

    try {
      const response = await fetch(`${COBALT_API}/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
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
