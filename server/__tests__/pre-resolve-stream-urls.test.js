import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'

// ============================================================
// preResolveStreamUrls — pre-flight batch resolver
//
// Contract (2026-05-16 NSFW skip-spike fix):
//   - Calls registry.getStreamUrl(url) for each input URL
//   - SKIPS URLs whose domain has expired cookies (no yt-dlp call)
//   - SKIPS URLs already marked dead in feed_cache
//   - On a permanent-failure error (404/410/removed): marks the URL
//     dead so the same URL isn't retried on every warm tick
//   - On other failures (timeout, transient): logs but does NOT mark
//     dead — those may recover
//   - Returns { resolved, failed, skipped, marked_dead } so the
//     boundary debug page can show whether dead-marking is working
// ============================================================

const { preResolveStreamUrls, isPermanentDeadError } =
  await import('../pre-resolve-stream-urls.js')

function makeDb() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE feed_cache (
      url TEXT PRIMARY KEY,
      stream_url TEXT,
      expires_at DATETIME,
      dead INTEGER DEFAULT 0,
      dead_at DATETIME
    );
    CREATE TABLE homepage_cache (
      url TEXT PRIMARY KEY,
      stream_url TEXT,
      stream_url_expires_at DATETIME,
      dead INTEGER DEFAULT 0,
      dead_at DATETIME
    );
    CREATE TABLE persistent_row_items (
      video_url TEXT PRIMARY KEY,
      stream_url TEXT,
      stream_url_expires_at DATETIME,
      dead INTEGER DEFAULT 0,
      dead_at DATETIME
    );
  `)
  return db
}

function seedFeed(db, url) {
  db.prepare('INSERT INTO feed_cache (url) VALUES (?)').run(url)
}

function fakeExtractDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return null }
}

describe('isPermanentDeadError', () => {
  it('returns true for HTTP 404 in stderr', () => {
    expect(isPermanentDeadError({
      stderr: 'ERROR: [xvideos] 123: HTTP Error 404: Not Found',
    })).toBe(true)
  })
  it('returns true for HTTP 410 in stderr', () => {
    expect(isPermanentDeadError({
      stderr: 'ERROR: [generic] abc: HTTP Error 410: Gone',
    })).toBe(true)
  })
  it('returns true for "has been removed"', () => {
    expect(isPermanentDeadError({
      stderr: 'ERROR: video has been removed by the uploader',
    })).toBe(true)
  })
  it('returns true for "video unavailable"', () => {
    expect(isPermanentDeadError({ stderr: 'ERROR: Video unavailable' })).toBe(true)
  })
  it('returns true for "no longer available"', () => {
    expect(isPermanentDeadError({ stderr: 'ERROR: video is no longer available' })).toBe(true)
  })
  it('returns false for transient errors (timeout, 429, generic)', () => {
    expect(isPermanentDeadError({ stderr: 'HTTP Error 429: Too Many Requests' })).toBe(false)
    expect(isPermanentDeadError({ stderr: 'connection timed out' })).toBe(false)
    expect(isPermanentDeadError({ stderr: 'something exploded' })).toBe(false)
  })
  it('returns false for auth_failed-style errors (cookies dead) — those re-resolve when cookies refresh', () => {
    expect(isPermanentDeadError({ stderr: 'cookies are no longer valid' })).toBe(false)
    expect(isPermanentDeadError({ stderr: 'login required' })).toBe(false)
  })
  it('returns false for "video unavailable in your country" (geo-block, not gone)', () => {
    expect(isPermanentDeadError({
      stderr: 'Video unavailable in your country',
    })).toBe(false)
  })
  it('returns false when err is null/undefined', () => {
    expect(isPermanentDeadError(null)).toBe(false)
    expect(isPermanentDeadError(undefined)).toBe(false)
    expect(isPermanentDeadError({})).toBe(false)
  })
})

describe('preResolveStreamUrls', () => {
  let db

  beforeEach(() => {
    db = makeDb()
  })

  it('resolves URLs and writes stream_url + expiry to feed_cache', async () => {
    const url = 'https://www.spankbang.com/video/abc'
    seedFeed(db, url)
    const registry = {
      getStreamUrl: vi.fn(async () => 'https://cdn.spankbang.com/abc.mp4'),
    }

    const counts = await preResolveStreamUrls([url], {
      registry, db,
      isCookieExpired: () => false,
      extractDomain: fakeExtractDomain,
    })

    expect(counts.resolved).toBe(1)
    expect(counts.failed).toBe(0)
    expect(counts.skipped).toBe(0)
    expect(counts.marked_dead).toBe(0)
    const row = db.prepare('SELECT stream_url, dead FROM feed_cache WHERE url = ?').get(url)
    expect(row.stream_url).toBe('https://cdn.spankbang.com/abc.mp4')
    expect(row.dead).toBe(0)
  })

  it('writes resolved stream_url to homepage_cache too when URL exists there', async () => {
    const url = 'https://www.pornhub.com/view_video.php?viewkey=hp'
    db.prepare(`INSERT INTO homepage_cache (url) VALUES (?)`).run(url)
    const registry = {
      getStreamUrl: vi.fn(async () => 'https://cdn.example/hp.mp4'),
    }

    await preResolveStreamUrls([url], {
      registry, db,
      isCookieExpired: () => false,
      extractDomain: fakeExtractDomain,
    })

    const row = db.prepare(
      `SELECT stream_url, stream_url_expires_at FROM homepage_cache WHERE url = ?`
    ).get(url)
    expect(row.stream_url).toBe('https://cdn.example/hp.mp4')
    expect(row.stream_url_expires_at).toBeTruthy()
  })

  it('writes resolved stream_url to persistent_row_items too when URL exists there', async () => {
    const url = 'https://www.pornhub.com/view_video.php?viewkey=pin'
    db.prepare(`INSERT INTO persistent_row_items (video_url) VALUES (?)`).run(url)
    const registry = {
      getStreamUrl: vi.fn(async () => 'https://cdn.example/pin.mp4'),
    }

    await preResolveStreamUrls([url], {
      registry, db,
      isCookieExpired: () => false,
      extractDomain: fakeExtractDomain,
    })

    const row = db.prepare(
      `SELECT stream_url, stream_url_expires_at FROM persistent_row_items WHERE video_url = ?`
    ).get(url)
    expect(row.stream_url).toBe('https://cdn.example/pin.mp4')
    expect(row.stream_url_expires_at).toBeTruthy()
  })

  it('writes to all 3 tables when URL is present in all 3 (e.g. PH likes that also got into homepage + feed)', async () => {
    const url = 'https://www.pornhub.com/view_video.php?viewkey=triple'
    db.prepare(`INSERT INTO feed_cache (url) VALUES (?)`).run(url)
    db.prepare(`INSERT INTO homepage_cache (url) VALUES (?)`).run(url)
    db.prepare(`INSERT INTO persistent_row_items (video_url) VALUES (?)`).run(url)
    const registry = {
      getStreamUrl: vi.fn(async () => 'https://cdn.example/triple.mp4'),
    }

    await preResolveStreamUrls([url], {
      registry, db,
      isCookieExpired: () => false,
      extractDomain: fakeExtractDomain,
    })

    expect(db.prepare(`SELECT stream_url FROM feed_cache WHERE url = ?`).get(url).stream_url)
      .toBe('https://cdn.example/triple.mp4')
    expect(db.prepare(`SELECT stream_url FROM homepage_cache WHERE url = ?`).get(url).stream_url)
      .toBe('https://cdn.example/triple.mp4')
    expect(db.prepare(`SELECT stream_url FROM persistent_row_items WHERE video_url = ?`).get(url).stream_url)
      .toBe('https://cdn.example/triple.mp4')
  })

  it('skips URLs whose domain has expired cookies — does not call getStreamUrl', async () => {
    const url = 'https://www.pornhub.com/view_video.php?viewkey=abc'
    seedFeed(db, url)
    const registry = { getStreamUrl: vi.fn() }

    const counts = await preResolveStreamUrls([url], {
      registry, db,
      isCookieExpired: (domain) => domain === 'pornhub.com',
      extractDomain: fakeExtractDomain,
    })

    expect(registry.getStreamUrl).not.toHaveBeenCalled()
    expect(counts.skipped).toBe(1)
    expect(counts.resolved).toBe(0)
    expect(counts.marked_dead).toBe(0)
    const row = db.prepare('SELECT dead FROM feed_cache WHERE url = ?').get(url)
    expect(row.dead).toBe(0)
  })

  it('marks URL dead when getStreamUrl fails with a permanent error', async () => {
    const url = 'https://www.xvideos.com/video123'
    seedFeed(db, url)
    const registry = {
      getStreamUrl: vi.fn(async () => {
        const err = new Error('yt-dlp failed')
        err.stderr = 'ERROR: [xvideos] 123: HTTP Error 404: Not Found'
        throw err
      }),
    }

    const counts = await preResolveStreamUrls([url], {
      registry, db,
      isCookieExpired: () => false,
      extractDomain: fakeExtractDomain,
    })

    expect(counts.marked_dead).toBe(1)
    expect(counts.failed).toBe(0)
    const row = db.prepare('SELECT dead, dead_at FROM feed_cache WHERE url = ?').get(url)
    expect(row.dead).toBe(1)
    expect(row.dead_at).toBeTruthy()
  })

  it('marks URL dead across all three tables (feed/homepage/persistent)', async () => {
    const url = 'https://www.xvideos.com/dead-everywhere'
    db.prepare('INSERT INTO feed_cache (url) VALUES (?)').run(url)
    db.prepare('INSERT INTO homepage_cache (url) VALUES (?)').run(url)
    db.prepare('INSERT INTO persistent_row_items (video_url) VALUES (?)').run(url)
    const registry = {
      getStreamUrl: vi.fn(async () => {
        const err = new Error('y'); err.stderr = 'video has been removed'; throw err
      }),
    }

    await preResolveStreamUrls([url], {
      registry, db,
      isCookieExpired: () => false,
      extractDomain: fakeExtractDomain,
    })

    expect(db.prepare('SELECT dead FROM feed_cache WHERE url = ?').get(url).dead).toBe(1)
    expect(db.prepare('SELECT dead FROM homepage_cache WHERE url = ?').get(url).dead).toBe(1)
    expect(db.prepare('SELECT dead FROM persistent_row_items WHERE video_url = ?').get(url).dead).toBe(1)
  })

  it('does NOT mark dead on transient errors (429, timeout, unknown)', async () => {
    const u1 = 'https://www.spankbang.com/x1'
    const u2 = 'https://www.spankbang.com/x2'
    seedFeed(db, u1)
    seedFeed(db, u2)
    const registry = {
      getStreamUrl: vi.fn(async (url) => {
        const err = new Error('y')
        err.stderr = url.endsWith('x1') ? 'HTTP Error 429: Too Many Requests' : 'something exploded'
        throw err
      }),
    }

    const counts = await preResolveStreamUrls([u1, u2], {
      registry, db,
      isCookieExpired: () => false,
      extractDomain: fakeExtractDomain,
    })

    expect(counts.marked_dead).toBe(0)
    expect(counts.failed).toBe(2)
    expect(db.prepare('SELECT dead FROM feed_cache WHERE url = ?').get(u1).dead).toBe(0)
    expect(db.prepare('SELECT dead FROM feed_cache WHERE url = ?').get(u2).dead).toBe(0)
  })

  it('processes a mixed batch (resolved + skipped + dead + transient-failed)', async () => {
    const urls = [
      'https://www.spankbang.com/ok',
      'https://www.pornhub.com/cookies-dead',
      'https://www.xvideos.com/removed',
      'https://www.spankbang.com/transient',
    ]
    for (const u of urls) seedFeed(db, u)

    const registry = {
      getStreamUrl: vi.fn(async (url) => {
        if (url.endsWith('/ok')) return 'https://cdn.example/ok.mp4'
        if (url.endsWith('/removed')) {
          const e = new Error('y'); e.stderr = 'HTTP Error 404'; throw e
        }
        const e = new Error('y'); e.stderr = 'HTTP Error 429'; throw e
      }),
    }

    const counts = await preResolveStreamUrls(urls, {
      registry, db,
      isCookieExpired: (d) => d === 'pornhub.com',
      extractDomain: fakeExtractDomain,
    })

    expect(counts.resolved).toBe(1)
    expect(counts.skipped).toBe(1)
    expect(counts.marked_dead).toBe(1)
    expect(counts.failed).toBe(1)
    const calls = registry.getStreamUrl.mock.calls.map(c => c[0])
    expect(calls).not.toContain('https://www.pornhub.com/cookies-dead')
    expect(calls).toHaveLength(3)
  })

  it('honors concurrency (no more than N getStreamUrl calls in flight at once)', async () => {
    const urls = Array.from({ length: 6 }, (_, i) => `https://www.spankbang.com/v${i}`)
    for (const u of urls) seedFeed(db, u)

    let inFlight = 0, peak = 0
    const registry = {
      getStreamUrl: vi.fn(async () => {
        inFlight++; peak = Math.max(peak, inFlight)
        await new Promise(r => setTimeout(r, 5))
        inFlight--
        return 'https://cdn.example/x.mp4'
      }),
    }

    await preResolveStreamUrls(urls, {
      registry, db,
      isCookieExpired: () => false,
      extractDomain: fakeExtractDomain,
      concurrency: 2,
    })

    expect(peak).toBe(2)
  })

  // -----------------------------------------------------------
  // Regression guards for the 2026-05-16 silent failure flood.
  // Before the fix: a batch of all-dead PH URLs would call yt-dlp
  // for every one of them and log nothing actionable. After the fix:
  // dead-cookie domains short-circuit before yt-dlp, and a URL marked
  // dead never re-enters the batch even if the caller mis-selects it.
  // -----------------------------------------------------------
  it('regression: 100% dead-cookie batch makes zero yt-dlp calls', async () => {
    const urls = Array.from({ length: 30 }, (_, i) =>
      `https://www.pornhub.com/view_video.php?viewkey=${i}`)
    for (const u of urls) seedFeed(db, u)
    const registry = { getStreamUrl: vi.fn() }

    const counts = await preResolveStreamUrls(urls, {
      registry, db,
      isCookieExpired: (d) => d === 'pornhub.com',
      extractDomain: fakeExtractDomain,
    })

    expect(registry.getStreamUrl).not.toHaveBeenCalled()
    expect(counts.skipped).toBe(30)
  })

  it('regression: an already-dead URL re-submitted to pre-resolve costs zero yt-dlp calls', async () => {
    const url = 'https://www.xvideos.com/long-gone'
    seedFeed(db, url)
    const registry = {
      getStreamUrl: vi.fn(async () => {
        const e = new Error('y'); e.stderr = 'HTTP Error 404'; throw e
      }),
    }

    await preResolveStreamUrls([url], {
      registry, db,
      isCookieExpired: () => false,
      extractDomain: fakeExtractDomain,
    })

    // Second pass — caller mis-selects the dead URL.
    const counts2 = await preResolveStreamUrls([url], {
      registry, db,
      isCookieExpired: () => false,
      extractDomain: fakeExtractDomain,
    })

    expect(registry.getStreamUrl).toHaveBeenCalledTimes(1)
    expect(counts2.skipped).toBe(1)
  })
})
