# Design Review Run 10: Mobile-First Responsive
**Date:** 2026-04-12
**Score:** 5.8/10
**Lens:** Mobile-First Responsive (touch targets, viewport behavior, responsive breakpoints, gesture tuning, bottom nav, safe areas)
**Method:** Puppeteer screenshots at 4 viewports (390/768/1440/1920) × 4 pages + code audit

## Scorecard

| Lens | Score | Notes |
|------|-------|-------|
| Useful | 2.5/5 | Feed crashes on mobile/tablet. 2/4 pages non-functional below 1024px. |
| Usable | 2.0/5 | 50% page crash rate. Tab bar wraps. px-10 eats 20% of mobile width. No mobile nav. Settings crash (6th run). |
| Modern | 3.0/5 | Desktop hero is cinematic. But mobile is desktop-shrunk, not mobile-designed. No bottom sheets, no gesture-first homepage. |
| Opinionated | 3.5/5 | Heart burst + Ken Burns + theatre show personality. Responsive story has zero opinion — Tailwind defaults stretched across viewports. |
| Contextually Appropriate | 3.0/5 | Desktop fits. But mobile is where casual browsing happens (couch, bed, commute) and that surface is broken. |
| **Overall** | **5.8/10** | Desktop = solid 7. Mobile/tablet drag the average. Not "needs polish" — "not designed yet." |

## Key Numbers

- **Pages functional on mobile:** 2/4 (Homepage + Library work; Feed + Settings crash)
- **Hardcoded px-10 instances:** 15+ across 8 files (eats 20% of 390px viewport)
- **Responsive breakpoint classes (md:/lg:):** ~5 total outside Library grid
- **Settings consecutive crashes:** 6 (same .map() on undefined since run 4)

## Screenshots Captured

16 screenshots saved to `docs/design-reviews/screenshots/2026-04-12-*.png`:
- `{page}-desktop.png` (1440x900) — Homepage, Feed, Library, Settings
- `{page}-tablet.png` (768x1024) — Homepage, Feed (crash), Library, Settings (crash)
- `{page}-mobile.png` (390x844) — Homepage, Feed (crash), Library, Settings (crash)
- `{page}-tv.png` (1920x1080) — All pages
- `homepage-desktop-full.png` — Full scroll

## NEW Issues Found This Run

### P0: Feed page crashes on mobile/tablet (NEW)
- **Error:** "j.map is not a function" (minified)
- **Root cause:** FeedFilterSheet.jsx line 34: `setSources(data.sources || data || [])` — when API returns `{}`, falls back to `data` (an object, not array). Line 267 calls `sources.map()` on the object.
- **Scope:** ALL viewports below 1024px. Feed page is fully non-functional on mobile and tablet.
- **Fix:** `setSources(Array.isArray(data?.sources) ? data.sources : [])`

### P1: Hardcoded px-10 padding across entire app
- **Files affected:** HomeHeader.jsx, LibraryPage.jsx, BrowseSection.jsx, CategoryRows.jsx, TheatreRow.jsx, HeroCarousel.jsx, Skeletons.jsx, plus more
- **Impact:** At 390px, 40px × 2 = 80px padding → only 310px content width (20% wasted)
- **Competitors:** Netflix uses 12px, HBO uses 16px mobile edge padding
- **Fix:** Global `px-10` → `px-4 md:px-10` (~15 replacements)

### P1: No mobile bottom navigation on Homepage/Library/Settings
- **FeedBottomNav exists** but only renders inside FeedPage
- **Impact:** Mobile users must reach cramped top header to navigate between sections
- **Every streaming competitor** uses persistent bottom tab bar on mobile
- **Fix:** Promote to AppShell.jsx, conditionally render below 1024px

### P1: Library tab bar wraps on mobile
- **5 tabs need ~400px** but only 310px available
- **"Watch History"** and **"Watch Later"** wrap to two lines
- **Fix:** `overflow-x-auto flex-nowrap` + shorten mobile labels ("History", "Later")

### P1: Search dropdown overflows mobile viewport
- **HomeHeader.jsx line 231:** fixed `w-[400px]` exceeds 390px screen
- **Fix:** `w-[calc(100vw-32px)] md:w-[400px]`

### P2: Missing safe-area inset for top (notch/Dynamic Island)
- **viewport meta** missing `viewport-fit=cover`
- **HomeHeader** has no `env(safe-area-inset-top)` padding
- **FeedBottomNav correctly handles bottom** — just needs top counterpart
- **Fix:** Add `viewport-fit=cover` + top safe-area to header

### P2: TV viewport (1920px) has no optimization
- Cards tiny relative to screen. No 10-foot UI. No D-pad focus states.
- Month 3 roadmap item per long-horizon backlog.

## Carryover Issues (Still Unfixed)

| Issue | First Flagged | Runs Open | Status |
|-------|--------------|-----------|--------|
| Settings crash (.map on undefined) | Run 4 | 6 | P0 — one-line fix |
| Zustand full-store subscriptions (10-100x re-renders) | Run 5 | 5 | P3 — 15 min fix |
| No Continue Watching row | Run 1 | 10 | Month 1 roadmap |
| No search UI | Run 4 | 6 | Month 1 roadmap |
| No hero autoplay | Run 4 | 6 | Month 1 roadmap |
| No personalized row titles | Run 4 | 6 | Month 1 roadmap |
| No progress bar on cards | Run 4 | 6 | Month 1 roadmap |

## What's Working

1. **Library responsive grid is correct** — `grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5`. This pattern should be the template for all responsive layouts.
2. **Touch gesture system is Netflix-caliber** — useFeedGestures.js with well-calibrated thresholds (50px swipe, 35° angle, 300ms double-tap, 800ms long-press). Once feed stops crashing, this is great.
3. **FeedBottomNav has correct safe-area handling** — `max(env(safe-area-inset-bottom), 8px)`. Just needs promotion to global shell.
4. **Mobile preview dev tool (Ctrl+M)** — iPhone 14 Pro frame with simulated notch. Useful for catching responsive issues before they ship.

## Before/After Mock

Interactive HTML mock with phone frame comparisons saved to:
`/feeddeck-review-run10-mocks.html` (in workspace root)

Key visual changes proposed:
- **Mobile homepage:** px-4 padding (+38% content width), bottom tab bar, notch-aware spacing, 40% larger cards
- **Library tabs:** horizontal scroll with shortened labels, fade hint for scrollability

## Verdict: Needs Rework

The responsive story isn't "needs polish" — it's "hasn't been designed yet." Desktop is a solid 7/10, but mobile/tablet are fundamentally broken.

**Recommended sprint (8-10 hours):**
1. Fix P0 crashes (Settings + Feed) — 30 min
2. Global px-10 → px-4 md:px-10 — 30 min
3. Promote bottom nav to AppShell for mobile — 2 hrs
4. Library tabs overflow-x-auto + short labels — 30 min
5. Search dropdown mobile overflow fix — 30 min
6. viewport-fit=cover + safe-area top insets — 30 min
7. Zustand selector subscriptions — 30 min
8. QA across all 4 viewports — 2 hrs

After this sprint: mobile goes from "broken" to "functional." Months 2-3 is where it becomes "good" — adaptive density, gesture-first homepage, TV mode, mobile-native bottom sheets.

## Next Review

**Lens #11:** Animation & Motion System — audit all 132 transition declarations, enforce timing tokens, add exit animations, test reduced-motion compliance.
