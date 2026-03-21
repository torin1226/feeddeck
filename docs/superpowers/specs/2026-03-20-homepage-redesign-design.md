# Homepage Redesign — Design Spec

**Date**: 2026-03-20
**Status**: Draft
**Reference**: `../homepage-mockup.html`, `../HOMEPAGE_HANDOFF.md` (in parent `area 51/` folder, not inside `puppy-viewer/`)

---

## Summary

Replace the flat VideoGrid layout with a Netflix/Apple TV-style homepage featuring a hero section, carousel strip, scroll-driven featured carousel, and category rows. Priority: fix the scroll-driven zoom-out animation (layout thrashing, fragile snap logic).

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Page structure | React Router (`/` = homepage, `/library` = current layout) | Clean separation, supports future routes |
| Data source | Generated placeholder data (picsum images + random titles) | Nail the frontend first, wire real backend later |
| Mode integration | Deferred this sprint | Homepage uses placeholder data; architecture supports dual-mode (Social/NSFW) without structural changes |
| Scroll animation | rAF loop + transform: scale() + state machine | Compositor-only, no layout thrashing, debuggable |

## 1. Routing & Page Structure

Add `react-router-dom`. `main.jsx` wraps in `<BrowserRouter>`.

| Route | Component | Content |
|-------|-----------|---------|
| `/` | `HomePage.jsx` | Hero, carousel strip, featured section, category rows |
| `/library` | `LibraryPage.jsx` (current App.jsx layout) | Header, VideoGrid, FloatingQueue |

A root `AppShell.jsx` renders `<Routes>` plus shared elements (FloatingQueue, global keyboard handler). Header nav links use `useNavigate()`.

Vite's dev server handles client-side routing by default (history API fallback).

### What stays, what moves

- `VideoGrid`, `VideoPlayer`, `VideoCard`, `Header`, `FloatingQueue`, all stores — unchanged
- `App.jsx` → renamed/refactored to `LibraryPage.jsx`
- `HomePage.jsx` — new
- `AppShell.jsx` — new root layout

## 2. Component Tree

```
HomePage.jsx
├── HeroSection.jsx
│   ├── Hero background (Ken Burns animated image)
│   ├── Hero content (title, meta, tags, description)
│   ├── Hero actions (Play, Theatre, +queue, favorite)
│   └── HeroCarousel.jsx
│       ├── Search bar (380ms debounce, swaps strip content)
│       └── Horizontal scroll of 230×130px cards
├── FeaturedSection.jsx
│   ├── Scroll zone (180vh tall, drives animation)
│   ├── Sticky viewport (100vh, pins during scroll)
│   └── FeaturedCarousel.jsx
│       ├── Cards (absolutely positioned, transform-driven)
│       ├── Nav arrows, dots, progress bar
│       └── Auto-advance timer (5s interval)
└── CategoryRows.jsx
    └── CategoryRow.jsx (×4, horizontal scroll strips)
```

## 3. State: homeStore.js

New Zustand store (no persistence — ephemeral session state):

```javascript
{
  // Hero
  heroItem: Object,           // Currently featured in hero
  carouselItems: Array,       // Strip items (generated for now)
  theatreMode: boolean,       // Theatre mode active

  // Featured carousel
  featuredItems: Array,       // 7 featured cards
  featuredIndex: number,      // Active featured card index

  // Actions
  setHeroItem: (item) => {},
  setTheatreMode: (bool) => {},
  setFeaturedIndex: (idx) => {},
  generateData: () => {},     // Init with placeholder data
}
```

Data generation uses `picsum.photos` seeded images + randomized titles — same pattern as the mockup.

**Dual-mode ready**: Store holds raw data. Components read mode from `modeStore` (`social` or `nsfw`). Each mode has completely separate data sources — Social pulls from YouTube/TikTok/Instagram RSS, NSFW pulls from adult sites via yt-dlp. Not wired this sprint but the store architecture supports it: `generateData()` will be replaced by `fetchHomepage(mode)` which calls `GET /api/homepage?mode=social|nsfw`.

## 4. Featured Section Scroll Animation (Priority Fix)

### Problem

The mockup's `applyScrollProgress()` sets `width`/`height` on every scroll frame (layout thrashing). The snap logic uses debounced `scrollTo` + rAF polling that fights the scroll listener. The `isSnapping` flag sometimes gets stuck.

### Solution: rAF loop + transform: scale() + state machine

#### Layout

Cards rendered at **fixed base size**: 62vw × 380px, absolutely positioned and centered in the sticky container. The active card uses `transform: scale(X)` where X fills the viewport:

```
fullbleedScale = Math.max(viewportWidth / cardWidth, viewportHeight / cardHeight)
```

Side cards are always at base size, positioned via `transform: translateX(dx%) scale(s)`.

Recalculated on `resize` only — not on scroll.

#### Scroll zone

```html
<div class="featured-scroll-zone" style="height: 180vh">  <!-- runway -->
  <div class="featured-sticky" style="position: sticky; top: 0; height: 100vh">
    <!-- cards live here -->
  </div>
</div>
```

Progress (0→1) = `clamp(0, -rect.top / (zoneHeight - viewportHeight), 1)`

#### Properties animated per frame (compositor-only)

| Property | Active card | Side cards |
|----------|-------------|------------|
| `transform: scale()` | lerp(fullbleedScale, 1.0, progress) | lerp(0.6, targetScale, sideProgress) |
| `opacity` | always 1 | lerp(0, targetOpacity, sideProgress) where sideProgress = max(0, (p-0.5)*2) |
| `border-radius` | lerp(0, 16, progress)px | always 16px |

No `width`, `height`, `left`, or `top` changes during scroll. All cards have `will-change: transform`.

#### State machine

```
     ┌──────────────────────────────────────┐
     │                                      │
     ▼                                      │
   IDLE ──(scroll enters zone)──► SCROLLING │
     ▲                              │       │
     │              (scroll stops, p < 0.38)│
     │                ┌─────────────┘       │
     │                ▼                     │
     │          SNAPPING(back) ─────────────┘
     │
     │          (scroll stops, p >= 0.38)
     │                │
     │                ▼
     │          SNAPPING(forward)
     │                │
     │                ▼
     └──────── REVEALED ◄──────────────────
                │       ▲
                │       │ (carousel nav: arrows, dots, auto-advance)
                └───────┘
                │
                │ (user scrolls back up past zone)
                ▼
              SCROLLING (back to scroll-driven)
```

**States**:

- **IDLE**: Progress = 0. Scroll listener active. rAF loop inactive.
- **SCROLLING**: User scrolling through zone. rAF loop reads scrollY, computes progress, sets transforms. On scroll-stop (150ms debounce): evaluate tipping point.
- **SNAPPING**: Scroll listener **ignored**. Cards get CSS transition (`transform 0.5s cubic-bezier(0.25,0.46,0.45,0.94)`). `scrollTo({ behavior: 'smooth' })` drives to target. IntersectionObserver on a sentinel element detects arrival. On arrival → REVEALED or IDLE.
- **REVEALED**: Cards have CSS transitions for carousel nav. Auto-advance starts (5s). Scroll listener re-enabled — if user scrolls back past zone top, → SCROLLING.

**Why IntersectionObserver for snap detection**: The mockup's rAF polling (`checkArrival`) sometimes never converges because `scrollY` doesn't land exactly on target. IO fires reliably when the sentinel enters/exits the viewport regardless of sub-pixel positioning.

### Post-reveal carousel

Standard CSS transitions. `goTo(index)` sets transforms on all cards:

```javascript
// Positions relative to active card
const OFFSETS = [
  { dx: -68, scale: 0.72, opacity: 0.5 },  // -2
  { dx: -36, scale: 0.84, opacity: 0.7 },  // -1
  { dx:   0, scale: 1.00, opacity: 1.0 },  //  center
  { dx:  36, scale: 0.84, opacity: 0.7 },  // +1
  { dx:  68, scale: 0.72, opacity: 0.5 },  // +2
]
```

Auto-advance: `setInterval` every 5s, wraps around. Progress bar animates via CSS (`width: 0% → 100%` over 5s linear). Reset on manual nav.

## 5. Theatre Mode

CSS-class driven, no JS animation:

- `theatreMode: true` → hero gets `.theatre` class
- Hero: height transitions to 100vh
- Carousel strip: `transform: translateY(30px); opacity: 0; pointer-events: none`
- Content rows: `opacity: 0; pointer-events: none`
- Floating control bar: `display: flex` (fixed bottom center, pill-shaped)
- Controls: play/pause, prev/next, progress bar, volume, exit button
- Exit: click exit button, press Escape, or press T

## 6. Hero Interactions

- **Hero carousel strip**: Click card → swap hero background. Active card gets accent border.
- **Search**: 380ms debounce. Generates fake results for now. Clear/Escape restores original items.
- **Arrow keys**: Navigate strip left/right.
- **Play button**: Enters theatre mode.
- **+queue button**: Adds hero item to queue (existing `addToQueue`).

## 7. Category Rows

4 sections: Trending Now, Popular This Week, New Arrivals, Staff Picks.

- Horizontal scroll with right-edge fade mask (`mask-image: linear-gradient(...)`)
- Cards: 200px wide, 10px radius, thumbnail + title + subtitle
- Hover: scale(1.05), translateY(-4px), shadow, play overlay
- Scroll-triggered fade-up via IntersectionObserver (staggered delay per card)
- Click: sets hero item, scrolls to top

## 8. Keyboard Shortcuts

| Key | Context | Action |
|-----|---------|--------|
| `ArrowLeft/Right` | Homepage | Navigate hero strip |
| `T` | Homepage | Toggle theatre mode |
| `Escape` | Always | Exit theatre + activate SFW + collapse queue |
| `N` | Always | Next in queue |
| `Space` | Theatre | Play/pause |

Layered on top of existing `useKeyboard.js`. Homepage-specific shortcuts only active when on `/`.

## 9. Design Tokens

Matches existing `tailwind.config.js` + mockup:

| Token | Value | Usage |
|-------|-------|-------|
| surface | `#0a0a0b` | Page background |
| raised | `#141416` | Card backgrounds |
| overlay | `#1c1c1f` | Elevated surfaces |
| accent | `#e50914` | Active states, buttons |
| text-primary | `#e5e5e5` | Headings |
| text-secondary | `#a1a1a6` | Metadata |
| text-muted | `#6b6b70` | Subtle text |
| Font | DM Sans 300-700 | Already in tailwind config |

Card radii: 16px (featured), 10px (category), 8px (carousel strip).

## 10. Files Created/Modified

### New files
- `src/pages/HomePage.jsx` — layout shell
- `src/pages/LibraryPage.jsx` — current App.jsx layout extracted
- `src/components/AppShell.jsx` — root with Routes + shared elements
- `src/components/home/HeroSection.jsx`
- `src/components/home/HeroCarousel.jsx`
- `src/components/home/FeaturedSection.jsx`
- `src/components/home/FeaturedCarousel.jsx`
- `src/components/home/CategoryRows.jsx`
- `src/components/home/CategoryRow.jsx`
- `src/components/home/TheatreControls.jsx`
- `src/stores/homeStore.js`
- `src/hooks/useFeaturedScroll.js` — the rAF loop + state machine (custom hook)

### Modified files
- `src/main.jsx` — add BrowserRouter
- `src/App.jsx` — extract to LibraryPage, replace with AppShell
- `src/components/Header.jsx` — add nav links with useNavigate
- `src/hooks/useKeyboard.js` — add T key, homepage context awareness (this is the active keyboard hook; `useKeyboardShortcuts.js` is dead code from an older version and can be removed)
- `package.json` — add react-router-dom (already present)

## 11. Not In Scope

- Real backend (`/api/homepage`, SQLite caching, yt-dlp refill)
- SFW content swapping (design supports it, not wired)
- Mobile-specific layouts
- Shuffle, loop, save-queue-as-playlist
- Video playback from homepage (theatre mode is visual-only for now — real playback comes with backend)

## 12. Future: Dual-Mode Integration

FeedDeck is a dual-mode media aggregator — Social mode and NSFW mode are two completely independent products sharing one app shell. They never blend.

When real content replaces placeholders:
- `homeStore.generateData()` is replaced by `fetchHomepage(mode)` which calls `GET /api/homepage?mode=social|nsfw`
- Components read mode from `modeStore` and render the appropriate dataset — no visual swapping or title remapping needed, just different data
- **Social mode**: Categories pull from YouTube/TikTok/Instagram/Facebook RSS feeds and yt-dlp social extractors
- **NSFW mode**: Categories pull from adult site saved searches, category feeds, model subscriptions, and trending pages via yt-dlp
- Each mode has its own `categories` table rows (`mode='social'` vs `mode='nsfw'`), own `homepage_cache` entries, own refresh schedules
- `Escape` key switches to Social mode instantly — the homepage re-fetches Social data from cache (already loaded, near-instant)
- Tab title and favicon always say "FeedDeck" / 📡 regardless of mode
- No structural component changes needed — the same `HomePage`, `HeroSection`, `FeaturedCarousel`, and `CategoryRow` components render both modes, just with different data from the API
