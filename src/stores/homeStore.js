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
const featuredLabels = ['New Release', 'Trending Now', 'Staff Pick', 'Most Viewed', "Editor's Choice", 'Just Added', 'Top Rated']
const featuredTaglines = [
  'The one everyone is talking about.',
  "The one you've been waiting for.",
  'Handpicked by our editors.',
  "The internet can't stop watching.",
  'A once-in-a-season find.',
  'Fresh off the server.',
  'Consistently exceptional.',
]

const rnd = (n) => Math.floor(Math.random() * n)
const fmtDur = (s) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
const fmtViews = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(n))

let idCounter = 100

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

  // Featured carousel
  featuredItems: [],
  featuredIndex: 0,

  // Category rows
  categories: [],

  // Actions
  setHeroItem: (item) => set({ heroItem: item }),
  setTheatreMode: (on) => set({ theatreMode: on }),
  toggleTheatre: () => set((s) => ({ theatreMode: !s.theatreMode })),

  setFeaturedIndex: (idx) => {
    const { featuredItems } = get()
    set({ featuredIndex: Math.max(0, Math.min(featuredItems.length - 1, idx)) })
  },

  advanceFeatured: () => {
    const { featuredItems, featuredIndex } = get()
    set({ featuredIndex: (featuredIndex + 1) % featuredItems.length })
  },

  // Generate placeholder data (fallback when API has no cached content)
  generateData: () => {
    idCounter = 100
    const carouselItems = genItems(24)

    idCounter = 900
    const featuredItems = genItems(7).map((item, _i) => ({
      ...item,
      featuredLabel: featuredLabels[_i % featuredLabels.length],
      featuredTagline: featuredTaglines[_i % featuredTaglines.length],
    }))

    const categoryDefs = [
      { label: 'Trending Now', seed: 300 },
      { label: 'Popular This Week', seed: 420 },
      { label: 'New Arrivals', seed: 550 },
      { label: 'Staff Picks', seed: 680 },
    ]
    const categories = categoryDefs.map((cat) => {
      idCounter = cat.seed
      return { label: cat.label, items: genItems(14) }
    })

    set({
      carouselItems,
      heroItem: carouselItems[0],
      featuredItems,
      featuredIndex: 0,
      categories,
    })
  },

  // Nuclear reset: clear all content (used on mode switch)
  resetHome: () => set({
    heroItem: null,
    carouselItems: [],
    theatreMode: false,
    featuredItems: [],
    featuredIndex: 0,
    categories: [],
  }),

  // Fetch real data from backend. Falls back to placeholders if empty.
  fetchHomepage: async (mode = 'social') => {
    try {
      const res = await fetch(`/api/homepage?mode=${mode}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()

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
        rating: (7 + Math.random() * 2.5).toFixed(1),
        url: v.url,
        tags: v.tags || [],
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

      // Featured: pick 7 diverse videos, add featured labels
      const featuredItems = allVideos
        .filter((_, i) => i % Math.max(1, Math.floor(allVideos.length / 7)) === 0)
        .slice(0, 7)
        .map((item, i) => ({
          ...item,
          featuredLabel: featuredLabels[i % featuredLabels.length],
          featuredTagline: featuredTaglines[i % featuredTaglines.length],
        }))

      // Category rows from API groupings
      const categories = data.categories
        .filter(cat => cat.videos.length > 0)
        .map(cat => ({
          label: cat.label,
          items: cat.videos.map(mapVideo),
        }))

      set({
        carouselItems,
        heroItem: carouselItems[0],
        featuredItems: featuredItems.length >= 3 ? featuredItems : get().featuredItems,
        featuredIndex: 0,
        categories: categories.length > 0 ? categories : get().categories,
      })
    } catch (err) {
      console.warn('Homepage fetch failed, using placeholders:', err.message)
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
