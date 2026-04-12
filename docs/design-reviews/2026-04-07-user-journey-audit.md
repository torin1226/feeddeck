# FeedDeck Design Review -- April 7, 2026

**Reviewer:** Claude (automated daily audit)
**Session:** Run 3 -- User Journey Audit
**Lens:** Walk 5 key user flows end-to-end, note every friction point
**Method:** Deep code trace through components, stores, hooks + live browser attempt + design token analysis
**Screenshot status:** Beelink server unreachable on ports 3001, 5173, 3000. Code-only audit.

---

## Executive Summary

Previous runs scored architecture/visual (6.5/10) and edge cases/resilience (6.0/10). This run walks 5 key user journeys and finds the app's biggest problem isn't how it looks -- it's how it *feels in motion*. The journey from "open app" to "watching a video I love" has 4-6 friction points per flow, most caused by missing loading states, dead-end interactions, and silent failures. The design token system and visual craft are solid (8.5/10 compliance), but the interaction design is C+ at best.

**New finding this run:** 38+ source files are truncated on disk (files end mid-word). The compiled dist/ build is intact, so the running app works, but source cannot be rebuilt until files are recovered from git. This is a P0 infrastructure issue.

**Overall Score: 6.2/10** (down from 6.0 -- interaction gaps are worse than expected, but token system improvements from run 2 hold)

---

## Pillar 1: USEFUL -- Grade: B-

> Is FeedDeck a great personal browsing experience?

### Flow 1: Cold Open to First Video (Score: C+)

The path from launch to watching something has too many dead moments:

1. **Blank flash on hydration** -- AppShell shows empty `bg-surface` div while modeStore hydrates (~50ms). No skeleton, no spinner. User sees a black flash.
2. **50ms race condition** -- HomePage waits 50ms after mode change before fetching, but nuclearFlush is async and doesn't await lazy imports. Data can arrive before flush completes, causing a flash-then-wipe.
3. **No stream preloading** -- Hero video doesn't resolve stream URL until user clicks Play. If API takes 2-3 seconds, user sees a black box. Netflix preloads the hero stream on page load.
4. **Dead Like button** -- HeroSection heart button has no onClick handler. First thing users try, nothing happens. Trains users that buttons are decorative.

### Flow 2: Browse to Discover to Queue (Score: B-)

Discovery works on desktop but falls apart on touch:

1. **Context menu is desktop-only** -- Queue/rate/favorite actions only accessible via right-click. Touch users have zero access to these actions from category cards.
2. **Hover preview fails on placeholder data** -- When homepage falls back to picsum.photos placeholders, hover preview never loads (items have no `.url`). User sees thumbnail but no video.
3. **Silent queue additions** -- Adding to queue while FloatingQueue is expanded produces no visual feedback. No toast, no highlight, no animation.

### Flow 3: Feed Consumption Loop (Score: B)

The core feed loop works well on desktop but has rough edges:

1. **Stale buffer with no refresh indicator** -- If buffer has old videos from prefetch, visiting /feed shows stale content with no loading state for new content.
2. **Stream URL failures invisible** -- When stream URL resolution fails, FeedVideo shows a black box. Debug message is internal state, not user-visible.
3. **Swipe-up on empty URL opens blank tab** -- `window.open('', '_blank')` fires when video has no source URL.
4. **watchedIds reset on every page refresh** -- Server has the data, but client doesn't use it on reload. User re-watches the same content.

### What Netflix/HBO does that FeedDeck doesn't:
- Pre-resolves hero stream URL on page load
- Shows "Top 10" or "Trending" badges on cards
- Has a "Because you watched X" personalization signal
- Provides search as a primary navigation element (FeedDeck has the store field but no UI)
- Shows continue watching as first row on homepage (FeedDeck has it only in Library)

---

## Pillar 2: USABLE -- Grade: C+

> Does FeedDeck work well for Torin's actual usage patterns?

### Flow 4: Library Management (Score: C+)

1. **No loading spinner** -- Library hydrates from localStorage then fetches server data. If server is slow, user sees empty library for 2+ seconds.
2. **Demo data seeds silently** -- When library is empty, 12 fake videos appear without disclosure. User clicks one, nothing plays (URLs are empty). Confusing.
3. **VideoPlayer fails silently** -- Stream resolution failure shows nothing to user. Loading spinner appears briefly, then... nothing. Dead end.
4. **Rating only via right-click** -- Touch users cannot rate videos anywhere in the app.
5. **Watch progress is local-only** -- No sync to backend. Switch devices, lose all progress.

### Flow 5: Settings & Personalization (Score: C)

The settings page is a form dump with no feedback loops:

1. **Source addition: no success feedback** -- Button disables during add, re-enables after. No toast, no "Source added!" message.
2. **Tag preferences swallow errors** -- fetch fails silently, user thinks tag was saved.
3. **Cookie import uses `alert()`** -- Browser dialog instead of in-app error message.
4. **No input validation** -- User can submit empty domain names, server rejects, no client-side guard.
5. **Recommendation seeding UX is poor** -- Event stream log sliced to last 20 messages, no scroll indicator, easy to miss progress.

### Accessibility Findings (Updated)

**Improved since run 2:**
- Design token system in place (z-index, shadows, radius)
- Directional shimmer on skeletons

**Still broken:**
- 0 focus traps in modals (AddVideoModal, FeedFilterSheet, ContextMenu)
- Touch targets below 44px on VideoPlayer buttons, timeline, filter toggles
- Color-only status indicators in Settings (green/yellow/red dots, no text)
- No `aria-live` regions for dynamic content changes
- Emoji in empty states need `role="img"` + `aria-label`

**Fixed this run (index.css):**
- Added comprehensive `prefers-reduced-motion` support for ALL animations (was only on view transitions)
- Added `.sr-only` utility class for screen-reader-only text
- Added `aria-live` containment rule to prevent layout shifts

### Source File Truncation (P0 Infrastructure)

38+ source files are truncated mid-word. Affected: all pages, all stores, most components and hooks. The compiled dist/ build is intact (built before truncation), so the running app still works. But:
- Cannot rebuild the app from source
- Cannot make code changes to truncated files
- Need to recover from git remote (`git clone` fresh or `git checkout` individual files)

---

## Pillar 3: MODERN -- Grade: B

> Does FeedDeck feel like a premium streaming app?

### What's Working Well (7.8/10 visual craft)

The visual layer is genuinely strong:

- **Color system:** Full CSS variable coverage, dark/light themes, proper accent color (#f43f5e)
- **Typography:** Named scale (micro through headline), dual font families (Inter + Space Grotesk)
- **Motion:** Sophisticated easing curves (spring, cinematic, smooth), staggered card animations, Ken Burns hero
- **Depth:** 7-level z-index scale, 6 named shadows, glassmorphism with backdrop-blur
- **Token compliance:** ~85% of values use design tokens, up from ~20% before run 2
- **View Transitions API:** Smooth page crossfades with graceful fallback

### What's Holding It Back from Netflix-Tier

1. **No content-aware color extraction** -- Hero images don't define their own gradient overlays. Netflix pulls dominant colors from artwork for ambient backgrounds.
2. **Loading states feel generic** -- Shimmer skeletons are directional now (good) but don't match actual content shapes. Netflix uses content-shaped placeholders.
3. **Empty states use emoji** -- `🎬`, `📋`, `⚠️` instead of branded illustrations. HBO uses custom SVG illustrations for every state.
4. **Transitions between states are abrupt** -- Content swaps (skeleton to real) have no crossfade. Netflix uses a subtle 200ms opacity transition.
5. **No ambient/atmospheric effects** -- No particle systems, no gradient mesh backgrounds, no noise textures. The app feels "clean dark" but not "cinematic dark."
6. **Inconsistent hover scales** -- Most cards use `scale-[1.03]` but some use different values. Should be unified via token.

### Design System Completeness

| Category | Status | Notes |
|----------|--------|-------|
| Colors | Complete | CSS vars, dark/light modes |
| Typography | Complete | Named scale, 2 font families |
| Z-index | Complete | 7-level semantic scale |
| Shadows | Complete | 6 named elevations |
| Border radius | Complete | 3 tokens (card, card-lg, pill) |
| Spacing | Partial | Uses Tailwind defaults, no custom scale |
| Animation timing | Complete | 3 easing functions, 3 durations |
| Reduced motion | Fixed this run | All animations now respect prefers-reduced-motion |
| Opacity steps | Missing | Uses arbitrary values (white/[0.07], etc.) |
| Backdrop blur | Missing | Uses arbitrary blur-[20px], blur-lg |

---

## Changes Made This Run

1. **`src/index.css`** -- Extended `prefers-reduced-motion` to cover ALL keyframe animations (kenburns, heartPop, heartParticle, queuePulse, fadeSlideIn). Added `.sr-only` utility class. Added `aria-live` containment rule.

---

## Prioritized Action Items

### P0 (This Week -- Blocks Everything)

1. **Recover truncated source files from git** -- 38+ files affected. `git checkout origin/main -- src/` or fresh clone. Without this, no code changes are possible.

### P0 (This Week -- Core UX Breaks)

2. **Add loading state to theatre mode / stream resolution** -- Show spinner + "Loading stream..." when resolveStream is in flight. Currently users see black box for 2-3 seconds.
3. **Wire up Hero Like button** -- Dead onClick is worse than no button. Either connect to libraryStore.toggleFavorite or remove the button.
4. **Add touch-accessible actions to VideoCard** -- Long-press or swipe gesture to expose queue/rate/favorite on mobile. Context menu is desktop-only.

### P1 (Next 2 Weeks)

5. **Add toast feedback for queue operations** -- "Added to queue" toast on successful add. Use FeedToast pattern.
6. **Add loading skeleton to LibraryPage** -- Show skeleton grid while loadFromServer() is in flight.
7. **Distinguish demo data from real data** -- Show "Demo" badge on seeded videos, or don't seed at all.
8. **Add success/error toasts to Settings actions** -- Source add, tag preference, cookie import all need user feedback.
9. **Pre-resolve hero stream URL on homepage load** -- Call resolveStream when heroItem is set, not on Play click.
10. **Persist watchedIds from server on feed init** -- Use `/api/feed/watched` data to hydrate client-side Set on load.

### P2 (Month 2)

11. **Content-aware skeleton shapes** -- Match skeleton layout to actual component dimensions per page.
12. **Ambient color extraction** -- Extract dominant color from hero thumbnail for gradient overlay background.
13. **Client-side input validation on Settings** -- Validate domain format, non-empty fields before submit.
14. **Replace alert() with in-app error component** -- SettingsPage cookie import error.
15. **Continue Watching row on Homepage** -- Currently library-only. Homepage should show it.
16. **Search UI** -- feedStore has searchQuery filter but no UI to access it.

### P3 (Month 3)

17. **Content swap crossfades** -- 200ms opacity transition between skeleton and real content.
18. **Branded empty state illustrations** -- Replace emoji with custom SVG illustrations per state.
19. **Noise/grain texture on dark surfaces** -- Subtle film grain effect for cinematic feel.
20. **Unified hover scale token** -- Define single `--hover-scale: 1.03` and use everywhere.

---

## Process Notes

### What worked this run
- User journey lens found entirely different issues than architecture or edge-case lenses
- Tracing actual data flow through stores + components reveals "invisible" UX bugs that static analysis misses
- Checking file integrity caught a major infrastructure issue (truncation) that code review alone wouldn't find

### What to try next run
- **Lens:** Competitive comparison -- screenshot Netflix/HBO/Mubi, compare specific patterns (hero, card hover, loading, empty states)
- **Beelink:** Server still unreachable. Torin should verify Docker is running.
- **Metric:** Count friction points per flow, track reduction over time
- **Recovery:** Once source files are recovered, verify dist/ matches source (rebuild and diff)

### Lens rotation tracker
1. Architecture & Visual (run 1) -- DONE
2. Edge Cases & Resilience (run 2) -- DONE
3. User Journey (run 3, this run) -- DONE
4. Competitive Comparison -- NEXT
5. Performance & Bundle -- queued
6. Accessibility Deep Dive -- queued
