// ============================================================
// preResolveStreamUrls — batch resolve stream URLs ahead of playback.
//
// Side effects on each URL:
//   - Calls registry.getStreamUrl(url) (concurrency-bounded)
//   - UPDATEs feed_cache.stream_url + expires_at on success
//   - Marks .dead = 1 in feed_cache / homepage_cache / persistent_row_items
//     when isPermanentDeadError(err) returns true
//   - Skips URLs whose domain currently has expired cookies, so a dead
//     cookie can't drain yt-dlp budget on the same 1.4k PH URLs every
//     warm tick (the 2026-05-16 NSFW flood pattern)
//   - Skips URLs already marked dead — guards against caller selecting
//     a dead URL despite a feed query that should have filtered it
//
// All collaborators are injected so the module can be exercised in
// isolation with an in-memory SQLite and a fake registry. Production
// wiring lives in server/index.js.
// ============================================================

const DEFAULT_CONCURRENCY = 3
const STREAM_URL_TTL = "datetime('now', '+2 hours')"

// yt-dlp stderr phrases that mean "this video page is gone, no cookie
// refresh will bring it back." Conservative on purpose: we mark URLs
// dead based on these, so false positives become permanently-skipped
// content. "Video unavailable in your country" is excluded — that's
// a geo-block, not a deletion, and it could change with a VPN/IP shift.
const PERMANENT_DEAD_FRAGMENTS = [
  'http error 404',
  'http error 410',
  'has been removed',
  'video unavailable',
  'no longer available',
  'video was deleted',
  'video has been deleted',
  'this video does not exist',
]
const GEO_FRAGMENTS_EXCLUSION = [
  'unavailable in your country',
  'unavailable in your region',
]

export function isPermanentDeadError(err) {
  const msg = (err?.stderr || err?.message || '').toLowerCase()
  if (!msg) return false
  // Geo-blocks contain "video unavailable in your country" — they're
  // not permanent. Bail out before the dead-fragment check.
  if (GEO_FRAGMENTS_EXCLUSION.some(f => msg.includes(f))) return false
  return PERMANENT_DEAD_FRAGMENTS.some(f => msg.includes(f))
}

export async function preResolveStreamUrls(urls, deps = {}) {
  const {
    registry,
    db,
    isCookieExpired,
    extractDomain,
    concurrency = DEFAULT_CONCURRENCY,
    logger = null,
    isDeadError = isPermanentDeadError,
  } = deps

  if (!registry?.getStreamUrl) throw new Error('preResolveStreamUrls: deps.registry.getStreamUrl required')
  if (!db?.prepare) throw new Error('preResolveStreamUrls: deps.db required')
  if (typeof isCookieExpired !== 'function') throw new Error('preResolveStreamUrls: deps.isCookieExpired required')
  if (typeof extractDomain !== 'function') throw new Error('preResolveStreamUrls: deps.extractDomain required')

  // Prepare once, run many. UPDATEs are no-ops when the URL isn't in
  // that surface's table — that's intentional, the caller doesn't have
  // to label each URL with its origin surface. Mirrors the dual-table
  // write pattern in /api/stream-url so cleanup-dead-urls runs against
  // homepage / persistent-row URLs leave the stream_url where the
  // surface query will actually find it.
  const updateFeedStream = db.prepare(
    `UPDATE feed_cache SET stream_url = ?, expires_at = ${STREAM_URL_TTL} WHERE url = ?`
  )
  const updateHomepageStream = _safePrepare(db,
    `UPDATE homepage_cache SET stream_url = ?, stream_url_expires_at = ${STREAM_URL_TTL} WHERE url = ?`
  )
  const updatePersistentStream = _safePrepare(db,
    `UPDATE persistent_row_items SET stream_url = ?, stream_url_expires_at = ${STREAM_URL_TTL} WHERE video_url = ?`
  )
  const markFeedDead = _safePrepare(db,
    `UPDATE feed_cache SET dead = 1, dead_at = datetime('now') WHERE url = ?`
  )
  const markHomepageDead = _safePrepare(db,
    `UPDATE homepage_cache SET dead = 1, dead_at = datetime('now') WHERE url = ?`
  )
  const markPersistentDead = _safePrepare(db,
    `UPDATE persistent_row_items SET dead = 1, dead_at = datetime('now') WHERE video_url = ?`
  )
  const checkFeedDead = _safePrepare(db,
    `SELECT dead FROM feed_cache WHERE url = ?`
  )

  let resolved = 0, failed = 0, skipped = 0, marked_dead = 0

  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency)
    const results = await Promise.allSettled(batch.map(async (url) => {
      // Pre-flight 1: already-dead URLs short-circuit.
      const existing = checkFeedDead ? checkFeedDead.get(url) : null
      if (existing && existing.dead === 1) {
        return { kind: 'skipped', reason: 'already_dead' }
      }
      // Pre-flight 2: domain cookies known dead — skip; we'd just burn
      // a yt-dlp slot to get the same auth_failed every time.
      const domain = extractDomain(url)
      if (domain && isCookieExpired(domain)) {
        return { kind: 'skipped', reason: 'cookies_expired' }
      }

      try {
        const cdnUrl = await registry.getStreamUrl(url)
        updateFeedStream.run(cdnUrl, url)
        if (updateHomepageStream) updateHomepageStream.run(cdnUrl, url)
        if (updatePersistentStream) updatePersistentStream.run(cdnUrl, url)
        return { kind: 'ok' }
      } catch (err) {
        if (isDeadError(err)) {
          if (markFeedDead) markFeedDead.run(url)
          if (markHomepageDead) markHomepageDead.run(url)
          if (markPersistentDead) markPersistentDead.run(url)
          return { kind: 'dead' }
        }
        return { kind: 'failed' }
      }
    }))

    for (const r of results) {
      if (r.status !== 'fulfilled') { failed++; continue }
      switch (r.value.kind) {
        case 'ok': resolved++; break
        case 'skipped': skipped++; break
        case 'dead': marked_dead++; break
        case 'failed': failed++; break
      }
    }
  }

  if (logger?.info) {
    logger.info(
      `  🔗 pre-resolve: ${resolved} ok, ${failed} fail, ${skipped} skip, ${marked_dead} dead`
    )
  }
  return { resolved, failed, skipped, marked_dead }
}

// Some legacy schemas may not yet have the `dead` columns. Wrap the
// prepare so a missing column doesn't break the whole batch — the
// migration is a separate concern, run on next server start.
function _safePrepare(db, sql) {
  try { return db.prepare(sql) } catch { return null }
}
