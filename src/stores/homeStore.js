import { create } from 'zustand'
import { inferMode, urlOf } from '../utils/mode'
import useToastStore from './toastStore'

// ============================================================
// Home Store
// Ephemeral session state for the homepage. No persistence.
// Generates placeholder data on init — will be replaced by
// fetchHomepage(mode) when the backend is wired.
// ============================================================

const breeds = ['Golden Retriever', 'Corgi', 'Poodle', 'Beagle', 'Husky', 'Dachshund', 'Lab', 'Boxer', 'Spaniel', 'Pug']
const adjectives = ['Tiny', 'Fluffy', 'Bouncy', 'Silly', 'Playful', 'Sleepy', 'Curious', 'Happy', 'Chonky', 'Derpy']
const verbs = ['at the Beach', 'in the Snow', 'vs. a Leaf', 'Discovers Stairs', 'Learns Fetch', 'Meets a Cat', 'Does Zoomies', 'Finds Puddle', 'Bath Time', 'Park Day']
const descs = [
  'This absolute unit has never seen the ocean before. Watch what happens next.',
  'First snowfall. Many confuses. Very soft. Cannot process.',
  'Zero braincells. Maximum serotonin. Fully committed to the bit.',
  'This dog has been thinking about this moment its entire life.',
  'Nobody prepared them for this. Not a single soul.',
]
const genres = ['Golden Hour', 'Chaos Energy', 'Too Pure', 'Certified Bork', 'Drama Queen']

const rnd = (n) => Math.floor(Math.random() * n)
const fmtDur = (s) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
const fmtViews = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(n))

let idCounter = 100
let _fetchVersion = 0 // Guards against nuclearFlush/resetHome racing with fetchHomepage
let _swapVersion = 0 // Guards against mode-change racing with refresh/shuffle swaps

// Per-pinned-row rotation offset, advanced by shuffleHome.
// persistent_row_items has no `viewed` flag, so pinned rows can't be
// rotated server-side like homepage_cache rows. We rotate client-side
// and re-apply the offset on every fetchHomepage so the rotation
// survives /home navigation. Module-level (not zustand state) so the
// offset isn't reset by store wipes; it does reset on full reload.
const _pinnedOffsets = new Map() // row key -> integer offset

// Pinned rows that should NEVER shuffle. The user's saved likes are
// curated content; users care about their order, not novelty.
const PINNED_NO_SHUFFLE = new Set(['ph_likes'])

// Shared video-mapper used by fetchHomepage and the refresh/shuffle swap path.
// Mirrors the mapVideo at fetchHomepage (kept inline there for locality).
const _parseUploadDate = (s) => {
  if (!s) return 0
  if (typeof s === 'string' && /^\d{8}$/.test(s)) {
    const y = +s.slice(0, 4), m = +s.slice(4, 6), d = +s.slice(6, 8)
    const t = Date.UTC(y, m - 1, d)
    return Number.isNaN(t) ? 0 : t
  }
  const t = new Date(s).getTime()
  return Number.isNaN(t) ? 0 : t
}

function _mapApiVideo(v) {
  const uploadTs = _parseUploadDate(v.upload_date)
  const fetchedTs = v.fetched_at ? new Date(v.fetched_at).getTime() : 0
  const effectiveTs = uploadTs || fetchedTs || Date.now()
  return {
    id: v.id,
    title: v.title || 'Untitled',
    thumbnail: v.thumbnail || `https://picsum.photos/seed/${v.id}/1280/720`,
    thumbnailSm: v.thumbnail || `https://picsum.photos/seed/${v.id}/320/180`,
    duration: v.durationFormatted || fmtDur(v.duration || 0),
    durationSec: v.duration || 0,
    views: fmtViews(v.view_count || 0),
    uploader: v.uploader || v.source || 'Unknown',
    daysAgo: Math.max(1, Math.floor((Date.now() - effectiveTs) / 86400000)),
    desc: v.title || '',
    genre: v.source || 'Video',
    rating: v.rating != null ? Number(v.rating).toFixed(1) : null,
    url: v.url,
    tags: v.tags || [],
    orient: (v.height && v.width && v.height > v.width) ? 'v' : 'h',
    uploadTs,
    fetchedTs,
  }
}


// Parse formatted view strings ("4.2M", "850K", "1200") back to numbers
const parseViews = (s) => {
  if (!s) return 0
  if (s.includes('M')) return parseFloat(s) * 1e6
  if (s.includes('K')) return parseFloat(s) * 1e3
  return parseInt(s, 10) || 0
}

// Generate a personalized row title based on the category's content characteristics
function personalizeLabel(originalLabel, items, likedTags) {
  if (!items || items.length === 0) return originalLabel

  // Check if most items are short (<3 min)
  const shortCount = items.filter(v => v.durationSec > 0 && v.durationSec < 180).length
  if (shortCount > items.length * 0.6) return 'Quick Hits'

  // Check if most items are long (>20 min)
  const longCount = items.filter(v => v.durationSec > 1200).length
  if (longCount > items.length * 0.6) return 'Long Watches'

  // Check if items are very recent (<3 days old)
  const freshCount = items.filter(v => v.daysAgo <= 3).length
  if (freshCount > items.length * 0.5) return 'Just Dropped'

  // Check if items strongly match liked tags
  if (likedTags && likedTags.size > 0) {
    const matchCount = items.filter(v =>
      (v.tags || []).some(t => likedTags.has(t.toLowerCase()))
    ).length
    if (matchCount > items.length * 0.5) return 'Picked for You'
  }

  // Check if most items share an uploader
  const uploaderCounts = {}
  for (const v of items) {
    if (v.uploader) uploaderCounts[v.uploader] = (uploaderCounts[v.uploader] || 0) + 1
  }
  const topUploader = Object.entries(uploaderCounts).sort((a, b) => b[1] - a[1])[0]
  if (topUploader && topUploader[1] > items.length * 0.4) {
    return `More from ${topUploader[0]}`
  }

  // Check if most items have high view counts (>500K)
  const highViewCount = items.filter(v => parseViews(v.views) > 500000).length
  if (highViewCount > items.length * 0.5) return 'Most Viewed'

  return originalLabel
}

function makeItem() {
  const seed = idCounter++
  return {
    id: `home-${seed}`,
    title: `${adjectives[rnd(adjectives.length)]} ${breeds[rnd(breeds.length)]} ${verbs[rnd(verbs.length)]}`,
    thumbnail: `https://picsum.photos/seed/${seed}/1280/720`,
    thumbnailSm: `https://picsum.photos/seed/${seed}/320/180`,
    duration: fmtDur(45 + rnd(1800)),
    durationSec: 45 + rnd(1800),
    views: fmtViews(500 + rnd(9500000)),
    uploader: breeds[rnd(breeds.length)] + 'TV',
    daysAgo: rnd(30) + 1,
    desc: descs[rnd(descs.length)],
    genre: genres[rnd(genres.length)],
    rating: (7 + Math.random() * 2.5).toFixed(1),
    orient: Math.random() > 0.6 ? 'v' : 'h',
  }
}

function genItems(n) {
  return Array.from({ length: n }, makeItem)
}

// Initial pool size on hydrate — first N categories tagged into the flat pool.
const INITIAL_POOL_CATEGORIES = 2

const useHomeStore = create((set, get) => ({
  // Hero
  heroItem: null,
  carouselItems: [],
  theatreMode: false,
  inlinePlay: false, // true = video playing in hero area, categories still visible
  // Error from last failed homepage fetch (null = no error)
  fetchError: null,

  // Single source of truth for "what card is the user looking at right now."
  // Owned by whichever surface most recently took focus (hero, gallery row,
  // top10, etc.). Consumers (preview hooks, feed dedup) subscribe here
  // instead of taking explicit start/cancel calls per card. Cleared on
  // resetHome and on fetchHomepage start.
  focusedItem: null,

  // Category rows
  categories: [],

  // Indices of categories already merged into the flat carousel pool (5c.2b).
  // Order in this array = order they appear in the carousel.
  loadedCategoryIndices: [],

  // Top 10 (ranked by view count)
  top10: [],

  // Transient flags for settings-page Refresh/Shuffle buttons.
  refreshing: false,
  shuffling: false,

  // Actions
  setHeroItem: (item) => set({ heroItem: item }),
  setTheatreMode: (on) => set({ theatreMode: on, inlinePlay: false }),
  toggleTheatre: () => set((s) => ({ theatreMode: !s.theatreMode, inlinePlay: false })),
  startInlinePlay: () => set({ inlinePlay: true, theatreMode: false }),
  stopInlinePlay: () => set({ inlinePlay: false }),

  // Set focusedItem to the given content object on the given surface.
  // Pass `item = null` to clear focus. Surface examples:
  //   'hero' | 'hero-carousel' | 'gallery-shelf' | 'browse-row:<key>'
  //   | 'top10' | 'continue-watching' | 'liked'
  // The setter is a no-op when the same item+surface is already focused,
  // so subscribers don't get woken on duplicate calls during scroll.
  setFocusedItem: (item, surface) => {
    if (!item) {
      if (get().focusedItem === null) return
      return set({ focusedItem: null })
    }
    const url = urlOf(item)
    const id = item.id ?? url ?? null
    if (id == null) return
    const next = {
      id,
      url,
      surface: surface || 'unknown',
      mode: item.mode === 'social' || item.mode === 'nsfw'
        ? item.mode
        : inferMode(url || ''),
    }
    const prev = get().focusedItem
    if (prev && prev.id === next.id && prev.surface === next.surface) return
    set({ focusedItem: next })
  },

  // Generate placeholder data (fallback when API has no cached content)
  generateData: () => {
    idCounter = 100
    const carouselItems = genItems(24)

    const categoryDefs = [
      { label: 'Live Music', seed: 300 },
      { label: 'My Subscriptions', seed: 420 },
      { label: 'Trending', seed: 550 },
    ]
    const categories = categoryDefs.map((cat) => {
      idCounter = cat.seed
      return { label: cat.label, items: genItems(14) }
    })

    set({
      carouselItems,
      heroItem: carouselItems[0],
      categories,
      loadedCategoryIndices: categories
        .slice(0, INITIAL_POOL_CATEGORIES)
        .map((_, i) => i),
    })
  },

  // Nuclear reset: clear all content (used on mode switch)
  resetHome: () => {
    _fetchVersion++ // Invalidate any in-flight fetchHomepage
    set({
      heroItem: null,
      carouselItems: [],
      theatreMode: false,
      categories: [],
      loadedCategoryIndices: [],
      top10: [],
      focusedItem: null,
    })
  },

  // Append the next unloaded category to the carousel pool (5c.2b).
  // Called when the user nears the end of the current pool, or when
  // they click the peek-row. Returns the appended category's index, or
  // null if there's nothing left to load.
  loadNextCategory: () => {
    const { categories, loadedCategoryIndices } = get()
    const loaded = new Set(loadedCategoryIndices)
    for (let i = 0; i < categories.length; i++) {
      if (!loaded.has(i)) {
        set({ loadedCategoryIndices: [...loadedCategoryIndices, i] })
        return i
      }
    }
    return null
  },

  // Hydrate a specific category by index (used by peek-row click).
  // Returns true if it was newly loaded, false if already in pool.
  loadCategoryAt: (index) => {
    const { categories, loadedCategoryIndices } = get()
    if (index < 0 || index >= categories.length) return false
    if (loadedCategoryIndices.includes(index)) return false
    set({ loadedCategoryIndices: [...loadedCategoryIndices, index] })
    return true
  },

  // Fetch real data from backend. Falls back to placeholders if empty.
  fetchHomepage: async (mode = 'social') => {
    const version = ++_fetchVersion
    // Clear stale content immediately so UI shows loading state
    set({ heroItem: null, carouselItems: [], categories: [], loadedCategoryIndices: [], top10: [], fetchError: null, focusedItem: null })
    try {
      const res = await fetch(`/api/homepage?mode=${mode}`)
      if (version !== _fetchVersion) return // Stale fetch (mode changed or resetHome called)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (version !== _fetchVersion) return // Stale fetch

      // Parse yt-dlp's upload_date — handles bare "YYYYMMDD" and ISO 8601.
      // Returns ms timestamp, or 0 if missing/unparseable.
      const parseUploadDate = (s) => {
        if (!s) return 0
        if (typeof s === 'string' && /^\d{8}$/.test(s)) {
          const y = +s.slice(0, 4), m = +s.slice(4, 6), d = +s.slice(6, 8)
          const t = Date.UTC(y, m - 1, d)
          return Number.isNaN(t) ? 0 : t
        }
        const t = new Date(s).getTime()
        return Number.isNaN(t) ? 0 : t
      }

      // Map API videos to the shape components expect
      const mapVideo = (v, _i) => {
        const uploadTs = parseUploadDate(v.upload_date)
        const fetchedTs = v.fetched_at ? new Date(v.fetched_at).getTime() : 0
        const effectiveTs = uploadTs || fetchedTs || Date.now()
        return {
          id: v.id,
          title: v.title || 'Untitled',
          thumbnail: v.thumbnail || `https://picsum.photos/seed/${v.id}/1280/720`,
          thumbnailSm: v.thumbnail || `https://picsum.photos/seed/${v.id}/320/180`,
          duration: v.durationFormatted || fmtDur(v.duration || 0),
          durationSec: v.duration || 0,
          views: fmtViews(v.view_count || 0),
          uploader: v.uploader || v.source || 'Unknown',
          daysAgo: Math.max(1, Math.floor((Date.now() - effectiveTs) / 86400000)),
          desc: v.title || '',
          genre: v.source || 'Video',
          rating: v.rating != null ? Number(v.rating).toFixed(1) : null,
          url: v.url,
          tags: v.tags || [],
          orient: (v.height && v.width && v.height > v.width) ? 'v' : 'h',
          uploadTs,
          fetchedTs,
        }
      }

      // Collect all videos from all categories for carousel/hero/featured
      const allVideos = data.categories.flatMap(cat =>
        cat.videos.map(v => ({
          ...mapVideo(v),
          _fromSubscriptions: cat.key === 'social_subscriptions',
        }))
      )

      if (allVideos.length === 0) {
        // No cached content yet — fall back to placeholders
        get().generateData()
        return
      }

      // Hide stale-but-cached content (e.g. 2020 videos) from non-pinned shelves.
      // Pinned shelves (subscriptions, liked videos) keep all items — the user
      // opted into those. Drop categories that have no fresh content left.
      // Items with no upload_date (Puppeteer scrapers don't set it) pass through —
      // we can't judge their age, and they were recently scraped so they're likely current.
      const RECENT_MS = 180 * 86400000
      const freshNow = Date.now()
      const isFresh = (v) => v.uploadTs === 0 || (freshNow - v.uploadTs) <= RECENT_MS

      // Category rows from API groupings. `pinned` flag flows from persistent_rows
      // (see /api/homepage) and prevents re-sort from displacing them.
      // If isFresh empties a row, fall back to the unfiltered list so depleted
      // rows (after repeated shuffles) keep showing content rather than vanishing.
      // Pinned rows (except ph_likes) honor `_pinnedOffsets` so a prior shuffle's
      // rotation persists when the user navigates back to /home.
      let categories = data.categories
        .filter(cat => cat.videos.length > 0)
        .map(cat => {
          const isPinned = !!cat.pinned
          const mapped = cat.videos.map(mapVideo)
          let items = isPinned ? mapped : mapped.filter(isFresh)
          if (!isPinned && items.length === 0) items = mapped
          items.sort((a, b) => {
            if (b.uploadTs !== a.uploadTs) return b.uploadTs - a.uploadTs
            return b.fetchedTs - a.fetchedTs
          })
          if (isPinned && cat.key && !PINNED_NO_SHUFFLE.has(cat.key) && items.length > 0) {
            const off = (_pinnedOffsets.get(cat.key) || 0) % items.length
            if (off > 0) items = [...items.slice(off), ...items.slice(0, off)]
          }
          return {
            label: cat.label,
            items,
            _pinned: isPinned,
            _key: cat.key,
          }
        })
        .filter(cat => cat.items.length > 0)

      // === Global URL-based dedup ===
      // Videos can appear in multiple API categories with different IDs
      // (e.g. RedGifs composite IDs). URL is the true unique key.
      // First: deduplicate within/across category rows themselves so the
      // same video only lives in the first category that contains it.
      const seenInCats = new Set()
      categories = categories.map(cat => ({
        ...cat,
        items: cat.items.filter(v => {
          const key = v.url || v.id
          if (seenInCats.has(key)) return false
          seenInCats.add(key)
          return true
        }),
      })).filter(cat => cat.items.length > 0)

      // Each tier claims URLs in priority order; lower tiers get stripped.
      const claimedUrls = new Set()
      const claimUrl = (v) => {
        const key = v.url || v.id
        if (claimedUrls.has(key)) return false
        claimedUrls.add(key)
        return true
      }
      const isUnclaimed = (v) => !claimedUrls.has(v.url || v.id)

      // Hero carousel: round-robin sample across categories for diversity.
      const carouselItems = []
      const maxPerCat = Math.ceil(24 / (categories.length || 1))
      for (let round = 0; round < maxPerCat && carouselItems.length < 24; round++) {
        for (const cat of categories) {
          if (round < cat.items.length && carouselItems.length < 24) {
            const v = cat.items[round]
            if (claimUrl(v)) {
              carouselItems.push(v)
            }
          }
        }
      }

      // Strip claimed URLs from category rows
      categories = categories.map(cat => ({
        ...cat,
        items: cat.items.filter(isUnclaimed),
      }))

      // Client-side recommendation scoring: boost categories with liked tags + personalize titles
      let likedTags = new Set()
      try {
        const tagRes = await fetch('/api/tags/preferences')
        if (version !== _fetchVersion) return
        if (tagRes.ok) {
          const prefs = await tagRes.json()
          likedTags = new Set((prefs.liked || []).map(t => t.toLowerCase()))
          const disliked = new Set((prefs.disliked || []).map(t => t.toLowerCase()))

          if (likedTags.size > 0 || disliked.size > 0) {
            categories = categories.map(cat => {
              let score = 0
              for (const item of cat.items) {
                for (const tag of (item.tags || [])) {
                  const t = tag.toLowerCase()
                  if (likedTags.has(t)) score += 2
                  if (disliked.has(t)) score -= 5
                }
              }
              return { ...cat, _score: score }
            }).sort((a, b) => {
              // Pinned rows (persistent_rows: PH likes, subscriptions, top models)
              // always lead, ordered by their server-side sort_order.
              if (a._pinned && !b._pinned) return -1
              if (b._pinned && !a._pinned) return 1
              return b._score - a._score
            })
          }
        }
      } catch { /* non-fatal — categories render in API order */ }

      // Personalize row titles based on content characteristics
      const usedLabels = new Set()
      categories = categories.map(cat => {
        // Pinned rows (persistent shelves) keep their authored label as-is.
        let label = cat._pinned ? cat.label : personalizeLabel(cat.label, cat.items, likedTags)
        // Avoid duplicate personalized labels — fall back to original
        if (usedLabels.has(label) && label !== cat.label) label = cat.label
        usedLabels.add(label)
        return { ...cat, originalLabel: cat.label, label }
      })

      // Build Top 10 with personalization: tag affinity + subscription boost + view count.
      // Subscription content is exempt from the freshness filter — user opted in.
      // Deduped against carousel (already claimed). Top10 claims its own URLs so
      // they won't repeat in BrowseSection category rows.
      const top10 = [...allVideos]
        .filter(v => v._fromSubscriptions || isFresh(v))
        .filter(isUnclaimed)
        .map(v => {
          let score = parseViews(v.views)
          if (likedTags.size > 0) {
            const matchCount = (v.tags || []).filter(t => likedTags.has(t.toLowerCase())).length
            if (matchCount > 0) score *= (1 + matchCount * 0.5)
          }
          if (v._fromSubscriptions) score *= 1.3
          return { ...v, _score: score }
        })
        .sort((a, b) => b._score - a._score)
        .slice(0, 10)
        .map((v, i) => { claimUrl(v); return { ...v, rank: i + 1 } })

      // Final pass: strip Top10-claimed URLs from category rows
      categories = categories.map(cat => ({
        ...cat,
        items: cat.items.filter(isUnclaimed),
      })).filter(cat => cat.items.length > 0)

      const finalCategories = categories.length > 0 ? categories : get().categories
      set({
        carouselItems,
        heroItem: carouselItems[0],
        categories: finalCategories,
        loadedCategoryIndices: finalCategories
          .slice(0, INITIAL_POOL_CATEGORIES)
          .map((_, i) => i),
        top10: top10.length >= 3 ? top10 : [],
      })
    } catch (err) {
      console.warn('Homepage fetch failed, using placeholders:', err.message)
      set({ fetchError: 'Server unreachable — showing sample content' })
      get().generateData()
    }
  },

  // Mark a video as viewed on the backend
  markViewed: async (id) => {
    try {
      await fetch(`/api/homepage/viewed?id=${encodeURIComponent(id)}`, { method: 'POST' })
    } catch { /* silent */ }
  },

  // ----------------------------------------------------------
  // Refresh + Shuffle (settings-page controls)
  //
  // Both feed fresh content into the existing categories array
  // in two phases: leftmost 5 cards per row swap immediately,
  // remaining cards swap ~600 ms later. Pinned rows are left
  // untouched in both phases.
  // ----------------------------------------------------------

  // Refresh the homepage. Two-phase, optimistic-first:
  //   1. Rotate immediately via shuffleHome so the user always sees motion.
  //   2. Trigger /api/homepage/warm in the background. When it completes:
  //        - added > 0 → swap fresh content in + success toast
  //        - added = 0 → cooldown-aware toast ("fresh content in ~Xm" or
  //          "nothing new from sources")
  //        - 429 (warm already in flight) → same as added = 0
  //
  // Why optimistic: a warm-cache pass takes 30–60s when sources need
  // fetching, and the prior /viewed POSTs serialize behind it. Awaiting
  // either path leaves the user staring at an unchanged homepage. By
  // rotating first, the click always feels responsive.
  refreshHome: async (mode = 'social') => {
    if (get().refreshing || get().shuffling) return
    set({ refreshing: true })
    const toast = useToastStore.getState().showToast
    try {
      // Phase 1: instant rotation (clear refreshing so shuffleHome's guard passes).
      set({ refreshing: false })
      await get().shuffleHome(mode)
    } catch (err) {
      console.warn('[homeStore] refreshHome shuffle failed:', err.message)
    }

    // Phase 2: background warm-cache pass + toast based on result.
    // Detached promise: the click handler returns immediately after shuffle.
    fetch(`/api/homepage/warm?mode=${mode}`, { method: 'POST' })
      .then(async res => {
        let added = 0
        let nextEligibleAt
        if (res.ok) {
          const body = await res.json().catch(() => ({}))
          added = body?.stats?.added ?? 0
          nextEligibleAt = body?.cooldown?.nextEligibleAt ?? null
        } else if (res.status === 429) {
          const body = await res.json().catch(() => ({}))
          nextEligibleAt = body?.cooldown?.nextEligibleAt ?? null
        } else {
          throw new Error(`Warm failed: HTTP ${res.status}`)
        }

        if (added > 0) {
          await get()._swapInFreshContent(mode)
          toast(`Got ${added} fresh items`, 'success')
        } else if (nextEligibleAt) {
          const mins = Math.max(1, Math.round((new Date(nextEligibleAt).getTime() - Date.now()) / 60000))
          toast(`Shuffled — fresh content in ~${mins}m`, 'info')
        } else {
          toast('Shuffled — nothing new from sources', 'info')
        }
      })
      .catch(err => {
        console.warn('[homeStore] refreshHome warm failed:', err.message)
      })
  },

  // Rotate visible content across all rows. Skips ph_likes (user-curated).
  //
  // Optimistic + instant: rotate every non-likes row client-side immediately
  // and clear `shuffling` on the next tick. Mark-viewed POSTs run in the
  // background so the rotation persists across /home navigation (next
  // fetchHomepage will exclude the marked items). Previously this awaited
  // every POST + a /api/homepage GET — when the server is busy (e.g. running
  // a warm-cache pass) those serial calls add 10–30s of latency before the
  // user sees anything change.
  //
  // Non-pinned rows (homepage_cache rows) ALSO send mark-viewed POSTs so
  // subsequent fetches don't re-surface the same items. Pinned rows
  // (persistent_row_items has no `viewed` flag) rely on `_pinnedOffsets`
  // re-applied by fetchHomepage to make the rotation survive navigation.
  shuffleHome: async (mode = 'social') => {
    const dbg = (kind, msg) => {
      if (typeof window === 'undefined') return
      const log = (window.__shuffleDebugLog ||= [])
      log.push({ t: Date.now(), kind, msg })
      if (log.length > 50) log.shift()
    }
    dbg('call', `shuffleHome(${mode}) — refreshing=${get().refreshing} shuffling=${get().shuffling} cats=${(get().categories || []).length}`)
    if (get().refreshing || get().shuffling) {
      dbg('bail', 'GUARD: refreshing or shuffling already true')
      return
    }
    set({ shuffling: true })
    const toast = useToastStore.getState().showToast
    try {
      // If categories is empty (user went straight to /settings without
      // visiting /home), fetch first so shuffle has something to rotate.
      if (((get().categories || []).length) === 0) {
        dbg('info', 'categories empty — calling fetchHomepage first')
        set({ shuffling: false })
        await get().fetchHomepage(mode)
        set({ shuffling: true })
        dbg('info', `after fetchHomepage cats=${(get().categories || []).length}`)
      }
      const cats = get().categories || []
      const idsToHide = []
      let rotatedCount = 0
      let skippedReasons = { likes: 0, oneOrZero: 0, stepZero: 0 }
      const ROTATE_BY = 5
      const rotated = cats.map(cat => {
        if (PINNED_NO_SHUFFLE.has(cat._key)) { skippedReasons.likes++; return cat }
        const items = cat.items || []
        if (items.length <= 1) { skippedReasons.oneOrZero++; return cat }
        // For rows shorter than ROTATE_BY, rotate by length-1 so the top
        // item still changes. Rotating by exactly items.length is a no-op.
        const step = items.length > ROTATE_BY ? ROTATE_BY : items.length - 1
        if (step <= 0) { skippedReasons.stepZero++; return cat }
        if (cat._pinned && cat._key) {
          const prev = _pinnedOffsets.get(cat._key) || 0
          _pinnedOffsets.set(cat._key, (prev + step) % items.length)
        } else {
          // Mark viewed only the items that fit the standard slice; for
          // small rows we still rotate but don't drain the cache.
          const markCount = Math.min(ROTATE_BY, items.length)
          for (const item of items.slice(0, markCount)) {
            if (item && item.id) idsToHide.push(item.id)
          }
        }
        rotatedCount++
        return { ...cat, items: [...items.slice(step), ...items.slice(0, step)] }
      })
      dbg('info', `mapped: ${rotatedCount} rotated, skipped likes=${skippedReasons.likes} small=${skippedReasons.oneOrZero} stepZero=${skippedReasons.stepZero}`)
      set({ categories: rotated })
      dbg('info', `set categories — new state cats=${(get().categories || []).length}`)
      // Fire-and-forget: mark-viewed POSTs run in the background. The
      // optimistic rotation is already on screen; these just persist it.
      for (const id of idsToHide) {
        fetch(`/api/homepage/viewed?id=${encodeURIComponent(id)}`, { method: 'POST' })
          .catch(() => {})
      }
      if (rotatedCount > 0) {
        toast(`Shuffled ${rotatedCount} row${rotatedCount === 1 ? '' : 's'}`, 'info')
      } else {
        toast('Nothing to shuffle yet', 'info')
      }
      dbg('done', `OK rotated=${rotatedCount} idsToHide=${idsToHide.length}`)
    } catch (err) {
      console.warn('[homeStore] shuffleHome failed:', err.message)
      dbg('error', `THROW: ${err.message}`)
    } finally {
      set({ shuffling: false })
    }
  },

  // Internal: refetch /api/homepage and stage-replace items in the
  // existing categories. Phase 1 swaps items[0..4]; Phase 2 (600 ms
  // later) swaps the tail. Pinned rows are skipped. Mode-change
  // during fetch invalidates the swap (mirrors fetchHomepage's
  // _fetchVersion guard).
  _swapInFreshContent: async (mode = 'social') => {
    const ver = ++_swapVersion
    const fetchVer = _fetchVersion
    let data
    try {
      const res = await fetch(`/api/homepage?mode=${mode}`)
      if (ver !== _swapVersion || fetchVer !== _fetchVersion) return
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      data = await res.json()
      if (ver !== _swapVersion || fetchVer !== _fetchVersion) return
    } catch (err) {
      console.warn('[homeStore] swap fetch failed:', err.message)
      return
    }

    const RECENT_MS = 180 * 86400000
    const now = Date.now()
    const isFresh = (v) => v.uploadTs === 0 || (now - v.uploadTs) <= RECENT_MS

    // Build fresh items per category, keyed by the API's raw label.
    // If the 180-day freshness filter empties a row, fall back to the
    // unfiltered API set. The user is shuffling — surfacing stale-but-
    // unviewed content beats keeping the same items on screen, and the
    // server has already excluded viewed items.
    const freshByLabel = new Map()
    for (const cat of (data.categories || [])) {
      if (!cat.videos || cat.videos.length === 0) continue
      const isPinned = !!cat.pinned
      const mapped = cat.videos.map(_mapApiVideo)
      let items = isPinned ? mapped : mapped.filter(isFresh)
      if (!isPinned && items.length === 0) items = mapped
      items.sort((a, b) => {
        if (b.uploadTs !== a.uploadTs) return b.uploadTs - a.uploadTs
        return b.fetchedTs - a.fetchedTs
      })
      if (items.length > 0) freshByLabel.set(cat.label, items)
    }

    // Dedup combined arrays by id so a fresh head and an untouched
    // old tail can't surface the same video twice (esp. on shuffle).
    const dedupById = (items) => {
      const seen = new Set()
      return items.filter(it => {
        if (!it || !it.id) return true
        if (seen.has(it.id)) return false
        seen.add(it.id)
        return true
      })
    }

    // Phase 1: replace leftmost-5 (or fewer if fresh is short),
    // keep items[5..] intact.
    const phase1 = () => {
      const existing = get().categories || []
      return existing.map(cat => {
        if (cat._pinned) return cat
        const fresh = freshByLabel.get(cat.originalLabel || cat.label)
        if (!fresh || fresh.length === 0) return cat
        const headLen = Math.min(5, fresh.length)
        const combined = dedupById([
          ...fresh.slice(0, headLen),
          ...(cat.items || []).slice(5),
        ])
        return { ...cat, items: combined }
      })
    }

    // Phase 2: replace the tail (items beyond index 5) with fresh[5..],
    // preserving the phase-1 head. Skipped if fresh has <=5 items.
    const phase2 = () => {
      const existing = get().categories || []
      return existing.map(cat => {
        if (cat._pinned) return cat
        const fresh = freshByLabel.get(cat.originalLabel || cat.label)
        if (!fresh || fresh.length <= 5) return cat
        const combined = dedupById([
          ...(cat.items || []).slice(0, 5),
          ...fresh.slice(5),
        ])
        return { ...cat, items: combined }
      })
    }

    if (ver !== _swapVersion || fetchVer !== _fetchVersion) return
    set({ categories: phase1() })

    // Phase 2: replace the remainder ~600 ms later so the user sees
    // visible cards update first; off-screen cards refresh after.
    setTimeout(() => {
      if (ver !== _swapVersion || fetchVer !== _fetchVersion) return
      set({ categories: phase2() })
    }, 600)
  },
}))

export default useHomeStore
