#!/usr/bin/env node
// ============================================================
// Cache Warming Script
// Standalone batch job that populates homepage and feed caches
// with fresh content and pre-resolves stream URLs.
//
// Usage:
//   npm run warm              # warm all modes
//   npm run warm:social       # social only
//   npm run warm:nsfw         # nsfw only
//
// Designed to run at midnight via scheduled task (laptop) or
// cron (Beelink). Does NOT start an Express server.
// ============================================================

import { dirname } from 'path'
import { fileURLToPath } from 'url'
import os from 'os'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Parse CLI args
const args = process.argv.slice(2)
const modeArg = args.find(a => a.startsWith('--mode='))?.split('=')[1]
  || (args.includes('--social') ? 'social' : null)
  || (args.includes('--nsfw') ? 'nsfw' : null)
  || 'all'
const dryRun = args.includes('--dry-run')
const isWindows = os.platform() === 'win32'
const CONCURRENCY = isWindows ? 2 : 3

console.log(`\n🔥 FeedDeck Cache Warmer`)
console.log(`   Mode: ${modeArg}`)
console.log(`   Concurrency: ${CONCURRENCY}`)
console.log(`   Platform: ${isWindows ? 'Windows (laptop)' : 'Linux (server)'}`)
console.log(`   Dry run: ${dryRun}\n`)

// Import project modules
const { initDatabase } = await import('../database.js')
const { registry, closeAllSources } = await import('../sources/index.js')

// Initialize database
initDatabase()

// Dynamic import to get the live db reference after init
const { db } = await import('../database.js')

// Cookie health check first
console.log('--- Cookie Health Check ---')
try {
  const { checkCookieHealth } = await import('../cookie-health.js')
  const health = await checkCookieHealth()
  const skipDomains = []
  for (const [domain, result] of Object.entries(health)) {
    const icon = result.status === 'healthy' ? '🟢' : result.status === 'expired' ? '🟡' : result.status === 'missing' ? '⚪' : '🔴'
    console.log(`  ${icon} ${result.message}`)
    if (result.status === 'expired' || result.status === 'error') {
      skipDomains.push(domain)
    }
  }
  if (skipDomains.length > 0) {
    console.log(`  ⚠️  Skipping domains with dead cookies: ${skipDomains.join(', ')}`)
  }
  console.log()
} catch (err) {
  console.log(`  ⚠️  Cookie check failed: ${err.message}\n`)
}

if (dryRun) {
  console.log('Dry run — exiting without fetching.\n')
  process.exit(0)
}

const stats = { categoriesRefilled: 0, feedRefilled: 0, streamUrlsResolved: 0, errors: 0 }
const startTime = Date.now()

// --- Phase 1: Refill homepage categories ---
console.log('--- Phase 1: Homepage Categories ---')
const modes = modeArg === 'all' ? ['social', 'nsfw'] : [modeArg]

for (const mode of modes) {
  const categories = db.prepare('SELECT key, query, mode FROM categories WHERE mode = ?').all(mode)
  console.log(`  ${mode}: ${categories.length} categories`)

  for (const cat of categories) {
    try {
      console.log(`    🔄 ${cat.key}...`)
      let videos
      let query = cat.query

      // Personalize with liked tags
      if (!query.startsWith('http')) {
        try {
          const likedTags = db.prepare(
            "SELECT tag FROM tag_preferences WHERE preference = 'liked' ORDER BY RANDOM() LIMIT 2"
          ).all().map(r => r.tag)
          if (likedTags.length > 0) query = `${query} ${likedTags.join(' ')}`
        } catch {}
      }

      if (cat.mode === 'nsfw' && query.startsWith('http')) {
        try {
          const domain = new URL(query).hostname.replace(/^www\./, '')
          videos = await registry.search(query, { site: domain, limit: 12 })
        } catch {
          videos = await registry.search(query, { adapter: 'yt-dlp', limit: 12 })
        }
      } else {
        videos = await registry.search(query, { adapter: 'yt-dlp', limit: 12 })
      }

      const insert = db.prepare(`
        INSERT OR IGNORE INTO homepage_cache (id, category_key, url, title, thumbnail, duration, source, uploader, view_count, tags, fetched_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now', '+7 days'))
      `)

      let added = 0
      for (const v of videos) {
        try {
          insert.run(v.id, cat.key, v.url, v.title, v.thumbnail, v.duration, v.source, v.uploader, v.view_count, JSON.stringify(v.tags || []))
          added++
        } catch {}
      }
      console.log(`    ✅ +${added} videos`)
      stats.categoriesRefilled++
    } catch (err) {
      console.log(`    ❌ ${err.message.substring(0, 80)}`)
      stats.errors++
    }
  }
}

// --- Phase 2: Refill feed sources ---
console.log('\n--- Phase 2: Feed Sources ---')
for (const mode of modes) {
  const sources = db.prepare('SELECT domain, label, query FROM sources WHERE mode = ? AND active = 1').all(mode)
  console.log(`  ${mode}: ${sources.length} active sources`)

  for (const src of sources) {
    try {
      console.log(`    🔄 ${src.label}...`)
      let query = src.query

      // Personalize
      try {
        const likedTags = db.prepare(
          "SELECT tag FROM tag_preferences WHERE preference = 'liked' ORDER BY RANDOM() LIMIT 2"
        ).all().map(r => r.tag)
        if (likedTags.length > 0) query = `${query} ${likedTags.join(' ')}`
      } catch {}

      const videos = await registry.search(query, { site: src.domain, limit: 20 })

      const insert = db.prepare(`
        INSERT OR IGNORE INTO feed_cache (id, source_domain, mode, url, title, creator, thumbnail, duration, orientation, tags, fetched_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now', '+6 hours'))
      `)

      let added = 0
      const newUrls = []
      for (const v of videos) {
        try {
          const tags = Array.isArray(v.tags) ? JSON.stringify(v.tags) : (v.tags || '[]')
          const result = insert.run(v.id, src.domain, mode, v.url, v.title, v.uploader, v.thumbnail, v.duration, v.orientation, tags)
          added++
          if (result.changes > 0 && v.url) newUrls.push(v.url)
        } catch {}
      }

      db.prepare("UPDATE sources SET last_fetched = datetime('now') WHERE domain = ?").run(src.domain)
      console.log(`    ✅ +${added} videos`)
      stats.feedRefilled++
    } catch (err) {
      console.log(`    ❌ ${err.message.substring(0, 80)}`)
      stats.errors++
    }
  }
}

// --- Phase 3: Pre-resolve stream URLs ---
console.log('\n--- Phase 3: Pre-resolve Stream URLs ---')
const unresolved = db.prepare(`
  SELECT url FROM feed_cache
  WHERE stream_url IS NULL AND url IS NOT NULL
  LIMIT 100
`).all()

console.log(`  ${unresolved.length} videos need stream URLs (concurrency: ${CONCURRENCY})`)

const updateStmt = db.prepare(
  `UPDATE feed_cache SET stream_url = ?, expires_at = datetime('now', '+2 hours') WHERE url = ?`
)

for (let i = 0; i < unresolved.length; i += CONCURRENCY) {
  const batch = unresolved.slice(i, i + CONCURRENCY)
  const results = await Promise.allSettled(
    batch.map(async ({ url }) => {
      const cdnUrl = await registry.getStreamUrl(url)
      updateStmt.run(cdnUrl, url)
      return cdnUrl
    })
  )

  for (const r of results) {
    if (r.status === 'fulfilled') stats.streamUrlsResolved++
    else stats.errors++
  }

  // Progress
  const done = Math.min(i + CONCURRENCY, unresolved.length)
  process.stdout.write(`  [${done}/${unresolved.length}] resolved: ${stats.streamUrlsResolved}, failed: ${stats.errors}\r`)
}
console.log()

// --- Summary ---
const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
console.log(`\n--- Summary ---`)
console.log(`  Categories refilled: ${stats.categoriesRefilled}`)
console.log(`  Feed sources refilled: ${stats.feedRefilled}`)
console.log(`  Stream URLs resolved: ${stats.streamUrlsResolved}`)
console.log(`  Errors: ${stats.errors}`)
console.log(`  Time: ${elapsed}s\n`)

// Cleanup
try { await closeAllSources() } catch {}
process.exit(stats.errors > 0 ? 1 : 0)
