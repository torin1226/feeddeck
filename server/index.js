import express from 'express'
import cors from 'cors'
import { networkInterfaces } from 'os'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { initDatabase, db } from './database.js'
import { registry, scraper as scraperAdapter, closeAllSources } from './sources/index.js'
import { logger } from './logger.js'

// Route modules
import streamRoutes from './routes/stream.js'
import libraryRoutes from './routes/library.js'
import recommendationRoutes from './routes/recommendations.js'
import contentRoutes, { refillCategory } from './routes/content.js'
import feedRoutes, { setRefillFeedCache } from './routes/feed.js'
import tiktokRoutes from './routes/tiktok.js'
import creatorsRoutes from './routes/creators.js'
import subscriptionBackupRoutes from './routes/subscription-backup.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ============================================================
// Backend Server
// Minimal Express API — routes live in server/routes/*.js
// Runs on port 3001 (Vite proxies /api → here)
// ============================================================

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json())

// In production, serve the built Vite frontend
const distPath = join(__dirname, '..', 'dist')
if (existsSync(distPath)) {
  app.use(express.static(distPath))
}

// Mount route modules
app.use(streamRoutes)
app.use(libraryRoutes)
app.use(recommendationRoutes)
app.use(contentRoutes)
app.use(feedRoutes)
app.use(tiktokRoutes)
app.use(creatorsRoutes)
app.use(subscriptionBackupRoutes)

// SPA catch-all: serve index.html for non-API routes (client-side routing)
if (existsSync(distPath)) {
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(join(distPath, 'index.html'))
    }
  })
}

// -----------------------------------------------------------
// Background tasks: feed cache refill
// -----------------------------------------------------------
const feedRefillInFlight = new Set()
async function refillFeedCache(mode) {
  if (feedRefillInFlight.has(mode)) return
  feedRefillInFlight.add(mode)
  try { await _refillFeedCacheImpl(mode) } finally { feedRefillInFlight.delete(mode) }
}

// Inject refillFeedCache into feed routes (avoids circular dependency)
setRefillFeedCache(refillFeedCache)

async function _refillFeedCacheImpl(mode) {
  const sources = db.prepare(
    'SELECT domain, label, query, fetch_interval FROM sources WHERE mode = ? AND active = 1'
  ).all(mode)

  if (sources.length === 0) return

  // Get liked tags for personalization
  let likedTags = []
  try {
    likedTags = db.prepare(
      "SELECT tag FROM tag_preferences WHERE preference = 'liked'"
    ).all().map(r => r.tag)
  } catch { /* tag_preferences may not exist yet */ }

  for (const src of sources) {
    logger.info(`  🔄 Refilling feed: ${src.label} (${mode})`)

    try {
      // Personalize query by mixing in random liked tags
      // Skip personalization for __creators__ sentinel — CreatorAdapter needs the exact string
      let query = src.query
      if (likedTags.length > 0 && !src.query.startsWith('__')) {
        const picked = likedTags.sort(() => Math.random() - 0.5).slice(0, 2)
        query = `${src.query} ${picked.join(' ')}`
        logger.info(`  🎯 Personalized feed query: "${query}"`)
      }
      // Use registry search with fallback chain (scraper → yt-dlp)
      const videos = await registry.search(query, { site: src.domain, limit: 20 })

      const insert = db.prepare(`
        INSERT OR IGNORE INTO feed_cache (id, source_domain, mode, url, stream_url, title, creator, thumbnail, duration, orientation, tags, fetched_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now', '+6 hours'))
      `)

      let added = 0
      const newVideoUrls = []
      for (const v of videos) {
        try {
          const tags = Array.isArray(v.tags) ? JSON.stringify(v.tags) : (v.tags || '[]')
          const result = insert.run(
            v.id,
            src.domain,
            mode,
            v.url,
            v.stream_url || null,
            v.title,
            v.uploader,
            v.thumbnail,
            v.duration,
            v.orientation,
            tags
          )
          if (result.changes > 0) {
            added++
            // Skip yt-dlp pre-resolution for videos that already have a direct stream URL
            if (v.url && !v.stream_url) newVideoUrls.push(v.url)
          }
        } catch { /* skip duplicates */ }
      }
      // Update last_fetched timestamp
      db.prepare('UPDATE sources SET last_fetched = datetime(\'now\') WHERE domain = ?').run(src.domain)
      logger.info(`  ✅ Added ${added} feed videos from ${src.label}`)

      // Pre-resolve stream URLs for newly added videos (2.8 Tier 1)
      if (newVideoUrls.length > 0) {
        logger.info(`  🔗 Pre-resolving stream URLs for ${newVideoUrls.length} new videos...`)
        await _preResolveStreamUrls(newVideoUrls)
      }
    } catch (err) {
      logger.error(`  ❌ Feed refill failed for ${src.label}:`, { error: err.message })
    }
  }
}

// -----------------------------------------------------------
// Pre-resolve stream URLs for a batch of video page URLs.
// -----------------------------------------------------------
const STREAM_RESOLVE_CONCURRENCY = 3
async function _preResolveStreamUrls(videoUrls) {
  const updateStmt = db.prepare(
    `UPDATE feed_cache SET stream_url = ?, expires_at = datetime('now', '+2 hours') WHERE url = ?`
  )

  let resolved = 0, failed = 0

  for (let i = 0; i < videoUrls.length; i += STREAM_RESOLVE_CONCURRENCY) {
    const batch = videoUrls.slice(i, i + STREAM_RESOLVE_CONCURRENCY)
    const results = await Promise.allSettled(
      batch.map(async (url) => {
        const cdnUrl = await registry.getStreamUrl(url)
        updateStmt.run(cdnUrl, url)
        return cdnUrl
      })
    )

    for (const r of results) {
      if (r.status === 'fulfilled') resolved++
      else failed++
    }
  }

  logger.info(`  🔗 Stream URLs resolved: ${resolved} OK, ${failed} failed`)
}

// -----------------------------------------------------------
// Scheduled background tasks
// -----------------------------------------------------------
function startScheduledFeedRefill() {
  const CHECK_INTERVAL = 60_000
  return setInterval(() => {
    try {
      const stale = db.prepare(`
        SELECT domain, mode, label FROM sources
        WHERE active = 1
          AND (last_fetched IS NULL
               OR datetime(last_fetched, '+' || fetch_interval || ' seconds') < datetime('now'))
      `).all()
      for (const src of stale) {
        refillFeedCache(src.mode).catch(err =>
          logger.error(`Scheduled refill error (${src.label}):`, { error: err.message })
        )
      }
    } catch (err) {
      logger.error('Scheduled refill check error:', { error: err.message })
    }
  }, CHECK_INTERVAL)
}

function startScheduledTrendingRefresh() {
  const TRENDING_INTERVAL = 30 * 60_000
  const sites = scraperAdapter.supportedDomains
  let siteIndex = 0

  const sfwCategories = db.prepare("SELECT key FROM categories WHERE mode = 'social'").all()
  let sfwCatIndex = 0

  return setInterval(async () => {
    const site = sites[siteIndex % sites.length]
    siteIndex++

    logger.info(`  📡 Scheduled trending refresh: ${site}`)

    try {
      const videos = await scraperAdapter.fetchTrending({ site, limit: 20 })
      const insert = db.prepare(`
        INSERT OR IGNORE INTO homepage_cache (id, category_key, url, title, thumbnail, duration, source, uploader, view_count, tags, fetched_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now', '+24 hours'))
      `)
      let added = 0
      for (const v of videos) {
        try {
          insert.run(v.id, 'nsfw_trending', v.url, v.title, v.thumbnail, v.duration, v.source || site, v.uploader, v.view_count, JSON.stringify(v.tags || []))
          added++
        } catch { /* skip duplicates */ }
      }
      logger.info(`  ✅ Trending refresh: added ${added} videos from ${site}`)
    } catch (err) {
      logger.error(`  ❌ Trending refresh failed for ${site}:`, { error: err.message })
    }

    if (sfwCategories.length > 0) {
      const sfwCat = sfwCategories[sfwCatIndex % sfwCategories.length]
      sfwCatIndex++
      refillCategory(sfwCat.key).catch(err =>
        logger.error(`  ❌ SFW refresh error (${sfwCat.key}):`, { error: err.message })
      )
    }
  }, TRENDING_INTERVAL)
}

function startStreamUrlTTLMonitor() {
  const TTL_CHECK_INTERVAL = 5 * 60_000
  return setInterval(async () => {
    try {
      const cleared = db.prepare(`
        UPDATE feed_cache SET stream_url = NULL, expires_at = NULL
        WHERE stream_url IS NOT NULL
          AND expires_at IS NOT NULL
          AND expires_at < datetime('now')
      `).run()
      if (cleared.changes > 0) {
        logger.info(`  🧹 TTL monitor: cleared ${cleared.changes} expired stream URLs`)
      }

      const expiring = db.prepare(`
        SELECT url FROM feed_cache
        WHERE stream_url IS NOT NULL
          AND expires_at IS NOT NULL
          AND expires_at <= datetime('now', '+15 minutes')
          AND expires_at > datetime('now')
        LIMIT 10
      `).all()

      if (expiring.length === 0) return

      logger.info(`  🔄 TTL monitor: ${expiring.length} stream URLs expiring soon, re-resolving...`)
      await _preResolveStreamUrls(expiring.map(v => v.url))
    } catch (err) {
      logger.error('TTL monitor error:', { error: err.message })
    }
  }, TTL_CHECK_INTERVAL)
}

// -----------------------------------------------------------
// Process-level crash handlers
// -----------------------------------------------------------
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack })
  process.exit(1)
})
process.on('unhandledRejection', (reason) => {
  logger.warn('Unhandled rejection', { reason: String(reason) })
})
const _intervalIds = []
process.on('SIGTERM', async () => {
  logger.info('Shutting down...')
  for (const id of _intervalIds) clearInterval(id)
  await closeAllSources()
  db.close()
  process.exit(0)
})

// -----------------------------------------------------------
// Start server
// -----------------------------------------------------------
initDatabase()

app.listen(PORT, '0.0.0.0', () => {
  logger.info(`\n  📡 Server running at http://localhost:${PORT}`)

  try {
    const nets = networkInterfaces()
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          logger.info(`     Network: http://${net.address}:${PORT}`)
        }
      }
    }
  } catch {}

  logger.info(`     Health check: http://localhost:${PORT}/api/health\n`)

  // Flush stale stream URLs from previous session.
  // Exempt sources whose CDN URLs are long-lived (FikFap ~1yr TTL, RedGifs direct MP4s).
  // yt-dlp resolved URLs (googlevideo, CDN-signed with short TTL) must be cleared on restart.
  const LONG_LIVED_STREAM_DOMAINS = ['fikfap.com', 'redgifs.com']
  const flushExclusions = LONG_LIVED_STREAM_DOMAINS.map(() => '?').join(', ')
  try {
    const flushedFeed = db.prepare(
      `UPDATE feed_cache SET stream_url = NULL, expires_at = NULL
       WHERE stream_url IS NOT NULL AND source_domain NOT IN (${flushExclusions})`
    ).run(...LONG_LIVED_STREAM_DOMAINS)
    if (flushedFeed.changes) {
      logger.info(`  🧹 Flushed ${flushedFeed.changes} stale stream URLs from feed_cache`)
    }
  } catch (err) {
    logger.warn('Stream URL flush failed:', { error: err.message })
  }

  // Purge orphaned homepage_cache rows from old 'nsfw-trending' key typo (fixed 2026-04-15)
  try {
    const purged = db.prepare("DELETE FROM homepage_cache WHERE category_key = 'nsfw-trending'").run()
    if (purged.changes) {
      logger.info(`  🧹 Purged ${purged.changes} orphaned homepage_cache rows (old nsfw-trending key)`)
    }
  } catch (err) {
    logger.warn('Orphaned row cleanup failed:', { error: err.message })
  }

  _intervalIds.push(startScheduledFeedRefill())
  _intervalIds.push(startScheduledTrendingRefresh())
  _intervalIds.push(startStreamUrlTTLMonitor())

  // First-boot population
  const cacheCount = db.prepare('SELECT COUNT(*) as n FROM homepage_cache').get()
  if (cacheCount.n === 0) {
    logger.info('  🚀 First boot: populating homepage cache...')
    const allCats = db.prepare('SELECT key FROM categories').all()
    ;(async () => {
      for (const cat of allCats) {
        try {
          await refillCategory(cat.key)
        } catch (err) {
          logger.error(`  First boot refill error (${cat.key}):`, { error: err.message })
        }
      }
      logger.info('  ✅ First boot: homepage cache population complete')
    })()
  }
})
