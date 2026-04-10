// ============================================================
// Source Registry
// Central dispatch for all content adapters. Routes requests
// to the right adapter based on domain, with automatic fallback
// when a source fails. This is the key to eliminating yt-dlp
// as a single point of failure.
//
// Error tracking is per-adapter AND per-capability so that
// search failures (e.g. unsupported NSFW URLs) don't disable
// stream URL resolution for YouTube videos.
// ============================================================

import { logger } from '../logger.js'

const MAX_CONSECUTIVE_FAILURES = 10
const DISABLE_DURATION_MS = 2 * 60 * 1000 // 2 minutes

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

    // Per-adapter stats (aggregate, for health endpoint display)
    this.stats = {}

    // Per-adapter per-capability failure tracking for auto-disable
    // Key: "adapterName:capability", Value: { consecutiveFailures, disabledUntil }
    this._capStats = {}
  }

  register(adapter, options = {}) {
    this.adapters.push(adapter)

    // Initialize aggregate stats
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

  // Get or create per-capability stats
  _getCapStat(adapterName, capability) {
    const key = `${adapterName}:${capability}`
    if (!this._capStats[key]) {
      this._capStats[key] = { consecutiveFailures: 0, disabledUntil: null }
    }
    return this._capStats[key]
  }

  // Record a successful operation for an adapter (resets failure count for that capability)
  recordSuccess(adapterName, capability) {
    const s = this.stats[adapterName]
    if (!s) return
    s.successes++
    s.consecutiveFailures = 0
    s.lastSuccess = new Date().toISOString()
    s.disabledUntil = null

    if (capability) {
      const cs = this._getCapStat(adapterName, capability)
      cs.consecutiveFailures = 0
      cs.disabledUntil = null
    }
  }

  // Record a failed operation for an adapter (increments per-capability failure count)
  recordFailure(adapterName, error, capability) {
    const s = this.stats[adapterName]
    if (!s) return
    s.failures++
    s.consecutiveFailures++
    s.lastError = { message: error, time: new Date().toISOString() }

    if (capability) {
      const cs = this._getCapStat(adapterName, capability)
      cs.consecutiveFailures++

      // Auto-disable this capability after too many consecutive failures
      if (cs.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && !cs.disabledUntil) {
        cs.disabledUntil = new Date(Date.now() + DISABLE_DURATION_MS).toISOString()
        logger.warn(`Adapter capability auto-disabled: ${adapterName}:${capability}`, {
          cooldownSec: DISABLE_DURATION_MS / 1000,
          consecutiveFailures: cs.consecutiveFailures,
        })
      }
    }
  }

  // Check if an adapter is disabled (globally or for a specific capability)
  isDisabled(adapterName, capability) {
    // Check per-capability disable first
    if (capability) {
      const cs = this._getCapStat(adapterName, capability)
      if (cs.disabledUntil) {
        if (new Date() >= new Date(cs.disabledUntil)) {
          cs.disabledUntil = null
          cs.consecutiveFailures = 0
          logger.info(`Adapter capability re-enabled after cooldown: ${adapterName}:${capability}`)
          return false
        }
        return true
      }
      return false
    }

    // Legacy: check aggregate stats (for health endpoint compat)
    const s = this.stats[adapterName]
    if (!s?.disabledUntil) return false
    if (new Date() >= new Date(s.disabledUntil)) {
      s.disabledUntil = null
      s.consecutiveFailures = 0
      logger.info(`Adapter re-enabled after cooldown: ${adapterName}`)
      return false
    }
    return true
  }

  // Manually re-enable a disabled adapter (all capabilities)
  reenableAdapter(adapterName) {
    const s = this.stats[adapterName]
    if (!s) return false
    s.disabledUntil = null
    s.consecutiveFailures = 0

    // Also re-enable all capabilities
    for (const key of Object.keys(this._capStats)) {
      if (key.startsWith(adapterName + ':')) {
        this._capStats[key].disabledUntil = null
        this._capStats[key].consecutiveFailures = 0
      }
    }
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
      if (this.isDisabled(adapter.name, capability)) {
        errors.push({ adapter: adapter.name, error: `temporarily disabled (${capability})` })
        continue
      }

      try {
        const result = await fn(adapter)
        this.recordSuccess(adapter.name, capability)
        return result
      } catch (err) {
        this.recordFailure(adapter.name, err.message, capability)
        errors.push({ adapter: adapter.name, error: err.message })
        logger.warn(`${adapter.name} failed for ${capability}`, { error: err.message })
      }
    }

    throw new Error(
      `All adapters failed for ${capability}: ${errors.map(e => `${e.adapter}: ${e.error}`).join('; ')}`
    )
  }

  // Convenience: extract metadata with fallback
  async extractMetadata(url, options = {}) {
    const domain = new URL(url).hostname.replace(/^www\./, '')
    const specific = this.getAdapter(domain)

    // Try domain-specific adapter first
    if (specific?.capabilities.metadata && !this.isDisabled(specific.name, 'metadata')) {
      try {
        const result = await specific.extractMetadata(url, options)
        this.recordSuccess(specific.name, 'metadata')
        return result
      } catch (err) {
        this.recordFailure(specific.name, err.message, 'metadata')
        logger.warn(`${specific.name} metadata failed, trying fallbacks`, { error: err.message })
      }
    }

    // Fall back through the chain
    return this.withFallback('metadata', adapter => adapter.extractMetadata(url, options))
  }

  // Convenience: get stream URL with fallback
  async getStreamUrl(url, options = {}) {
    const domain = new URL(url).hostname.replace(/^www\./, '')
    const specific = this.getAdapter(domain)

    if (specific?.capabilities.streamUrl && !this.isDisabled(specific.name, 'streamUrl')) {
      try {
        const result = await specific.getStreamUrl(url, options)
        this.recordSuccess(specific.name, 'streamUrl')
        return result
      } catch (err) {
        this.recordFailure(specific.name, err.message, 'streamUrl')
        logger.warn(`${specific.name} stream URL failed, trying fallbacks`, { error: err.message })
      }
    }

    return this.withFallback('streamUrl', adapter => adapter.getStreamUrl(url, options))
  }

  // Convenience: search with a specific adapter or first available
  async search(query, options = {}) {
    const { adapter: adapterName, site } = options

    // If a specific adapter was requested, use only that adapter (no fallback)
    if (adapterName) {
      const adapter = this.adapters.find(a => a.name === adapterName)
      if (!adapter) throw new Error(`Adapter not found: ${adapterName}`)
      if (this.isDisabled(adapter.name, 'search')) throw new Error(`${adapterName} is temporarily disabled`)
      try {
        const result = await adapter.search(query, options)
        this.recordSuccess(adapter.name, 'search')
        return result
      } catch (err) {
        this.recordFailure(adapter.name, err.message, 'search')
        throw err
      }
    }

    // If a site was specified, find its adapter
    if (site) {
      const adapter = this.getAdapter(site)
      if (adapter?.capabilities.search && !this.isDisabled(adapter.name, 'search')) {
        try {
          const result = await adapter.search(query, options)
          this.recordSuccess(adapter.name, 'search')
          return result
        } catch (err) {
          this.recordFailure(adapter.name, err.message, 'search')
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
