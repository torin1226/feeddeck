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

export default function useSuggested(seedId) {
  const categories = useHomeStore((s) => s.categories)
  const likedTagsSetRaw = useHomeStore((s) => s._likedTagsCache)

  return useMemo(() => {
    if (!categories || !categories.length) return { related: [], recommended: [] }

    // Flatten with _category tag annotated on each item.
    const all = []
    let seed = null
    let seedCategory = null
    for (const cat of categories) {
      for (const it of (cat.items || [])) {
        if (!it || it._isDivider) continue
        const annotated = { ...it, _category: cat.label || cat.id }
        all.push(annotated)
        if (String(it.id) === String(seedId)) {
          seed = annotated
          seedCategory = annotated._category
        }
      }
    }

    if (!seed) return { related: [], recommended: all.slice(0, RECOMMENDED_LIMIT) }

    const seedTags = tagSetOf(seed)
    const seedKey = String(seed.id)

    // Related: score every other item for relatedness, keep top N positives.
    const scored = []
    for (const c of all) {
      if (String(c.id) === seedKey) continue
      const sc = relatedness(seed, c, seedTags, seedCategory)
      if (sc > 0) scored.push({ item: c, score: sc })
    }
    scored.sort((a, b) => b.score - a.score)
    const related = scored.slice(0, RELATED_LIMIT).map((s) => s.item)

    // Recommended: items NOT in related, ranked by taste-score (or just first-seen).
    const relatedIds = new Set(related.map((r) => String(r.id)))
    const likedTags = likedTagsSetRaw instanceof Set ? likedTagsSetRaw : null
    const recPool = all.filter((c) => String(c.id) !== seedKey && !relatedIds.has(String(c.id)))
    if (likedTags && likedTags.size > 0) {
      recPool.sort((a, b) => tasteScore(b, likedTags) - tasteScore(a, likedTags))
    }
    const recommended = recPool.slice(0, RECOMMENDED_LIMIT)

    return { related, recommended }
  }, [categories, seedId, likedTagsSetRaw])
}
