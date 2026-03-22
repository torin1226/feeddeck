// ============================================================
// Source Registry
// Central dispatch for all content adapters. Routes requests
// to the right adapter based on domain, with automatic fallback
// when a source fails. This is the key to eliminating yt-dlp
// as a single point of failure.
// ============================================================

import { logger } from '../logger.js'

const MAX_CONSECUTIVE_FAILURES = 5
const DISABLE_DURATION_MS = 5 * 60 * 1000 // 5 minutes

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

    // Per-adapter error tracking: { adapterName: { successes, failures, consecutiveFailures, lastError, lastSuccess, disabledUntil } }
    this.stats = {}
  }

  register(adapter, options = {}) {
    this.adapters.push(adapter)

    // Initialize stats
    this.stats[adapter.name] = {
      successes: 0,
      failures: 0,
      consecutiveFailures: 0,
      lastError: null,
      lastSuccess: null,
      disabledUntil: null,
    }

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

    logger.info(`Registered adapter: ${adapter.name}`, { domains: adapter.supportedDomains })
  }

  // Record a successful operation for an adapter
  recordSuccess(adapterName) {
    const s = this.stats[adapterName]
    if (!s) return
    s.successes++
    s.consecutiveFailures = 0
    s.lastSuccess = new Date().toISOString()
    s.disabledUntil = null
  }

  // Record a failed operation for an adapter
  recordFailure(adapterName, error) {
    const s = this.stats[adapterName]
    if (!s) return
    s.failures++
    s.consecutiveFailures++
    s.lastError = { message: error, time: new Date().toISOString() }

    // Auto-disable after too many consecutive failures
    if (s.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && !s.disabledUntil) {
      s.disabledUntil = new Date(Date.now() + DISABLE_DURATION_MS).toISOString()
      logger.warn(`Adapter auto-disabled: ${adapterName}`, { cooldownSec: DISABLE_DURATION_MS / 1000, consecutiveFailures: s.consecutiveFailures })
    }
  }

  // Check if an adapter is currently disabled
  isDisabled(adapterName) {
    const s = this.stats[adapterName]
    if (!s?.disabledUntil) return false
    if (new Date() >= new Date(s.disabledUntil)) {
      // Cooldown expired, re-enable
      s.disabledUntil = null
      s.consecutiveFailures = 0
      logger.info(`Adapter re-enabled after cooldown: ${adapterName}`)
      return false
    }
    return true
  }

  // Manually re-enable a disabled adapter
  reenableAdapter(adapterName) {
    const s = this.stats[adapterName]
    if (!s) return false
    s.disabledUntil = null
    s.consecutiveFailures = 0
    return true
  }

  // Get stats for all adapters
  getStats() {
    return { ...this.stats }
  }

  // Find the best adapter for a domain
  getAdapter(domain) {
    return this.adapters.find(a => a.handlesDomain(domain) && !this.isDisabled(a.name))
  }

  // Get all adapters with a specific capability
  getAdaptersWithCapability(capability) {
    return this.adapters.filter(a => a.capabilities[capability])
  }

  // List all registered adapters
  listAdapters() {
    return this.adapters
  }

  // Execute with fallback: try each adapter in the chain until one works
  async withFallback(capability, fn) {
    const chain = this.fallbackChains[capability] || []
    const errors = []

    for (const adapter of chain) {
      if (this.isDisabled(adapter.name)) {
        errors.push({ adapter: adapter.name, error: 'temporarily disabled' })
        continue
      }

      try {
        const result = await fn(adapter)
        this.recordSuccess(adapter.name)
        return result
      } catch (err) {
        this.recordFailure(adapter.name, err.message)
        errors.push({ adapter: adapter.name, error: err.message })
        logger.warn(`${adapter.name} failed for ${capability}`, { error: err.message })
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
        const result = await specific.extractMetadata(url)
        this.recordSuccess(specific.name)
        return result
      } catch (err) {
        this.recordFailure(specific.name, err.message)
        logger.warn(`${specific.name} metadata failed, trying fallbacks`, { error: err.message })
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
        const result = await specific.getStreamUrl(url)
        this.recordSuccess(specific.name)
        return result
      } catch (err) {
        this.recordFailure(specific.name, err.message)
        logger.warn(`${specific.name} stream URL failed, trying fallbacks`, { error: err.message })
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
      if (adapter && !this.isDisabled(adapter.name)) {
        try {
          const result = await adapter.search(query, options)
          this.recordSuccess(adapter.name)
          return result
        } catch (err) {
          this.recordFailure(adapter.name, err.message)
          throw err
        }
      }
    }

    // If a site was specified, find its adapter
    if (site) {
      const adapter = this.getAdapter(site)
      if (adapter?.capabilities.search) {
        try {
          const result = await adapter.search(query, options)
          this.recordSuccess(adapter.name)
          return result
        } catch (err) {
          this.recordFailure(adapter.name, err.message)
          // Fall through to chain
        }
      }
    }

    // Otherwise, use the first adapter with search capability
    return this.withFallback('search', adapter => adapter.search(query, options))
  }
}

// Singleton instance
export const registry = new SourceRegistry()
