// ============================================================
// NSFW topic resolvers — Phase 3 of multi-search topic pipeline
//
// Resolvers:
//   resolveSubscribedModels(rowKey) — pull from ph_subs uploader pool
//   resolveLikesPool()              — liked URLs + creators from ph_likes
//   resolveEpornerApi(sort)         — Eporner JSON API client
//   resolveCrossSite(intent)        — fan-out across SITE_CONFIGS
//
// Phase 2 shipped stubs; this is the real implementation. Each
// resolver is fail-open — empty result on any error so the pipeline
// doesn't cascade.
// ============================================================

import { db } from './database.js'
import { logger } from './logger.js'

const EMPTY = { topics: [], creators: [], directVideos: [] }

export function resolveSubscribedModels(rowKey) {
  try {
    const rows = db.prepare(
      `SELECT DISTINCT uploader FROM persistent_row_items
       WHERE row_key = 'ph_subs' AND uploader IS NOT NULL LIMIT 5`
    ).all()
    const creators = rows.map(r => ({
      handle: r.uploader,
      // Pornhub model URL convention: /pornstar/<slug>
      channel_url: `https://www.pornhub.com/pornstar/${encodeURIComponent(r.uploader.toLowerCase().replace(/\s+/g, '-'))}`,
    }))
    return { topics: [], creators, directVideos: [] }
  } catch (err) {
    logger.warn('subscribed_models resolver failed', { rowKey, error: err.message })
    return EMPTY
  }
}

export function resolveLikesPool() {
  try {
    const rows = db.prepare(
      `SELECT video_url, title, thumbnail, duration, uploader, view_count, like_count, upload_date, tags
       FROM persistent_row_items
       WHERE row_key = 'ph_likes' LIMIT 10`
    ).all()
    const directVideos = rows.map(r => ({
      url: r.video_url,
      title: r.title,
      thumbnail: r.thumbnail,
      duration: r.duration,
      uploader: r.uploader,
      view_count: r.view_count,
      like_count: r.like_count,
      upload_date: r.upload_date,
      tags: r.tags,
      source: 'pornhub.com',
    }))
    const seen = new Set()
    const creators = []
    for (const r of rows) {
      if (!r.uploader || seen.has(r.uploader)) continue
      seen.add(r.uploader)
      creators.push({ handle: r.uploader, channel_url: null })
    }
    return { topics: [], creators, directVideos }
  } catch (err) {
    logger.warn('likes_pool resolver failed', { error: err.message })
    return EMPTY
  }
}

/**
 * Eporner API resolver. Sort param is one of:
 *   top-rated | top-weekly | top-monthly | most-popular | latest
 * Argument is passed through to the Eporner client; we fail open if
 * the API is unreachable (the pipeline has cross_site + likes_pool to
 * lean on).
 */
export async function resolveEpornerApi(sort) {
  const allowedSorts = ['top-rated', 'top-weekly', 'top-monthly', 'most-popular', 'latest']
  const order = allowedSorts.includes(sort) ? sort : 'top-weekly'
  try {
    const ep = await import('./sources/eporner.js')
    const videos = await ep.search({ order, perPage: 20 })
    return { topics: [], creators: [], directVideos: videos }
  } catch (err) {
    logger.warn('eporner_api resolver failed', { sort, error: err.message })
    return EMPTY
  }
}

// Cross-site intent map — each intent → list of {domain, path} or {eporner, sort}.
// The list mirrors the audit's findings: the existing scraper already covers
// 8 NSFW sites; we just fan out across them concurrently per intent.
const CROSS_SITE_INTENT = {
  trending: [
    { domain: 'pornhub.com',   path: '/video?o=tr' },
    { domain: 'redtube.com',   path: '/?mostviewed?period=today' },
    { domain: 'youporn.com',   path: '/?t=t' },
    { domain: 'xhamster.com',  path: '/trending' },
    { domain: 'spankbang.com', path: '/trending_videos/' },
    { domain: 'xvideos.com',   path: '/best' },
    { eporner: 'top-weekly' },
  ],
  'top-rated': [
    { domain: 'pornhub.com',   path: '/video?o=ht' },
    { eporner: 'top-rated' },
    { eporner: 'top-monthly' },
  ],
  amateur: [
    { domain: 'pornhub.com',   path: '/video/search?search=amateur+homemade&hd=1&o=tr' },
    { domain: 'xvideos.com',   path: '/?k=amateur' },
    { domain: 'spankbang.com', path: '/s/amateur/' },
    { eporner: 'top-weekly', query: 'amateur' },
  ],
  japanese: [
    { domain: 'pornhub.com',   path: '/video/search?search=japanese&hd=1&o=tr' },
    { domain: 'xvideos.com',   path: '/?k=japanese' },
    { eporner: 'top-rated', query: 'japanese' },
  ],
  petite: [
    { domain: 'pornhub.com',   path: '/video/search?search=petite&hd=1&o=tr' },
    { domain: 'xvideos.com',   path: '/?k=petite' },
    { eporner: 'top-rated', query: 'petite' },
  ],
  pov: [
    { domain: 'pornhub.com',   path: '/video/search?search=pov&hd=1&o=tr' },
    { domain: 'redgifs.com',   path: '/search?query=pov&order=trending' },
    { eporner: 'top-rated', query: 'pov' },
  ],
  couple: [
    { domain: 'pornhub.com',   path: '/video/search?search=real+couple&hd=1&o=tr' },
    { domain: 'redgifs.com',   path: '/search?query=couple&order=trending' },
  ],
  newest: [
    { domain: 'pornhub.com',   path: '/video?o=cm' },
    { domain: 'xvideos.com',   path: '/new' },
    { domain: 'spankbang.com', path: '/new_videos' },
    { eporner: 'latest' },
  ],
}

/**
 * Cross-site fan-out resolver. Routes per-target hits through the
 * scraper adapter (or eporner client), merges + dedupes by URL.
 * Each target is a Promise.allSettled fan-out so one slow site
 * doesn't block the whole resolver.
 */
export async function resolveCrossSite(intent) {
  const targets = CROSS_SITE_INTENT[intent]
  if (!targets || targets.length === 0) return EMPTY

  // Lazy imports — only loaded when this resolver is reached.
  const [{ registry }, ep] = await Promise.all([
    import('./sources/index.js').catch(() => ({})),
    import('./sources/eporner.js').catch(() => null),
  ])
  if (!registry) {
    logger.warn('cross_site: registry unavailable')
    return EMPTY
  }

  const promises = targets.map(async (t) => {
    try {
      if (t.eporner && ep) {
        const videos = await ep.search({ query: t.query || '', order: t.eporner, perPage: 12 })
        return videos
      }
      if (t.domain && t.path) {
        const url = `https://www.${t.domain}${t.path}`
        const result = await registry.search(url, { site: t.domain, limit: 12 })
        const videos = Array.isArray(result) ? result : (result?.videos || [])
        return videos
      }
      return []
    } catch (err) {
      logger.debug('cross_site target failed', { target: t, error: err.message })
      return []
    }
  })

  const settled = await Promise.allSettled(promises)
  const seen = new Set()
  const merged = []
  for (const r of settled) {
    if (r.status !== 'fulfilled') continue
    for (const v of (r.value || [])) {
      const u = v?.url
      if (!u || seen.has(u)) continue
      seen.add(u)
      merged.push(v)
    }
  }
  return { topics: [], creators: [], directVideos: merged }
}
