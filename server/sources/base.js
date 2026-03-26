// ============================================================
// Base Source Adapter
// All content sources implement this interface. The registry
// picks the right adapter based on domain, with fallback chains
// so no single source is a single point of failure.
// ============================================================

import { randomUUID } from 'crypto'

export class SourceAdapter {
  constructor(config = {}) {
    this.name = config.name || 'unknown'
    this.supportedDomains = config.supportedDomains || []
    this.capabilities = {
      search: false,       // Can search by query
      categories: false,   // Can browse categories
      trending: false,     // Can fetch trending content
      metadata: false,     // Can extract video metadata from URL
      streamUrl: false,    // Can resolve direct stream URLs
      ...config.capabilities,
    }
  }

  // Discovery methods (finding new content)
  async search(query, options = {}) {
    throw new Error(`${this.name}: search() not implemented`)
  }

  async fetchCategory(categoryUrl, options = {}) {
    throw new Error(`${this.name}: fetchCategory() not implemented`)
  }

  async fetchTrending(options = {}) {
    throw new Error(`${this.name}: fetchTrending() not implemented`)
  }

  // Extraction methods (getting details for a known URL)
  async extractMetadata(url) {
    throw new Error(`${this.name}: extractMetadata() not implemented`)
  }

  async getStreamUrl(url) {
    throw new Error(`${this.name}: getStreamUrl() not implemented`)
  }

  // Check if this adapter handles a given domain
  handlesDomain(domain) {
    return this.supportedDomains.some(d =>
      domain === d || domain.endsWith('.' + d)
    )
  }

  // Normalize yt-dlp / scraper output into our standard video shape
  normalizeVideo(raw) {
    return {
      id: raw.id || randomUUID(),
      url: raw.webpage_url || raw.url || '',
      title: raw.title || 'Untitled',
      thumbnail: raw.thumbnail || raw.thumbnails?.[0]?.url || '',
      duration: raw.duration || 0,
      source: raw.extractor || raw.source || this.name,
      uploader: raw.uploader || raw.channel || raw.creator || '',
      view_count: raw.view_count || 0,
      tags: raw.tags || [],
      upload_date: raw.upload_date || '',
      orientation: (raw.height && raw.width && raw.height > raw.width) ? 'vertical' : 'horizontal',
    }
  }
}
