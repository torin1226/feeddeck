# FeedDeck Design Review -- April 6, 2026 (Run 2)

**Reviewer:** Claude (automated daily audit)
**Session:** Second run -- Edge case & resilience audit
**Lens:** State transitions, error recovery, design token consistency, performance, accessibility
**Method:** Deep code analysis across all 38 components, 9 stores, 9 hooks
**Note:** Beelink server unreachable (192.168.0.124:3001 and :5173 both down). Code-only audit.

---

## Executive Summary

The baseline review (Run 1) scored FeedDeck 6.5/10 on architecture and visual design. This second pass looks under the hood at what happens when things go wrong -- and the picture is less flattering. The app **degrades gracefully but silently**: API failures produce empty states or placeholder data with zero user feedback. There's no retry mechanism anywhere. The design token system is dangerously thin -- 40+ arbitrary pixel values, z-index chaos (0 to 9999), and no shadow hierarchy. These aren't polish issues; they're the gap between "works in a demo" and "works when Torin's Beelink flakes out at 2am."

**Adjusted Overall Score: 6.0/10** (down from 6.5 -- the resilience gaps are worse than the visual ones)

---

## Pillar 1: USEFUL -- Grade: B-

### What improved since Run 1
- No new commits since baseline, so no changes to report

### New findings this run (edge-case lens)

**P1: Silent failure everywhere**
Every API fetch in the app follows the same anti-pattern: `try { fetch() } catch { silently swallow }`. Specifically:
- `feedStore.initFeed()` -- catch sets `loading: false`, shows "No videos" with no explanation
- `feedStore.fetchMore()` -- catch stops loading, user can't distinguish "end of feed" from "server died"
- `libraryStore` -- favorites/ratings fire-and-forget: `fetch(...).catch(() => {})`
- `playerStore.resolveStream()` -- stores error message but displays raw text: "Stream error: HLS fatal: bufferAppendError"

**Impact:** When the Beelink server is down (which happens), Torin has zero signal about what's broken or how to fix it.

**P2: Queue polling has no backoff**
`useQueueSync.js` polls every 3 seconds regardless of server health. When the server is down, this means 20 failed requests per minute with no backoff. Should use exponential backoff (3s, 6s, 12s, cap at 60s).

**P2: Race conditions in stream URL warming**
`_warmStreamUrls` fires parallel fetches that read and write `buffer` state asynchronously. Multiple warmups for the same video can clobber each other (TOCTOU). Not crashing, but could serve stale URLs.

**P1: watchedIds not persisted**
The Set clears at 1000 entries and resets entirely on page refresh. The `/api/feed/watched` endpoint already fires on watch, so the server HAS this data -- but it's never used to deduplicate on reload. Torin re-watches the same content constantly.

---

## Pillar 2: USABLE -- Grade: C+

### New findings this run

**P0: Accessibility is below minimum bar**
- 6 `<img>` elements with `alt=""` (empty) instead of descriptive text (VideoCard, VideoPlayer, FeedVideo, MobileSwipeView, FloatingQueue)
- 3 clickable `<div>` elements without `role="button"` or keyboard handling (CategoryRow cards, HeroCarousel load-more, FeedVideo container)
- 0 focus traps in modals (AddVideoModal, FeedFilterSheet, ContextMenu -- all let Tab escape to document behind)
- No `aria-live` regions for dynamic content (queue count changes, toast notifications)

**P1: Touch targets below 44px minimum**
- VideoPlayer PiP/close buttons: 32px (w-8 h-8)
- Feed timeline scrub bar: 3px tall
- FeedFilterSheet source toggles: ~28px tall
- Header theme toggle: ~36px

**P2: No focus management after state transitions**
- Opening theatre mode doesn't focus the video controls
- Closing a modal doesn't return focus to the trigger element
- NextUpDialog can only be dismissed by click (no Escape key)

---

## Pillar 3: MODERN -- Grade: C

### New findings this run (design system lens)

**P0: No design token system**
The Tailwind config had 4 color groups and 2 font families. That's it. No shadows, no z-index scale, no animation presets, no spacing tokens, no border radius aliases. Every component was inventing its own values.

**What I fixed this run:** Extended `tailwind.config.js` with:
- Z-index semantic scale (base/content/sticky/overlay/header/modal/toast/system)
- Shadow hierarchy (card, card-hover, float, modal, glow-accent, inner-subtle)
- Border radius tokens (card: 10px, card-lg: 14px, pill)
- Card sizing tokens (w-card: 200px, h-card-thumb: 113px)
- Animation timing presets (spring, cinematic, smooth)
- Directional shimmer keyframe for loading skeletons

**What I fixed this run:** Upgraded `Skeletons.jsx` from basic `animate-pulse` to directional shimmer sweep (L-to-R gradient animation, Netflix-style).

**Still broken (found in audit):**
- Z-index soup: values range from z-[0] to z-[9999] across 12 files. z-[300] for FeedToast, z-[200] for FeedBottomNav, z-[9999] for mobile frame notch
- 40+ arbitrary pixel values for widths/heights (w-[200px], w-[220px], w-[230px] for cards that should be the same size)
- 6+ custom shadow values in arbitrary brackets, all different blur radii
- Typography has 10+ arbitrary font sizes (text-[10px] through text-[28px]) with no documented scale
- Competing animation approaches: CSS @keyframes + inline styles + Tailwind animate-* coexist

---

## Changes Made This Run

1. **`tailwind.config.js`** -- Extended with comprehensive design token system (z-index, shadows, border radius, sizing, animation timing, shimmer keyframes)
2. **`src/components/Skeletons.jsx`** -- Replaced `animate-pulse bg-white/[0.06]` with directional shimmer sweep using gradient animation

---

## Prioritized Action Items (for backlog)

### P0 (This week)
1. **Add error feedback to all API failures** -- Show inline "Server unreachable" with retry button instead of silent empty states. Start with feedStore and homeStore.
2. **Add exponential backoff to queue polling** -- Replace fixed 3s interval with backoff (3/6/12/30/60s)
3. **Persist watchedIds via server** -- Use `/api/feed/watched` data to deduplicate on reload

### P1 (Next 2 weeks)
4. **Accessibility pass: alt text** -- Replace all `alt=""` with descriptive text from video titles
5. **Accessibility pass: keyboard targets** -- Add role="button" + tabindex + keydown handlers to CategoryRow cards, HeroCarousel load-more, FeedVideo container
6. **Increase touch targets** -- VideoPlayer buttons to 40px, timeline to 8px, filter toggles to 44px
7. **Migrate z-index values** -- Replace all arbitrary z-[] with semantic tokens from new config
8. **Migrate shadow values** -- Replace arbitrary shadow-[] with token shadows

### P2 (Month 2)
9. **Focus management** -- Add focus traps to modals, focus return on close, Escape key dismissal
10. **Typography scale** -- Define 6-8 named sizes, replace arbitrary text-[Npx] values
11. **Card sizing unification** -- Pick one card width, use w-card token everywhere
12. **Animation audit** -- Consolidate to Tailwind tokens, remove inline style animations

### P3 (Month 3)
13. **Offline resilience** -- Cache last homepage in localStorage, show stale data with badge
14. **aria-live regions** -- Add to queue count, toast container, feed loading indicators
15. **Optimistic update feedback** -- Show subtle toast when library sync fails

---

## Process Notes for Future Runs

### What worked this run
- Three-agent parallel audit (error states + visual tokens + performance/a11y) was efficient
- Different lens from baseline (edge cases vs architecture) found entirely new issue categories
- Building the design token system was the right "quick win" -- foundational, not cosmetic

### What to try next run
- **Lens rotation:** Try "user journey" audit -- walk through 5 key flows (open app, browse, play video, queue video, switch modes) and note every friction point
- **Beelink access:** If server is up, take screenshots of each page and each state (loading, empty, error, populated)
- **Metric tracking:** Start counting: how many arbitrary values remain? How many components use the new tokens?

### Screenshot status
- Still can't reach Beelink server from sandbox Chrome
- Python http.server in sandbox serves dist/ but Chrome can't reach sandbox localhost
- **Action for Torin:** Confirm Beelink IP and whether the dev server or Docker deployment is running
