/**
 * buildReason — pure recommendation attribution helper
 * Returns the highest-priority "Why this card?" signal for a feed item.
 * No I/O, no side effects.
 */

export const PRIORITY = ['creator', 'subscription', 'tag', 'topic']

/**
 * loadReasonSignals — reads the three signal Sets needed by buildReason
 * once per request. Defensive: each query is independently try/wrapped so
 * older DBs that lack one of the tables still return a usable signals shape.
 *
 * The mode arg is currently unused — taste_profile and the boost/sub tables
 * are not mode-partitioned in the schema today. Kept on the signature so
 * callers pass through the request's mode for future mode-scoped variants
 * without another fan-out.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {{ boostedCreators: Set<string>, subscriptions: Set<string>, likedTags: Set<string> }}
 */
export function loadReasonSignals(db) {
  const boostedCreators = new Set()
  const subscriptions = new Set()
  const likedTags = new Set()
  try {
    for (const row of db.prepare('SELECT creator FROM creator_boosts WHERE boost_score > 0').all()) {
      if (row.creator) boostedCreators.add(String(row.creator).toLowerCase().trim())
    }
  } catch { /* table may not exist on older DBs */ }
  try {
    for (const row of db.prepare('SELECT handle FROM subscription_backups').all()) {
      if (row.handle) subscriptions.add(String(row.handle).toLowerCase().trim())
    }
  } catch { /* */ }
  try {
    for (const row of db.prepare("SELECT signal_value FROM taste_profile WHERE signal_type = 'tag' AND weight > 0").all()) {
      if (row.signal_value) likedTags.add(String(row.signal_value).toLowerCase().trim())
    }
  } catch { /* */ }
  return { boostedCreators, subscriptions, likedTags }
}

/**
 * @param {object|null|undefined} item
 * @param {{ boostedCreators?: Set<string>, subscriptions?: Set<string>, likedTags?: Set<string> }} signals
 * @returns {{ kind: string, label: string } | null}
 */
export function buildReason(item, signals) {
  if (item == null) return null

  const uploader = item.uploader
  const key = typeof uploader === 'string' ? uploader.trim().toLowerCase() : ''

  if (key && signals.boostedCreators?.has(key)) {
    return { kind: 'creator', label: `Because you watch ${uploader}` }
  }

  if (key && signals.subscriptions?.has(key)) {
    return { kind: 'subscription', label: 'From your subscriptions' }
  }

  if (Array.isArray(item.tags) && signals.likedTags) {
    for (const tag of item.tags) {
      if (signals.likedTags.has(String(tag).toLowerCase())) {
        return { kind: 'tag', label: `Because you liked ${String(tag).toLowerCase()}` }
      }
    }
  }

  if (item.topicSource) {
    const seed = String(item.topicSource).replace(/^(trends24:|liked_tags:)/, '')
    return { kind: 'topic', label: `Trending in ${seed}` }
  }

  return null
}
