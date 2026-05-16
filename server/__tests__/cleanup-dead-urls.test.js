import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'

// ============================================================
// cleanup-dead-urls — politely bulk-test cached video URLs and
// mark dead the ones whose upstream has been removed.
//
// Two pieces:
//   processUrlsByDomain — runner that serializes calls per-domain
//     so we never have two yt-dlp hits in flight against the same
//     site simultaneously, but DIFFERENT sites run in parallel.
//   selectCleanupCandidates — picks URLs from homepage_cache +
//     persistent_row_items + feed_cache in priority order. Limited
//     to mode/surface so we can start with "NSFW stuff actually
//     showing on the homepage" (the user's requested first pass).
// ============================================================

const { processUrlsByDomain, selectCleanupCandidates } =
  await import('../cleanup-dead-urls.js')

function fakeExtractDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return null }
}

describe('processUrlsByDomain — pacing semantics', () => {
  it('runs URLs from the same domain serially (never two in flight at once)', async () => {
    const urls = [
      'https://www.pornhub.com/v/1',
      'https://www.pornhub.com/v/2',
      'https://www.pornhub.com/v/3',
    ]
    let inFlightPerDomain = new Map()
    let peakPerDomain = new Map()
    const processBatch = vi.fn(async (batch, domain) => {
      const cur = (inFlightPerDomain.get(domain) || 0) + 1
      inFlightPerDomain.set(domain, cur)
      peakPerDomain.set(domain, Math.max(peakPerDomain.get(domain) || 0, cur))
      await new Promise(r => setTimeout(r, 10))
      inFlightPerDomain.set(domain, cur - 1)
    })

    await processUrlsByDomain(urls, {
      extractDomain: fakeExtractDomain,
      processBatch,
      delayPerDomainMs: 0,
    })

    expect(peakPerDomain.get('pornhub.com')).toBe(1)
    expect(processBatch).toHaveBeenCalledTimes(3)
  })

  it('runs URLs from DIFFERENT domains in parallel', async () => {
    const urls = [
      'https://www.pornhub.com/v/1',
      'https://www.spankbang.com/v/1',
      'https://www.xvideos.com/v/1',
    ]
    let totalInFlight = 0
    let peakTotal = 0
    const processBatch = vi.fn(async () => {
      totalInFlight++
      peakTotal = Math.max(peakTotal, totalInFlight)
      await new Promise(r => setTimeout(r, 20))
      totalInFlight--
    })

    await processUrlsByDomain(urls, {
      extractDomain: fakeExtractDomain,
      processBatch,
      delayPerDomainMs: 0,
    })

    // Three different domains, so all three can run concurrently.
    expect(peakTotal).toBe(3)
  })

  it('respects delayPerDomainMs between same-domain calls', async () => {
    const urls = [
      'https://www.pornhub.com/v/1',
      'https://www.pornhub.com/v/2',
    ]
    const startTs = []
    const processBatch = vi.fn(async () => {
      startTs.push(Date.now())
      await new Promise(r => setTimeout(r, 5))
    })

    await processUrlsByDomain(urls, {
      extractDomain: fakeExtractDomain,
      processBatch,
      delayPerDomainMs: 50,
    })

    expect(startTs).toHaveLength(2)
    const gap = startTs[1] - startTs[0]
    // First call took ~5ms, then 50ms delay, then second call. Allow
    // a generous lower bound for timer jitter on Windows but make sure
    // the delay actually happened (anything <30 would be a regression).
    expect(gap).toBeGreaterThanOrEqual(30)
  })

  it('does NOT delay between batches across different domains', async () => {
    const urls = [
      'https://www.pornhub.com/v/1',
      'https://www.spankbang.com/v/1',
    ]
    const startTs = []
    const processBatch = vi.fn(async () => {
      startTs.push(Date.now())
      await new Promise(r => setTimeout(r, 5))
    })

    await processUrlsByDomain(urls, {
      extractDomain: fakeExtractDomain,
      processBatch,
      delayPerDomainMs: 100,
    })

    // Both calls started within a few ms of each other — no cross-
    // domain serialization, no delay. (Timer slack on Windows means
    // we can't assert near-zero; <50ms is far below the 100ms delay.)
    const gap = Math.abs(startTs[1] - startTs[0])
    expect(gap).toBeLessThan(50)
  })

  it('reports per-domain counts in the result', async () => {
    const urls = [
      'https://www.pornhub.com/v/1',
      'https://www.pornhub.com/v/2',
      'https://www.spankbang.com/v/1',
    ]
    const result = await processUrlsByDomain(urls, {
      extractDomain: fakeExtractDomain,
      processBatch: async () => {},
      delayPerDomainMs: 0,
    })

    expect(result.byDomain['pornhub.com']).toBe(2)
    expect(result.byDomain['spankbang.com']).toBe(1)
    expect(result.totalProcessed).toBe(3)
  })

  it('passes the URL through to processBatch as a single-element array (matches preResolveStreamUrls signature)', async () => {
    const urls = ['https://www.pornhub.com/v/1', 'https://www.pornhub.com/v/2']
    const calls = []
    await processUrlsByDomain(urls, {
      extractDomain: fakeExtractDomain,
      processBatch: async (batch) => { calls.push(batch) },
      delayPerDomainMs: 0,
    })

    expect(calls).toEqual([
      ['https://www.pornhub.com/v/1'],
      ['https://www.pornhub.com/v/2'],
    ])
  })

  it('supports abortSignal so a Ctrl-C cleanly halts further calls', async () => {
    const urls = Array.from({ length: 10 }, (_, i) => `https://www.pornhub.com/v/${i}`)
    const ctrl = new AbortController()
    const processBatch = vi.fn(async () => {
      await new Promise(r => setTimeout(r, 5))
      if (processBatch.mock.calls.length >= 3) ctrl.abort()
    })

    await processUrlsByDomain(urls, {
      extractDomain: fakeExtractDomain,
      processBatch,
      delayPerDomainMs: 0,
      signal: ctrl.signal,
    })

    // 3 calls fired, then abort. With delayPerDomainMs = 0 there's
    // no sleep to interrupt, so the abort check runs at top of each
    // iteration — expect 3 or 4 calls before the loop exits.
    expect(processBatch.mock.calls.length).toBeLessThanOrEqual(4)
  })
})

// ----------------------------------------------------------
// selectCleanupCandidates — picks the URLs we'll feed through
// pre-resolve in priority order: homepage first (these are the
// URLs the user actually sees), then persistent rows, then the
// long-tail feed_cache. Optional mode filter. Excludes URLs that
// already have a stream_url or are marked dead.
// ----------------------------------------------------------

function makeDb() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE feed_cache (
      url TEXT PRIMARY KEY,
      mode TEXT NOT NULL DEFAULT 'social',
      stream_url TEXT,
      dead INTEGER DEFAULT 0,
      watched INTEGER DEFAULT 0,
      fetched_at DATETIME DEFAULT (datetime('now'))
    );
    -- homepage_cache derives mode via category_key → categories.mode,
    -- matching production. No direct mode column.
    CREATE TABLE categories (
      key TEXT PRIMARY KEY,
      mode TEXT
    );
    CREATE TABLE homepage_cache (
      url TEXT PRIMARY KEY,
      category_key TEXT,
      stream_url TEXT,
      dead INTEGER DEFAULT 0,
      viewed INTEGER DEFAULT 0,
      expires_at DATETIME DEFAULT (datetime('now', '+7 days'))
    );
    CREATE TABLE persistent_row_items (
      video_url TEXT PRIMARY KEY,
      stream_url TEXT,
      dead INTEGER DEFAULT 0,
      row_key TEXT
    );
    CREATE TABLE persistent_rows (
      key TEXT PRIMARY KEY,
      mode TEXT
    );
  `)
  return db
}

// Seed homepage_cache via a named category. Matches production
// shape (mode lives on categories, joined via category_key).
function seedHomepage(db, url, mode, opts = {}) {
  const catKey = `${mode}_test_cat`
  db.prepare(`INSERT OR IGNORE INTO categories (key, mode) VALUES (?, ?)`).run(catKey, mode)
  db.prepare(`
    INSERT INTO homepage_cache (url, category_key, stream_url, dead)
    VALUES (?, ?, ?, ?)
  `).run(url, catKey, opts.stream_url ?? null, opts.dead ?? 0)
}

describe('selectCleanupCandidates', () => {
  it('selects homepage_cache URLs by mode (via categories join), only ones without a stream_url and not dead', async () => {
    const db = makeDb()
    seedHomepage(db, 'https://www.pornhub.com/needs-resolve', 'nsfw')
    seedHomepage(db, 'https://www.pornhub.com/already-resolved', 'nsfw', { stream_url: 'https://cdn.x/y.mp4' })
    seedHomepage(db, 'https://www.pornhub.com/already-dead', 'nsfw', { dead: 1 })
    seedHomepage(db, 'https://www.youtube.com/sfw', 'social')

    const urls = selectCleanupCandidates(db, { mode: 'nsfw', surfaces: ['homepage'] })
    expect(urls).toEqual(['https://www.pornhub.com/needs-resolve'])
  })

  it('selects persistent_row_items by mode (joined via persistent_rows.mode)', async () => {
    const db = makeDb()
    db.prepare(`INSERT INTO persistent_rows (key, mode) VALUES ('ph_likes', 'nsfw')`).run()
    db.prepare(`INSERT INTO persistent_rows (key, mode) VALUES ('yt_subs', 'social')`).run()
    db.prepare(`INSERT INTO persistent_row_items (video_url, row_key, stream_url, dead) VALUES (?, ?, ?, ?)`).run(
      'https://www.pornhub.com/pin-needs', 'ph_likes', null, 0
    )
    db.prepare(`INSERT INTO persistent_row_items (video_url, row_key, stream_url, dead) VALUES (?, ?, ?, ?)`).run(
      'https://www.youtube.com/yt-pin', 'yt_subs', null, 0
    )

    const urls = selectCleanupCandidates(db, { mode: 'nsfw', surfaces: ['persistent'] })
    expect(urls).toEqual(['https://www.pornhub.com/pin-needs'])
  })

  it('respects the priority order homepage → persistent → feed when multiple surfaces are selected', async () => {
    const db = makeDb()
    seedHomepage(db, 'https://x.com/hp1', 'nsfw')
    db.prepare(`INSERT INTO persistent_rows (key, mode) VALUES ('p1', 'nsfw')`).run()
    db.prepare(`INSERT INTO persistent_row_items (video_url, row_key) VALUES (?, 'p1')`).run('https://x.com/pers1')
    db.prepare(`INSERT INTO feed_cache (url, mode) VALUES (?, ?)`).run('https://x.com/feed1', 'nsfw')

    const urls = selectCleanupCandidates(db, {
      mode: 'nsfw',
      surfaces: ['homepage', 'persistent', 'feed'],
    })
    expect(urls).toEqual([
      'https://x.com/hp1',
      'https://x.com/pers1',
      'https://x.com/feed1',
    ])
  })

  it('deduplicates URLs across surfaces (first occurrence wins)', async () => {
    const db = makeDb()
    const url = 'https://www.pornhub.com/everywhere'
    seedHomepage(db, url, 'nsfw')
    db.prepare(`INSERT INTO persistent_rows (key, mode) VALUES ('p', 'nsfw')`).run()
    db.prepare(`INSERT INTO persistent_row_items (video_url, row_key) VALUES (?, 'p')`).run(url)
    db.prepare(`INSERT INTO feed_cache (url, mode) VALUES (?, ?)`).run(url, 'nsfw')

    const urls = selectCleanupCandidates(db, {
      mode: 'nsfw',
      surfaces: ['homepage', 'persistent', 'feed'],
    })
    expect(urls).toEqual([url])
  })

  it('respects a max URL count cap so a 16k-row sweep can be done in chunks', async () => {
    const db = makeDb()
    for (let i = 0; i < 50; i++) {
      seedHomepage(db, `https://x.com/${i}`, 'nsfw')
    }
    const urls = selectCleanupCandidates(db, { mode: 'nsfw', surfaces: ['homepage'], maxUrls: 10 })
    expect(urls).toHaveLength(10)
  })
})
