// ============================================================
// cleanup-dead-urls — politely bulk-resolve cached video URLs so
// dead ones get marked and the user stops catching them on open.
//
// Two pieces:
//
//   selectCleanupCandidates(db, opts)
//     Returns URLs in priority order — homepage_cache (what the
//     user actually sees) → persistent_row_items → feed_cache —
//     deduplicated, scoped by mode, excluding URLs that already
//     have a stream_url or are marked dead.
//
//   processUrlsByDomain(urls, opts)
//     Buckets URLs by hostname and runs each bucket SERIALLY so
//     we never have two yt-dlp hits in flight at the same site.
//     DIFFERENT sites run in parallel — that's the win over the
//     existing concurrency=3 pre-resolve, which would happily fire
//     three PH calls at once and risk bot-detection. Sleeps
//     delayPerDomainMs between calls in the same bucket so a 1k-URL
//     PH sweep stays under ~1 req/2-3s.
//
// Wiring (production caller, in the CLI script):
//   urls = selectCleanupCandidates(db, { mode: 'nsfw', surfaces: ['homepage', 'persistent'] })
//   await processUrlsByDomain(urls, {
//     extractDomain: _extractDomain,
//     delayPerDomainMs: 2500,
//     processBatch: (batch) => preResolveStreamUrls(batch, { ... }),
//   })
// ============================================================

// -----------------------------------------------------------
// Per-domain pacing runner.
// -----------------------------------------------------------
export async function processUrlsByDomain(urls, opts = {}) {
  const {
    extractDomain,
    processBatch,
    delayPerDomainMs = 2500,
    perBatch = 1,
    signal = null,
    onProgress = null,
  } = opts

  if (typeof extractDomain !== 'function') {
    throw new Error('processUrlsByDomain: opts.extractDomain required')
  }
  if (typeof processBatch !== 'function') {
    throw new Error('processUrlsByDomain: opts.processBatch required')
  }

  // Bucket URLs by domain so we can run each bucket serially and
  // multiple buckets in parallel.
  const queues = new Map()
  for (const url of urls) {
    const d = extractDomain(url) || 'unknown'
    if (!queues.has(d)) queues.set(d, [])
    queues.get(d).push(url)
  }

  const result = {
    byDomain: {},
    totalProcessed: 0,
    aborted: false,
  }

  await Promise.all([...queues.entries()].map(async ([domain, queue]) => {
    let processed = 0
    for (let i = 0; i < queue.length; i += perBatch) {
      if (signal?.aborted) {
        result.aborted = true
        break
      }
      const batch = queue.slice(i, i + perBatch)
      try {
        await processBatch(batch, domain)
      } catch (err) {
        // One batch's exception shouldn't kill the whole sweep; log
        // upward and keep going. processBatch is expected to swallow
        // its own per-URL failures, but defense-in-depth.
        if (onProgress) onProgress({ domain, error: err.message })
      }
      processed += batch.length
      result.totalProcessed += batch.length
      if (onProgress) onProgress({ domain, processed, queued: queue.length })
      const moreInQueue = i + perBatch < queue.length
      if (moreInQueue && delayPerDomainMs > 0 && !signal?.aborted) {
        await new Promise(r => setTimeout(r, delayPerDomainMs))
      }
    }
    result.byDomain[domain] = processed
  }))

  return result
}

// -----------------------------------------------------------
// Candidate selection.
//
// surfaces is an ordered list; the returned URL list preserves that
// order (homepage first, etc.) and deduplicates across surfaces.
// -----------------------------------------------------------
export function selectCleanupCandidates(db, opts = {}) {
  const { mode = 'nsfw', surfaces = ['homepage', 'persistent', 'feed'], maxUrls = 0 } = opts
  const collected = []
  const seen = new Set()

  const push = (url) => {
    if (!url || seen.has(url)) return
    seen.add(url)
    collected.push(url)
  }

  for (const surface of surfaces) {
    if (maxUrls > 0 && collected.length >= maxUrls) break

    if (surface === 'homepage') {
      // Homepage rows that need a stream URL. Mode comes from
      // categories (homepage_cache.category_key → categories.key);
      // homepage_cache does NOT have its own mode column.
      const sql = `
        SELECT hp.url
        FROM homepage_cache hp
        JOIN categories c ON c.key = hp.category_key
        WHERE c.mode = ?
          AND COALESCE(hp.stream_url, '') = ''
          AND COALESCE(hp.dead, 0) = 0
      `
      try {
        for (const r of db.prepare(sql).all(mode)) push(r.url)
      } catch { /* table or column missing in legacy schema */ }
    } else if (surface === 'persistent') {
      // Mode comes from persistent_rows (the row owns the mode), so
      // join through row_key.
      const sql = `
        SELECT pri.video_url AS url
        FROM persistent_row_items pri
        JOIN persistent_rows pr ON pr.key = pri.row_key
        WHERE pr.mode = ?
          AND COALESCE(pri.stream_url, '') = ''
          AND COALESCE(pri.dead, 0) = 0
      `
      try {
        for (const r of db.prepare(sql).all(mode)) push(r.url)
      } catch { /* legacy */ }
    } else if (surface === 'feed') {
      // The deep backlog. Sorted by fetched_at DESC so we test the
      // newer content first (older stuff is more likely to be dead
      // but is also less likely to be picked by the hero, so the
      // user feels improvements faster if we test newer first).
      const sql = `
        SELECT url FROM feed_cache
        WHERE mode = ?
          AND COALESCE(stream_url, '') = ''
          AND COALESCE(dead, 0) = 0
          AND watched = 0
        ORDER BY fetched_at DESC
      `
      try {
        for (const r of db.prepare(sql).all(mode)) push(r.url)
      } catch { /* legacy */ }
    }
  }

  return maxUrls > 0 ? collected.slice(0, maxUrls) : collected
}
