import { useMemo } from 'react'
import useHomeStore from '../stores/homeStore'

// ============================================================
// useSuggested
// Computes two suggested-video lists for the watch page:
//   - related     : same tags / creator / category as `item`
//   - recommended : highest-affinity items unrelated to `item`
//                   (no overlap with `related`).
// Both lists exclude the current id and are capped.
// ============================================================

const RELATED_LIMIT = 12
const RECOMMENDED_LIMIT = 12

function lower(s) { return typeof s === 'string' ? s.toLowerCase() : '' }

function tagSetOf(item) {
  const out = new Set()
  for (const t of (item?.tags || [])) {
    if (typeof t === 'string') out.add(t.toLowerCase())
  }
  return out
}

// Score how related a candidate is to the seed item.
// Same creator → strong; shared tags → cumulative; same category → small boost.
function relatedness(seed, candidate, seedTags, seedCategory) {
  let score = 0
  if (seed.uploader && candidate.uploader && lower(seed.uploader) === lower(candidate.uploader)) {
    score += 5
  }
  if (seedCategory && candidate._category === seedCategory) {
    score += 1
  }
  for (const t of (candidate.tags || [])) {
    if (seedTags.has(lower(t))) score += 1
  }
  return score
}

// Score taste-affinity for a candidate against the user's liked-tag set.
// Used by the "recommended for you" list when no seed match applies.
function tasteScore(candidate, likedTags) {
  if (!likedTags || likedTags.size === 0) return 0
  let s = 0
  for (const t of (candidate.tags || [])) {
    if (likedTags.has(lower(t))) s += 1
  }
  // Tiebreak: higher view count → higher score (slight preference for popular).
  const v = String(candidate.views || '')
  const n = parseFloat(v.replace(/[^0-9.]/g, '')) || 0
  if (/M/i.test(v)) return s + n * 0.001
  if (/K/i.test(v)) return s + n * 0.000001
  return s
}

// Pure compute fn — exported so it can be unit-tested without React.
export function computeSuggested({
  seedId,
  categories,
  carouselItems,
  top10,
  heroItem,
  likedTags,
}) {
  if (!seedId) return { related: [], recommended: [] }

  const all = []
  const seenIds = new Set()
  let seed = null
  let seedCategory = null

  function consider(it, cat) {
    if (!it || it._isDivider) return
    const sid = String(it.id)
    if (seenIds.has(sid)) return
    seenIds.add(sid)
    const annotated = { ...it, _category: cat || it._category || '' }
    all.push(annotated)
    if (sid === String(seedId)) {
      seed = annotated
      seedCategory = annotated._category
    }
  }

  for (const cat of (categories || [])) {
    for (const it of (cat.items || [])) consider(it, cat.label || cat.id)
  }
  for (const c of (carouselItems || [])) consider(c, '')
  for (const c of (top10 || [])) consider(c, 'Top 10')
  if (heroItem) consider(heroItem, '')

  if (!seed) return { related: [], recommended: all.slice(0, RECOMMENDED_LIMIT) }

  const seedTags = tagSetOf(seed)
  const seedKey = String(seed.id)

  const scored = []
  for (const c of all) {
    if (String(c.id) === seedKey) continue
    const sc = relatedness(seed, c, seedTags, seedCategory)
    if (sc > 0) scored.push({ item: c, score: sc })
  }
  scored.sort((a, b) => b.score - a.score)
  let related = scored.slice(0, RELATED_LIMIT).map((s) => s.item)
  if (related.length === 0) {
    related = all
      .filter((c) => String(c.id) !== seedKey)
      .slice(0, RELATED_LIMIT)
  }

  const relatedIds = new Set(related.map((r) => String(r.id)))
  const likedTagsSet = likedTags instanceof Set ? likedTags : null
  const recPool = all.filter((c) => String(c.id) !== seedKey && !relatedIds.has(String(c.id)))
  if (likedTagsSet && likedTagsSet.size > 0) {
    recPool.sort((a, b) => tasteScore(b, likedTagsSet) - tasteScore(a, likedTagsSet))
  }
  const recommended = recPool.slice(0, RECOMMENDED_LIMIT)

  return { related, recommended }
}

export default function useSuggested(seedId) {
  const categories = useHomeStore((s) => s.categories)
  const carouselItems = useHomeStore((s) => s.carouselItems)
  const top10 = useHomeStore((s) => s.top10)
  const heroItem = useHomeStore((s) => s.heroItem)
  const likedTags = useHomeStore((s) => s._likedTagsCache)

  return useMemo(
    () => computeSuggested({ seedId, categories, carouselItems, top10, heroItem, likedTags }),
    [seedId, categories, carouselItems, top10, heroItem, likedTags],
  )
}
