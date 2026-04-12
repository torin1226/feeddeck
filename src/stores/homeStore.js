import { create } from 'zustand'

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

const useHomeStore = create((set, get) => ({
  // Hero
  heroItem: null,
  carouselItems: [],
  theatreMode: false,
  inlinePlay: false, // true = video playing in hero area, categories still visible
  // Error from last failed homepage fetch (null = no error)
  fetchError: null,

  // Category rows
  categories: [],

  // Top 10 (ranked by view count)
  top10: [],

  // Actions
  setHeroItem: (item) => set({ heroItem: item }),
  setTheatreMode: (on) => set({ theatreMode: on, inlinePlay: false }),
  toggleTheatre: () => set((s) => ({ theatreMode: !s.theatreMode, inlinePlay: false })),
  startInlinePlay: () => set({ inlinePlay: true, theatreMode: false }),
  stopInlinePlay: () => set({ inlinePlay: false }),

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
      top10: [],
    })
  },

  // Fetch real data from backend. Falls back to placeholders if empty.
  fetchHomepage: async (mode = 'social') => {
    const version = ++_fetchVersion
    // Clear stale content immediately so UI shows loading state
    set({ heroItem: null, carouselItems: [], categories: [], top10: [], fetchError: null })
    try {
      const res = await fetch(`/api/homepage?mode=${mode}`)
      if (version !== _fetchVersion) return // Stale fetch (mode changed or resetHome called)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (version !== _fetchVersion) return // Stale fetch

      // Map API videos to the shape components expect
      const mapVideo = (v, _i) => ({
        id: v.id,
        title: v.title || 'Untitled',
        thumbnail: v.thumbnail || `https://picsum.photos/seed/${v.id}/1280/720`,
        thumbnailSm: v.thumbnail || `https://picsum.photos/seed/${v.id}/320/180`,
        duration: v.durationFormatted || fmtDur(v.duration || 0),
        durationSec: v.duration || 0,
        views: fmtViews(v.view_count || 0),
        uploader: v.uploader || v.source || 'Unknown',
        daysAgo: Math.max(1, Math.floor((Date.now() - new Date(v.fetched_at || Date.now()).getTime()) / 86400000)),
        desc: v.title || '',
        genre: v.source || 'Video',
        rating: v.rating != null ? Number(v.rating).toFixed(1) : null,
        url: v.url,
        tags: v.tags || [],
        orient: (v.height && v.width && v.height > v.width) ? 'v' : 'h',
      })

      // Collect all videos from all categories for carousel/hero/featured
      const allVideos = data.categories.flatMap(cat => cat.videos).map(mapVideo)

      if (allVideos.length === 0) {
        // No cached content yet — fall back to placeholders
        get().generateData()
        return
      }

      // Hero carousel: first 24 videos (or all if fewer)
      const carouselItems = allVideos.slice(0, 24)

      // Category rows from API groupings, sorted by tag preferences
      let categories = data.categories
        .filter(cat => cat.videos.length > 0)
        .map(cat => ({
          label: cat.label,
          items: cat.videos.map(mapVideo),
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
            }).sort((a, b) => b._score - a._score)
          }
        }
      } catch { /* non-fatal — categories render in API order */ }

      // Personalize row titles based on content characteristics
      const usedLabels = new Set()
      categories = categories.map(cat => {
        let label = personalizeLabel(cat.label, cat.items, likedTags)
        // Avoid duplicate personalized labels — fall back to original
        if (usedLabels.has(label) && label !== cat.label) label = cat.label
        usedLabels.add(label)
        return { ...cat, originalLabel: cat.label, label }
      })

      // Build Top 10 by view count
      const top10 = [...allVideos]
        .sort((a, b) => parseViews(b.views) - parseViews(a.views))
        .slice(0, 10)
        .map((v, i) => ({ ...v, rank: i + 1 }))

      set({
        carouselItems,
        heroItem: carouselItems[0],
        categories: categories.length > 0 ? categories : get().categories,
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
}))

export default useHomeStore
