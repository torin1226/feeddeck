/**
 * buildReason — pure recommendation attribution helper
 * Returns the highest-priority "Why this card?" signal for a feed item.
 * No I/O, no side effects.
 */

export const PRIORITY = ['creator', 'subscription', 'tag', 'topic']

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
