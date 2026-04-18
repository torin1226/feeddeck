// ============================================================
// Base Source Adapter
// All content sources implement this interface. The registry
// picks the right adapter based on domain, with fallback chains
// so no single source is a single point of failure.
// ============================================================

import { randomUUID } from 'crypto'

// Convert various source date formats to ISO YYYY-MM-DD.
// yt-dlp returns YYYYMMDD strings. Reddit returns unix seconds.
// Other adapters may return unix ms or ISO already.
export function toIsoDate(raw) {
  if (raw === null || raw === undefined || raw === '') return null
  if (typeof raw === 'string' && /^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
  }
  const d = typeof raw === 'number'
    ? new Date(raw < 1e12 ? raw * 1000 : raw)
    : new Date(raw)
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

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
  async search(query, _options = {}) {
    throw new Error(`${this.name}: search() not implemented`)
  }

  async fetchCategory(categoryUrl, _options = {}) {
    throw new Error(`${this.name}: fetchCategory() not implemented`)
  }

  async fetchTrending(_options = {}) {
    throw new Error(`${this.name}: fetchTrending() not implemented`)
  }

  // Extraction methods (getting details for a known URL)
  async extractMetadata(_url) {
    throw new Error(`${this.name}: extractMetadata() not implemented`)
  }

  async getStreamUrl(_url) {
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
      thumbnail: raw.thumbnails?.at(-1)?.url || raw.thumbnail || '',
      duration: raw.duration || 0,
      source: raw.extractor || raw.source || this.name,
      uploader: raw.uploader || raw.channel || raw.creator || '',
      view_count: raw.view_count || 0,
      like_count: raw.like_count ?? null,
      subscriber_count: raw.channel_follower_count ?? raw.subscriber_count ?? null,
      tags: raw.tags || [],
      upload_date: toIsoDate(raw.upload_date ?? raw.timestamp ?? raw.created_utc),
      orientation: (raw.height && raw.width && raw.height > raw.width) ? 'vertical' : 'horizontal',
    }
  }
}
