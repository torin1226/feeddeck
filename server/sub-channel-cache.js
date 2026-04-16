// ============================================================
// Subscription Channel Cache
// Stores channel names/URLs from successful authenticated
// subscription feed loads. When YouTube cookies expire, these
// cached channels are used to build keyword-search fallback
// queries instead of returning nothing.
// ============================================================

import { db } from './database.js'
import { logger } from './logger.js'

// Maximum channels to query in fallback mode (prevents throttling)
const MAX_FALLBACK_CHANNELS = 20

/**
 * Record channels seen in a successful subscription feed fetch.
 * Called after yt-dlp returns videos from /feed/subscriptions.
 * @param {Array} videos - normalized video objects from yt-dlp
 * @param {Array} rawEntries - raw yt-dlp JSON entries (has channel_id, channel_url)
 */
export function cacheSubscriptionChannels(rawEntries) {
  if (!rawEntries || rawEntries.length === 0) return

  try {
    const upsert = db.prepare(`
      INSERT INTO sub_channels (channel_id, channel_name, channel_url, last_seen, video_count)
      VALUES (?, ?, ?, datetime('now'), 1)
      ON CONFLICT(channel_id) DO UPDATE SET
        channel_name = excluded.channel_name,
        channel_url = excluded.channel_url,
        last_seen = datetime('now'),
        video_count = video_count + 1
    `)

    let cached = 0
    for (const raw of rawEntries) {
      const channelId = raw.channel_id || raw.uploader_id
      const channelName = raw.channel || raw.uploader || raw.creator
      const channelUrl = raw.channel_url || raw.uploader_url

      if (!channelId || !channelName) continue

      upsert.run(
        channelId,
        channelName,
        channelUrl || `https://www.youtube.com/channel/${channelId}`,
      )
      cached++
    }

    if (cached > 0) {
      logger.info(`sub-channel-cache: cached ${cached} channels from subscription feed`)
    }
  } catch (err) {
    logger.warn('sub-channel-cache: failed to cache channels', { error: err.message })
  }
}

/**
 * Check if we have cached subscription channels to fall back to.
 * Also checks subscription_backups table for YouTube entries.
 */
export function hasCachedChannels() {
  try {
    const cached = db.prepare('SELECT COUNT(*) as n FROM sub_channels').get().n
    if (cached > 0) return true
    // Fall back to subscription_backups table
    const backed = db.prepare("SELECT COUNT(*) as n FROM subscription_backups WHERE platform = 'youtube'").get().n
    return backed > 0
  } catch {
    return false
  }
}

/**
 * Get the count of cached channels.
 */
export function getCachedChannelCount() {
  try {
    return db.prepare('SELECT COUNT(*) as n FROM sub_channels').get().n
  } catch {
    return 0
  }
}

/**
 * Build fallback search queries from cached subscription channels.
 * Returns an array of yt-dlp search strings like:
 *   ["ytsearch3:ChannelName latest", ...]
 *
 * Strategy: pick top N channels by video_count (most active in feed),
 * request a few results each, cap total to limit.
 *
 * @param {number} limit - total videos desired
 * @returns {{ queries: string[], channelNames: string[], isFallback: true }}
 */
export function buildSubscriptionFallbackQueries(limit = 12) {
  try {
    // Get most-seen channels, prioritizing recently seen ones
    let channels = db.prepare(`
      SELECT channel_id, channel_name, channel_url, video_count
      FROM sub_channels
      ORDER BY video_count DESC, last_seen DESC
      LIMIT ?
    `).all(MAX_FALLBACK_CHANNELS)

    // If sub_channels cache is empty, pull from subscription_backups
    if (channels.length === 0) {
      try {
        const backups = db.prepare(`
          SELECT handle AS channel_name, profile_url AS channel_url, platform_id AS channel_id
          FROM subscription_backups
          WHERE platform = 'youtube'
          ORDER BY RANDOM()
          LIMIT ?
        `).all(MAX_FALLBACK_CHANNELS)
        channels = backups.map(b => ({ ...b, video_count: 1 }))
        if (channels.length > 0) {
          logger.info(`sub-channel-cache: using ${channels.length} channels from subscription_backups`)
        }
      } catch {}
    }

    if (channels.length === 0) {
      return { queries: [], channelNames: [], isFallback: true }
    }

    // Distribute limit across channels: at least 2 per channel
    const perChannel = Math.max(2, Math.ceil(limit / channels.length))

    const queries = channels.map(ch => {
      // Use channel URL directly if available (more reliable than search)
      if (ch.channel_url && ch.channel_url.startsWith('http')) {
        return ch.channel_url
      }
      // Fallback to keyword search with channel name
      return `ytsearch${perChannel}:${ch.channel_name} latest`
    })

    const channelNames = channels.map(ch => ch.channel_name)

    return { queries, channelNames, isFallback: true }
  } catch (err) {
    logger.warn('sub-channel-cache: failed to build fallback queries', { error: err.message })
    return { queries: [], channelNames: [], isFallback: true }
  }
}
