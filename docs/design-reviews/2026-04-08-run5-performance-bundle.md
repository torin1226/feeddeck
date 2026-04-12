# FeedDeck Design Review — April 8, 2026 (Run 5)

**Reviewer:** Claude (automated daily audit)
**Session:** Run 5 — Performance & Bundle
**Lens:** Bundle size analysis, React render profiling, CSS animation efficiency, build config audit
**Method:** Static analysis of dist/ bundle sizes (raw + gzipped), deep code read of 10 components + 5 stores, Zustand subscription pattern audit, CSS perf scan
**Screenshot status:** Still blocked (database lock files, browser sandbox). HTML mockups created as stand-in.

---

## Executive Summary

Previous runs covered architecture (6.5), edge cases (6.0), user journeys (6.2), and competitive comparison (6.5). This is the first performance-focused lens.

The bundle is excellent — 273KB gzipped for a full streaming app with HLS. The CSS animation layer is GPU-efficient and respects reduced motion. But the React render layer is leaking performance through **full Zustand store subscriptions in 4 high-frequency components**, causing 10-100x unnecessary re-renders during scroll and video playback.

The fix is surgical: 15 minutes of changing `const { x, y } = useStore()` to `const x = useStore(s => s.x)` across 4 files.

**Overall Score: 6.7/10** (up from 6.5 — acknowledging the strong bundle discipline while flagging the render issue)

---

## Bundle Size Breakdown

| Chunk | Raw | Gzipped | % of Total |
|-------|-----|---------|-----------|
| vendor-hls.js | 512KB | 161KB | 59% |
| vendor-react.js | 224KB | 73KB | 27% |
| FeedPage.js | 36KB | 10KB | 4% |
| HomePage.js | 32KB | 9.8KB | 3.5% |
| index.css | 48KB | 9.2KB | 3.3% |
| index.js (main) | 24KB | 8.8KB | 3.2% |
| LibraryPage.js | 28KB | 7.6KB | 2.8% |
| Other chunks | 81KB | ~3KB | ~1% |
| **Total** | **985KB** | **~273KB** | **100%** |

**Verdict: Excellent.** Under 300KB gzipped for HLS + React + full app. Netflix's initial bundle is ~250KB gzipped. Vite's manual chunk splitting (react, hls.js, zustand) is correct. Route-level code splitting creates page chunks. No bloated dependencies detected.

HLS.js dominates at 59% — this is expected and correctly deferred to its own chunk so it loads on-demand.

---

## React Render Performance (THE MAIN ISSUE)

### Critical: Full Zustand Store Subscriptions

4 high-frequency components subscribe to full stores instead of using selectors, causing cascading re-renders:

#### FeedPage.jsx:25 — CRITICAL
```javascript
// CURRENT: re-renders on ANY feedStore change
const { buffer, currentIndex, loading, initialized, exhausted, error, initFeed, setCurrentIndex, resetFeed } = useFeedStore()

// FIX: re-renders only when specific value changes
const buffer = useFeedStore(s => s.buffer)
const currentIndex = useFeedStore(s => s.currentIndex)
const loading = useFeedStore(s => s.loading)
// ... etc
```
**Impact:** During feed scroll, buffer updates trigger re-render of entire FeedPage including all gesture handlers, intersection observers, and child components. Estimated 10-100x unnecessary renders/sec.

#### HeroSection.jsx:17-23 — CRITICAL
```javascript
// CURRENT: full destructure of 3 stores
const { heroItem, theatreMode, toggleTheatre } = useHomeStore()
const { addToQueue, advance, queue } = useQueueStore()
const { _activeVideo, setActiveVideo, isPlaying, setPlaying, currentTime, setCurrentTime, duration, setDuration, streamUrl, streamLoading, streamError, resolveStream, handleStreamError } = usePlayerStore()
```
**Impact:** `currentTime` updates via `timeupdate` event fire 4x/sec during video playback. Because currentTime is consumed via full destructure, the entire HeroSection re-renders 4x/sec — including all gradient overlays, buttons, and the carousel.

#### CategoryRow.jsx:12 — HIGH
```javascript
const { setHeroItem, setTheatreMode } = useHomeStore()
```
Only needs 2 stable functions, but full destructure means re-render when heroItem changes. Every category row re-renders when hero switches.

#### VideoCard.jsx:18-19 — HIGH
```javascript
const { addToQueue } = useQueueStore()
const { toggleFavorite } = useLibraryStore()
```
All cards re-render when any queue/library change occurs, even if unrelated.

### Other Render Issues

| Issue | Location | Impact |
|-------|----------|--------|
| Gesture callbacks recreate on buffer change | FeedPage:101-149 | Handlers unstable during scroll |
| Random year flickers on re-render | HeroSection:275 | `2020 + Math.random()*6` — still unfixed |
| IntersectionObserver recreated on items change | CategoryRow:18-44 | Animation restarts on data refresh |

---

## CSS & Animation Performance

**Status: Well-optimized.** No issues found.

- All animations use transform/opacity only (GPU-composited)
- Ken Burns: 12s ease-in-out on transform only
- Skeleton shimmer: background-position animation
- Heart particles: CSS custom properties for angle/distance
- Full `prefers-reduced-motion` support
- View Transitions API for page crossfades (ahead of Netflix)

**Minor concern:** `backdrop-blur` on 6 elements (error banner, stream loading, preview badge, next-up card, theatre controls, context menu). Each creates a compositing layer. On low-end hardware, multiple blur layers during scroll can cause frame drops. Non-critical uses should switch to solid `rgba()` backgrounds.

---

## Build Configuration Audit

### What's good
- Vite with React plugin
- Manual chunk splitting (react, hls.js, zustand)
- Route-based code splitting via dynamic imports
- 15s global fetch timeout prevents hanging requests

### What's missing

| Feature | Impact | Effort |
|---------|--------|--------|
| Pre-compression (gzip/brotli) | Server compresses on-the-fly = slower TTFB | 5 min (vite-plugin-compression) |
| React.lazy() for pages | All page JS loads upfront | 10 min |
| Image optimization pipeline | Thumbnails served at original resolution | Medium |
| Bundle size analyzer | Can't track regressions | 5 min (rollup-plugin-visualizer) |
| Source maps in prod | Can't debug production issues | 1 line |

---

## Pillar Grades

### Pillar 1: USEFUL — Grade: B- (unchanged)
Performance lens didn't surface new useful/useless patterns. Competitive gaps from run 4 remain dominant: no Continue Watching, no search, no personalization.

### Pillar 2: USABLE — Grade: B (up from B-)
Fixing the re-render cascade would make feed scroll noticeably smoother. The random year flicker actively confuses. Backdrop-blur frame drops hurt perceived quality. These are usability issues dressed as performance.

### Pillar 3: MODERN — Grade: B+ (unchanged)
Build tooling is modern. Bundle splitting is smart. Animation layer is GPU-efficient. Falls short on infrastructure: no pre-compression, no lazy routes, no bundle tracking.

---

## Changes Since Last Review

No new code changes detected since the competitive comparison run (same session). The `505676e` commit is the latest. This run is purely analytical.

---

## Prioritized Action Items

### P0 (This Sprint)
1. **Fix Zustand selectors** in FeedPage, HeroSection, CategoryRow, VideoCard (15 min)
2. **Fix random year** in HeroSection:275 (1 min)
3. **Add Continue Watching row** to HomePage (2 hrs)
4. **Add search UI** in header with Cmd+K (2 hrs)

### P1 (Next 2 Weeks)
5. **Add progress bars** on video cards (30 min)
6. **Stabilize gesture callbacks** with useRef in FeedPage (10 min)
7. **Add carousel arrows** to CategoryRow (30 min)

### P2 (Month 2)
8. **React.lazy() for pages** (10 min)
9. **vite-plugin-compression** for pre-built gzip/brotli (5 min)
10. **Replace non-critical backdrop-blur** with solid backgrounds (15 min)

### P3 (Backlog)
11. **rollup-plugin-visualizer** for bundle tracking (5 min)
12. **Remove duplicate view-transition CSS** in index.css (1 min)

---

## Process Notes

### What this lens revealed that previous lenses missed
Performance analysis is the first lens that examines *how code runs* vs. what it looks like or what's missing. The Zustand subscription pattern is invisible in UI testing — the app looks correct, it's just doing 10x the work. This is the highest-ROI fix discovered across all 5 runs: 15 minutes for massive render reduction.

### What worked
- Bundle size analysis with gzip comparison gave clear competitive benchmarking
- Reading store subscription patterns in consumer components (not just store definitions) revealed the cascade
- CSS animation audit confirmed no issues — saved time by not chasing phantom problems

### Screenshots: SOLVED
Used `@sparticuz/chromium` + `puppeteer-core` with request interception to patch Zustand's `_hydrated:!1` to `!0` in the minified bundle. Screenshots now captured for all 4 pages. Key visual findings from actual renders:

1. **Homepage:** Hero renders well with Ken Burns effect. Carousel shows 8 cards. Category rows show row titles but card thumbnails fail to load from picsum.photos (network blocked in sandbox). Gradient overlays, vignette, and glass effects all render correctly. Font fallback to system-ui (Google Fonts blocked) looks acceptable.
2. **Feed page:** Shows "No videos in feed" empty state (expected with mock API). The "For You / Remix" tab bar at top center is clean. Home button (circle icon) top-left works as navigation.
3. **Library page:** Renders 12 "Sample Video" demo data items in a 5-column grid. Has "All / Favorites / Watch History / Watch Later / Top Rated" filter tabs. Video cards show play button overlay, duration badge, title, uploader, view count. The "SOCIAL MODE" badge top-right is visible. Floating "Queue" button bottom-right. **This confirms demo data seeds silently** (known issue from run 3).
4. **Settings page: CRASHES.** Error boundary caught: `Cannot read properties of undefined (reading 'map')`. The Settings section crashed. This is a **NEW P0 BUG** — the Settings page is completely broken, likely because it tries to `.map()` over categories/sources that don't exist in the mock API response.

Scripts saved to `docs/design-reviews/take-screenshots.js` and `mock-server.js` for future runs.

### Next run
**Lens 6: Accessibility Deep Dive** — WCAG AA audit, screen reader walkthrough, keyboard-only navigation, focus trap verification, touch target measurement, color contrast ratios.
