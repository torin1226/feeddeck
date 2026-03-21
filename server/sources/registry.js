// ============================================================
// Source Registry
// Central dispatch for all content adapters. Routes requests
// to the right adapter based on domain, with automatic fallback
// when a source fails. This is the key to eliminating yt-dlp
// as a single point of failure.
// ============================================================

export class SourceRegistry {
  constructor() {
    // Ordered list of adapters (first match wins for domain lookups)
    this.adapters = []

    // Fallback chains: if primary fails, try these in order
    // Key: capability name, Value: ordered list of adapter names
    this.fallbackChains = {
      metadata: [],
      streamUrl: [],
      search: [],
    }
  }

  register(adapter, options = {}) {
    this.adapters.push(adapter)

    // Add to fallback chains based on capabilities
    for (const [cap, enabled] of Object.entries(adapter.capabilities)) {
      if (enabled && this.fallbackChains[cap]) {
        if (options.primary) {
          this.fallbackChains[cap].unshift(adapter)
        } else {
          this.fallbackChains[cap].push(adapter)
        }
      }
    }

    console.log(`  📎 Registered adapter: ${adapter.name} (${adapter.supportedDomains.join(', ')})`)
  }

  // Find the best adapter for a domain
  getAdapter(domain) {
    return this.adapters.find(a => a.handlesDomain(domain))
  }

  // Get all adapters with a specific capability
  getAdaptersWithCapability(capability) {
    return this.adapters.filter(a => a.capabilities[capability])
  }

  // Execute with fallback: try each adapter in the chain until one works
  async withFallback(capability, fn) {
    const chain = this.fallbackChains[capability] || []
    const errors = []

    for (const adapter of chain) {
      try {
        return await fn(adapter)
      } catch (err) {
        errors.push({ adapter: adapter.name, error: err.message })
        console.warn(`  ⚠️  ${adapter.name} failed for ${capability}: ${err.message}`)
      }
    }

    throw new Error(
      `All adapters failed for ${capability}: ${errors.map(e => `${e.adapter}: ${e.error}`).join('; ')}`
    )
  }

  // Convenience: extract metadata with fallback
  async extractMetadata(url) {
    const domain = new URL(url).hostname.replace(/^www\./, '')
    const specific = this.getAdapter(domain)

    // Try domain-specific adapter first
    if (specific?.capabilities.metadata) {
      try {
        return await specific.extractMetadata(url)
      } catch (err) {
        console.warn(`  ⚠️  ${specific.name} metadata failed, trying fallbacks: ${err.message}`)
      }
    }

    // Fall back through the chain
    return this.withFallback('metadata', adapter => adapter.extractMetadata(url))
  }

  // Convenience: get stream URL with fallback
  async getStreamUrl(url) {
    const domain = new URL(url).hostname.replace(/^www\./, '')
    const specific = this.getAdapter(domain)

    if (specific?.capabilities.streamUrl) {
      try {
        return await specific.getStreamUrl(url)
      } catch (err) {
        console.warn(`  ⚠️  ${specific.name} stream URL failed, trying fallbacks: ${err.message}`)
      }
    }

    return this.withFallback('streamUrl', adapter => adapter.getStreamUrl(url))
  }

  // Convenience: search with a specific adapter or first available
  async search(query, options = {}) {
    const { adapter: adapterName, site } = options

    // If a specific adapter was requested, use it
    if (adapterName) {
      const adapter = this.adapters.find(a => a.name === adapterName)
      if (adapter) return adapter.search(query, options)
    }

    // If a site was specified, find its adapter
    if (site) {
      const adapter = this.getAdapter(site)
      if (adapter?.capabilities.search) {
        return adapter.search(query, options)
      }
    }

    // Otherwise, use the first adapter with search capability
    return this.withFallback('search', adapter => adapter.search(query, options))
  }
}

// Singleton instance
export const registry = new SourceRegistry()
