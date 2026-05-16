#!/usr/bin/env node
// ============================================================
// cleanup-dead-urls — one-shot batch test of cached video URLs
//
// Walks the cache in priority order (homepage → persistent → feed),
// runs each URL through yt-dlp with per-domain pacing so we don't
// trip bot-detection on any one site, and marks dead the URLs whose
// upstream returns 404 / "video removed" / etc.
//
// Why we need this: the background TTL monitor proactively tests 20
// random URLs every 15 minutes. With ~16k NSFW URLs in the backlog
// (~11.5k PH, 2.4k XVideos, 1.9k Spankbang, …) a full sweep at that
// rate takes a week. Until the sweep finishes, hero autoplay keeps
// picking dead URLs from the untested pool.
//
// Usage (server MUST be stopped — node:sqlite multi-process writes
// corrupt the DB on Windows):
//
//   npm run cleanup:dead             # nsfw, homepage+persistent, default pacing
//   npm run cleanup:dead -- --dry    # show what would run, no calls
//   npm run cleanup:dead -- --mode=social --surfaces=homepage
//   npm run cleanup:dead -- --max=100 --delay=4000
//   npm run cleanup:dead -- --surfaces=homepage,persistent,feed --max=500
//
// Flags:
//   --mode=nsfw|social|all      default nsfw
//   --surfaces=A,B,C            default homepage,persistent  (priority order)
//   --max=N                     default 0 (no cap)
//   --delay=MS                  per-domain throttle ms, default 2500
//   --dry                       preview only — print URL counts by domain
//
// Ctrl-C halts cleanly between calls; in-flight yt-dlp call finishes.
// ============================================================

import { pathToFileURL } from 'url'

const args = parseArgs(process.argv.slice(2))
const MODE = args.mode || 'nsfw'
const SURFACES = (args.surfaces || 'homepage,persistent').split(',').map(s => s.trim()).filter(Boolean)
const MAX_URLS = args.max ? parseInt(args.max, 10) : 0
const DELAY_MS = args.delay ? parseInt(args.delay, 10) : 2500
const DRY_RUN = !!args.dry

const isMain = import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) main().catch(err => {
  console.error('\n❌ cleanup-dead-urls crashed:', err.message)
  console.error(err.stack)
  process.exit(1)
})

async function main() {
  console.log('\n🧹 FeedDeck — Dead URL Cleanup')
  console.log(`   Mode:        ${MODE}`)
  console.log(`   Surfaces:    ${SURFACES.join(' → ')}`)
  console.log(`   Max URLs:    ${MAX_URLS || 'no cap'}`)
  console.log(`   Per-domain:  serial, ${DELAY_MS}ms between calls`)
  console.log(`   Dry run:     ${DRY_RUN}`)
  console.log()

  const { initDatabase, closeDatabase, db } = await import('../database.js')
  initDatabase()

  const { selectCleanupCandidates, processUrlsByDomain } = await import('../cleanup-dead-urls.js')
  const urls = selectCleanupCandidates(db, {
    mode: MODE === 'all' ? 'nsfw' : MODE, // 'all' = run nsfw first per user spec
    surfaces: SURFACES,
    maxUrls: MAX_URLS,
  })

  if (urls.length === 0) {
    console.log('Nothing to do — no URLs match the filter.')
    closeDatabase()
    return
  }

  // Group preview
  const byDomain = new Map()
  for (const u of urls) {
    const d = safeDomain(u)
    byDomain.set(d, (byDomain.get(d) || 0) + 1)
  }
  console.log(`📋 ${urls.length} URLs to test, broken down by domain:`)
  const sorted = [...byDomain.entries()].sort((a, b) => b[1] - a[1])
  for (const [d, n] of sorted) {
    const eta = Math.round((n * DELAY_MS) / 1000)
    console.log(`   ${d.padEnd(20)} ${String(n).padStart(6)} URLs   (~${eta}s wall-clock)`)
  }
  // Wall-clock for the whole sweep is max(per-domain time) since
  // domains run in parallel.
  const totalWall = Math.round((Math.max(...byDomain.values()) * DELAY_MS) / 1000)
  console.log(`   ${'TOTAL'.padEnd(20)} ${String(urls.length).padStart(6)} URLs   (~${totalWall}s wall-clock, parallel across domains)`)
  console.log()

  if (DRY_RUN) {
    console.log('Dry run — exiting without making any yt-dlp calls.')
    closeDatabase()
    return
  }

  // Wire up the live deps and run.
  const { registry } = await import('../sources/index.js')
  const { preResolveStreamUrls } = await import('../pre-resolve-stream-urls.js')
  const { _isCookieExpired, _extractDomain } = await import('../sources/ytdlp.js')
  const { logger } = await import('../logger.js')

  // Ctrl-C clean exit. processBatch is async; AbortController stops
  // the runner from starting new batches once we've finished the
  // current one.
  const ctrl = new AbortController()
  let interrupted = false
  process.on('SIGINT', () => {
    if (interrupted) {
      console.log('\n⚠️  Second Ctrl-C — exiting immediately.')
      process.exit(130)
    }
    interrupted = true
    console.log('\n⏸  Halting after current batch (Ctrl-C again to force quit)…')
    ctrl.abort()
  })

  // Aggregate counts across all batches.
  const totals = { resolved: 0, failed: 0, skipped: 0, marked_dead: 0 }
  const startedAt = Date.now()
  let processedSoFar = 0

  await processUrlsByDomain(urls, {
    extractDomain: _extractDomain,
    delayPerDomainMs: DELAY_MS,
    perBatch: 1,
    signal: ctrl.signal,
    processBatch: async (batch, domain) => {
      const counts = await preResolveStreamUrls(batch, {
        registry,
        db,
        isCookieExpired: _isCookieExpired,
        extractDomain: _extractDomain,
        concurrency: 1,
        // Suppress the per-batch info log from pre-resolve; we have
        // our own progress line.
        logger: { info: () => {} },
      })
      totals.resolved += counts.resolved
      totals.failed += counts.failed
      totals.skipped += counts.skipped
      totals.marked_dead += counts.marked_dead
    },
    onProgress: ({ domain, processed, queued, error }) => {
      if (error) {
        console.log(`   ⚠️  ${domain}: batch error — ${error}`)
        return
      }
      processedSoFar++
      if (processedSoFar % 10 === 0 || processed === queued) {
        const elapsedS = Math.round((Date.now() - startedAt) / 1000)
        console.log(
          `   [${elapsedS}s] ${domain.padEnd(20)} ${processed}/${queued}   ` +
          `cum: ${totals.resolved} ok / ${totals.marked_dead} dead / ${totals.skipped} skip / ${totals.failed} fail`
        )
      }
    },
  })

  const totalS = Math.round((Date.now() - startedAt) / 1000)
  console.log()
  console.log(`✅ Done in ${totalS}s${interrupted ? ' (halted early)' : ''}`)
  console.log(`   resolved: ${totals.resolved}`)
  console.log(`   marked dead: ${totals.marked_dead}`)
  console.log(`   skipped (dead cookies / already dead): ${totals.skipped}`)
  console.log(`   transient failures (will retry naturally): ${totals.failed}`)

  closeDatabase()
}

// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------

function parseArgs(argv) {
  const out = {}
  for (const a of argv) {
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq > 0) out[a.slice(2, eq)] = a.slice(eq + 1)
      else out[a.slice(2)] = true
    }
  }
  return out
}

function safeDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return 'unknown' }
}
