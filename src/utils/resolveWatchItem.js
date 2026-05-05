// ============================================================
// resolveWatchItem
// Bridges the three id namespaces that converge at /watch/:id:
//   - homeStore: composite "{categoryKey}_{videoId}" or hero/top10 ids
//   - libraryStore: bare UUIDs (Continue Watching deep links)
//   - queueStore: server-PK numbers from the queue table
// VDP's id param can be any of these; fall through in priority order
// so hero/top10/category items win, then library, then queue.
// Returns the item shape VDP expects, or null.
// ============================================================

export function resolveWatchItem(id, sources) {
  if (!id) return null
  const sId = String(id)
  const {
    heroItem,
    carouselItems,
    top10,
    categories,
    libraryVideos,
    queueItems,
  } = sources || {}

  if (heroItem && String(heroItem.id) === sId) return heroItem

  for (const c of carouselItems || []) {
    if (c && String(c.id) === sId) return c
  }
  for (const c of top10 || []) {
    if (c && String(c.id) === sId) return c
  }
  for (const cat of categories || []) {
    for (const v of (cat.items || [])) {
      if (v && !v._isDivider && String(v.id) === sId) return v
    }
  }

  for (const v of libraryVideos || []) {
    if (v && String(v.id) === sId) return v
  }

  for (const q of queueItems || []) {
    if (q && String(q.id) === sId) {
      return {
        id: q.id,
        url: q.url || q.video_url,
        title: q.title,
        thumbnail: q.thumbnail,
        duration: q.duration,
        durationFormatted: q.durationFormatted || q.duration_formatted,
        uploader: q.uploader || '',
        tags: q.tags || [],
      }
    }
  }

  return null
}

export default resolveWatchItem
