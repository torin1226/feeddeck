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
const MAX_RETRIES = 2

// Retry with exponential backoff for transient network failures
async function withRetry(label, fn) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err
      const delay = 1000 * 2 ** attempt
      console.log(`      ⏳ ${label} failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying in ${delay}ms: ${err.message.substring(0, 60)}`)
      await new Promise(r => setTimeout(r, delay))
    }
  }
}

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

// --- Phase 0: Purge stale homepage entries ---
// Must run before Phase 1 so INSERT OR IGNORE can add fresh content
// (stale IDs block new inserts otherwise)
console.log('--- Phase 0: Purge Stale Homepage Entries ---')
const homepageStalePurged = db.prepare(`
  DELETE FROM homepage_cache
  WHERE fetched_at < datetime('now', '-3 days')
`).run()
stats.purged = homepageStalePurged.changes
console.log(`  Purged ${homepageStalePurged.changes} homepage entries older than 3 days\n`)

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
      const query = cat.query

      if (cat.mode === 'nsfw' && query.startsWith('http')) {
        videos = await withRetry(cat.key, async () => {
          try {
            const domain = new URL(query).hostname.replace(/^www\./, '')
            return await registry.search(query, { site: domain, limit: 12 })
          } catch {
            return await registry.search(query, { adapter: 'yt-dlp', limit: 12 })
          }
        })
      } else {
        videos = await withRetry(cat.key, () => registry.search(query, { adapter: 'yt-dlp', limit: 12 }))
      }

      const insert = db.prepare(`
        INSERT OR IGNORE INTO homepage_cache (id, category_key, url, title, thumbnail, duration, source, uploader, view_count, like_count, subscriber_count, upload_date, tags, fetched_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now', '+7 days'))
      `)

      let added = 0
      for (const v of videos) {
        try {
          const compositeId = `${cat.key}_${v.id}`
          const result = insert.run(compositeId, cat.key, v.url, v.title, v.thumbnail, v.duration, v.source, v.uploader, v.view_count, v.like_count ?? null, v.subscriber_count ?? null, v.upload_date ?? null, JSON.stringify(v.tags || []))
          if (result.changes > 0) added++
        } catch (err) {
          console.log(`      ⚠️ Insert failed for ${v.url?.substring(0, 60)}: ${err.message.substring(0, 60)}`)
        }
      }
      console.log(`    ✅ +${added} new videos (${videos.length} fetched)`)
      stats.categoriesRefilled++
    } catch (err) {
      console.log(`    ❌ ${err.message.substring(0, 80)}`)
      stats.errors++
    }
  }
}

// --- Phase 1.5: Persistent rows (sticky homepage shelves) ---
// Refills "My PornHub Likes", "From Your Subscriptions", and per-model rows.
// Items here never auto-expire; ph_likes never deletes; others cap at 50 newest.
if (modes.includes('nsfw')) {
  console.log('\n--- Phase 1.5: Persistent Rows (NSFW) ---')
  try {
    const { FETCHERS, selectTopPHModels } = await import('../sources/pornhub-personal.js')

    // Auto-derive top-3 PH models from creator_boosts and upsert into persistent_rows.
    // Removes any previously-derived ph_model_* rows that no longer qualify.
    const topModels = selectTopPHModels({ limit: 3 })
    const insertModelRow = db.prepare(`
      INSERT OR REPLACE INTO persistent_rows
        (key, label, mode, source, fetcher, fetcher_arg, sort_order, active, fetch_interval, last_fetched)
      VALUES (?, ?, 'nsfw', 'pornhub.com', 'ph_model', ?, ?, 1, 3600,
        (SELECT last_fetched FROM persistent_rows WHERE key = ?))
    `)
    const keepKeys = new Set(['ph_likes', 'ph_subs'])
    let modelOrder = 2
    for (const m of topModels) {
      const handle = String(m.creator).trim()
      if (!handle) continue
      const slug = handle.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'unknown'
      const key = `ph_model_${slug}`
      keepKeys.add(key)
      insertModelRow.run(key, `More from ${handle}`, handle, modelOrder++, key)
    }
    // Drop stale model rows that are no longer in the top-3
    const allModelKeys = db.prepare("SELECT key FROM persistent_rows WHERE fetcher = 'ph_model'").all()
    for (const r of allModelKeys) {
      if (!keepKeys.has(r.key)) {
        db.prepare('DELETE FROM persistent_rows WHERE key = ?').run(r.key)
      }
    }
    console.log(`  Top PH models: ${topModels.length} (keys: ${[...keepKeys].filter(k => k.startsWith('ph_model_')).join(', ') || '(none)'})`)

    // Refill each active persistent row whose fetch_interval has elapsed
    const rows = db.prepare(`
      SELECT key, label, fetcher, fetcher_arg, fetch_interval, last_fetched
      FROM persistent_rows
      WHERE active = 1 AND mode = 'nsfw'
      ORDER BY sort_order
    `).all()

    const upsertItem = db.prepare(`
      INSERT OR REPLACE INTO persistent_row_items
        (row_key, video_url, title, thumbnail, duration, uploader,
         view_count, like_count, upload_date, liked_at, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const trimNonLikes = db.prepare(`
      DELETE FROM persistent_row_items
      WHERE row_key = ? AND video_url NOT IN (
        SELECT video_url FROM persistent_row_items
        WHERE row_key = ?
        ORDER BY COALESCE(liked_at, added_at) DESC
        LIMIT 50
      )
    `)
    const updateLastFetched = db.prepare(
      "UPDATE persistent_rows SET last_fetched = datetime('now') WHERE key = ?"
    )

    for (const row of rows) {
      const fetcher = FETCHERS[row.fetcher]
      if (!fetcher) {
        console.log(`    ⚠️ ${row.key}: no fetcher named "${row.fetcher}"`)
        continue
      }

      // Skip if recently refreshed (and not first run).
      // SQLite stores datetime('now') as UTC without a Z marker; JS would parse it
      // as local time and produce a negative "age". Convert to ISO+Z first.
      if (row.last_fetched) {
        const iso = row.last_fetched.includes('T')
          ? row.last_fetched
          : row.last_fetched.replace(' ', 'T') + 'Z'
        const ageSec = (Date.now() - new Date(iso).getTime()) / 1000
        if (ageSec >= 0 && ageSec < (row.fetch_interval || 3600)) {
          console.log(`    ⏭ ${row.key}: refreshed ${Math.round(ageSec/60)}m ago, skipping`)
          continue
        }
      }

      try {
        console.log(`    🔄 ${row.key} (${row.label})...`)
        const items = await fetcher({ fetcher_arg: row.fetcher_arg, limit: 50 })
        let added = 0
        for (const it of items) {
          if (!it.url) continue
          const tagsJson = Array.isArray(it.tags) ? JSON.stringify(it.tags) : (it.tags || '[]')
          try {
            upsertItem.run(
              row.key, it.url, it.title || '', it.thumbnail || '',
              it.duration || 0, it.uploader || '',
              it.view_count ?? null, it.like_count ?? null,
              it.upload_date ?? null, it.liked_at ?? null, tagsJson
            )
            added++
          } catch (err) {
            console.log(`      ⚠️ Insert failed: ${err.message.substring(0, 60)}`)
          }
        }
        // ph_likes is sticky/unbounded; trim others to 50 newest
        if (row.fetcher !== 'ph_likes') {
          trimNonLikes.run(row.key, row.key)
        }
        // Only count this as a successful fetch if we actually got something.
        // An empty result keeps last_fetched=NULL so the next warm-cache retries.
        if (added > 0) updateLastFetched.run(row.key)
        console.log(`    ${added > 0 ? '✅' : '⚠️ '} ${row.key}: +${added} items${added === 0 ? ' (will retry next run)' : ''}`)
      } catch (err) {
        console.log(`    ❌ ${row.key}: ${err.message.substring(0, 80)}`)
        stats.errors++
      }
    }
    // Close the personal-fetchers browser to free memory before Phase 2
    try {
      const { _closePornhubPersonalBrowser } = await import('../sources/pornhub-personal.js')
      await _closePornhubPersonalBrowser()
    } catch {}
  } catch (err) {
    console.log(`  ❌ Phase 1.5 failed to load: ${err.message}`)
    stats.errors++
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
      const query = src.query

      const videos = await withRetry(src.label, () => registry.search(query, { site: src.domain, limit: 20 }))

      const insert = db.prepare(`
        INSERT OR IGNORE INTO feed_cache (id, source_domain, mode, url, title, creator, thumbnail, duration, orientation, tags, view_count, like_count, subscriber_count, upload_date, fetched_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now', '+6 hours'))
      `)

      let added = 0
      const newUrls = []
      for (const v of videos) {
        try {
          const tags = Array.isArray(v.tags) ? JSON.stringify(v.tags) : (v.tags || '[]')
          const result = insert.run(v.id, src.domain, mode, v.url, v.title, v.uploader, v.thumbnail, v.duration, v.orientation, tags, v.view_count ?? null, v.like_count ?? null, v.subscriber_count ?? null, v.upload_date ?? null)
          if (result.changes > 0) {
            added++
            if (v.url) newUrls.push(v.url)
          }
        } catch (err) {
          console.log(`      ⚠️ Insert failed for ${v.url?.substring(0, 60)}: ${err.message.substring(0, 60)}`)
        }
      }

      db.prepare("UPDATE sources SET last_fetched = datetime('now') WHERE domain = ?").run(src.domain)
      console.log(`    ✅ +${added} new videos (${videos.length} fetched)`)
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

// --- Phase 4: Purge stale cache entries ---
console.log('\n--- Phase 4: Purge Stale Entries ---')

const feedPurged = db.prepare(`
  DELETE FROM feed_cache
  WHERE watched = 1 AND fetched_at < datetime('now', '-7 days')
`).run()
stats.purged += feedPurged.changes
console.log(`  feed_cache: purged ${feedPurged.changes} watched entries older than 7 days`)

const homepagePurged = db.prepare(`
  DELETE FROM homepage_cache
  WHERE viewed = 1 AND fetched_at < datetime('now', '-7 days')
`).run()
stats.purged += homepagePurged.changes
console.log(`  homepage_cache: purged ${homepagePurged.changes} viewed entries older than 7 days`)

// Dedup: remove feed_cache entries with duplicate URLs (keep newest)
const dupsPurged = db.prepare(`
  DELETE FROM feed_cache WHERE rowid NOT IN (
    SELECT MIN(rowid) FROM feed_cache GROUP BY url
  )
`).run()
if (dupsPurged.changes > 0) {
  stats.purged += dupsPurged.changes
  console.log(`  feed_cache: removed ${dupsPurged.changes} duplicate URL entries`)
}

// --- Summary ---
const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
console.log(`\n--- Summary ---`)
console.log(`  Categories refilled: ${stats.categoriesRefilled}`)
console.log(`  Feed sources refilled: ${stats.feedRefilled}`)
console.log(`  Stream URLs resolved: ${stats.streamUrlsResolved}`)
console.log(`  Stale entries purged: ${stats.purged}`)
console.log(`  Errors: ${stats.errors}`)
console.log(`  Time: ${elapsed}s\n`)

// Cleanup
try { await closeAllSources() } catch {}
process.exit(stats.errors > 0 ? 1 : 0)
