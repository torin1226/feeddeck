# FeedDeck Progress Report — March 26, 2026

## What Changed in the Last 24 Hours

**12 commits. 1,093 lines added, 592 removed across 13 files.**

Two major workstreams landed:

### 1. Desktop Feed Overhaul (8 commits)
The `/feed` page got a complete desktop rethink. Two new views:

- **ForYouFeed**: horizontal scroll-snap cards with autoplay, theatre overlay (mouse-reveal controls, hold-to-scrub), scrubbable timeline, and NextUp countdown dialog for auto-advance
- **RemixFeed**: Netflix-style browse view with hero + carousel, replacing the old `DesktopFeedPage` (deleted)
- Tab bar to switch between views, responsive breakpoint hook, mobile adaptive video height

### 2. TikTok GDPR Import Pipeline (1 commit, 2 new files)
- `import-tiktok.js` parses GDPR export files (favorites, likes, watch history)
- `server/scripts/process-tiktok-imports.js` enriches via yt-dlp in batches
- 56K+ entries seeded, 101 videos processed so far (~93% success rate)
- 4 new API routes for status/recent/failed/watch-history

### 3. Stability Pass (2 commits)
- ErrorBoundary, queue integrity checks, storage safety
- SFW/NSFW mode hardening for zero cross-contamination

---

## Backlog Scorecard

| Milestone | Status | Completion |
|-----------|--------|------------|
| M1: Desktop MLP | DONE | 100% |
| M2: Swipe Feed | DONE (minus manual mobile test) | ~98% |
| M3: Discovery & Org | DONE (minus a few deferred items) | ~92% |
| M4: Deploy & Advanced | Partially done (Pi deployed, some items deferred) | ~60% |
| M5a: Video Playback | Code done, needs manual testing | ~70% |
| M5: Design Polish | Mostly done | ~85% |

### Open Items (not done, not deferred)
- Service worker video caching (2.8 Tier 3)
- Mobile device manual testing gate (3.11)
- Per-mode cookie files (3.4.1) — 6 subtasks
- Hover preview video element cleanup — 54 leaked `<video>` elements
- Puppeteer browser leak on scrape failure
- SIGTERM handler for background intervals
- Proxy-stream per-chunk timeout
- AbortController for warm stream URLs
- Log malformed JSON parse failures
- 16 react-hooks/exhaustive-deps ESLint warnings
- Page transition animations (5.5)
- Hero scroll affordance (5.5)
- FeaturedSection scroll zone tightening (5.5)
- Logo SVG treatment (5.3)
- AI recommendations (4.4)
- Browser extension (4.5)
- Cross-device full sync (4.6)
- Offline mode (4.7)

---

## Scope Creep Analysis

**Verdict: Mild creep, but momentum is strong.**

The original project scope was M1-M4. M5 (Design Polish) and M5a (Playback) were added post-hoc, and the TikTok GDPR import is a new discovery. However:

- M5/M5a were legitimate quality gates, not feature bloat. The app needed them.
- The TikTok import directly serves the core goal (content discovery). High leverage.
- The desktop feed overhaul (ForYou + Remix views) is the biggest scope expansion. It's a net-new feature set that wasn't in the original M2 spec. That said, M2's swipe feed was mobile-first, and the desktop needed *something*. This is reasonable scope growth, not creep.

**Where to watch out:**
- The "Discovered Tasks" section has 8 open items. Some are real bugs (Puppeteer leak, hover preview cleanup), others are nice-to-haves (page transitions, logo SVG). Don't let the discovered list become a second backlog.
- M4 items like AI recommendations, browser extension, and offline mode are big features with no specs. If they get picked up without planning, that's where real scope creep lives.

**Recommendation:** Lock scope to: finish manual testing (3.11, 5a.2), fix the 3 HIGH bugs in Discovered Tasks, then ship. Everything else is post-launch.

---

## Code Review Findings

### HIGH Priority (fix before shipping)

1. **RemixHero.jsx** — HLS instance not destroyed in useEffect cleanup. Component unmount leaks HLS instances.
2. **NextUpDialog.jsx** — `onAdvance` callback may not be memoized by parent, causing event listener churn on every render.
3. **process-tiktok-imports.js** — Silent catch on ALTER TABLE. If mode column add fails, imports proceed without error logging.
4. **FeedVideo.jsx** — Preload allows 4 simultaneous video prefetches on 4G with no throttling. Memory spike risk on mobile.
5. **server/index.js TikTok routes** — Database errors swallowed instead of returning error status codes.
6. **import-tiktok.js** — `readFileSync()` with no error handling + no transaction wrapping for batch inserts.

### MEDIUM Priority

7. **process-tiktok-imports.js** — Fragile error message parsing from yt-dlp stderr.
8. **FeedVideo.jsx** — Module-level singleton `_sharedVideo` mutated by multiple components. Race condition potential.
9. **NextUpDialog.jsx** — Duplicate CSS keyframe definition.

### LOW Priority

10. **RemixHero.jsx** — Silent failure on stream-url API error.
11. **ForYouFeed.jsx** — Missing null safety on scrollIntoView.
12. **import-tiktok.js** — Partial imports possible on crash (no DB transaction).

---

## Claude Code Review Prompt

If the findings above are notable enough to act on, paste this into Claude Code:

```
Review and fix these issues in priority order. For each fix, make a single commit.

1. **src/components/feed/RemixHero.jsx** — The useEffect that creates an HLS.js instance has no cleanup. Add `hls.destroy()` in the cleanup function to prevent memory leaks on unmount.

2. **src/components/feed/NextUpDialog.jsx** — The `onAdvance` callback is used as a useEffect dependency but likely isn't memoized by the parent. Either wrap the parent's callback in useCallback, or use a ref to store onAdvance and remove it from the dependency array.

3. **server/scripts/process-tiktok-imports.js** — The ALTER TABLE catch block (adding `mode` column) is silent. Log the error. Also, the yt-dlp error parsing (`err.stderr?.split('\n')[0]`) is fragile — add a fallback message.

4. **src/components/feed/FeedVideo.jsx** — Cap concurrent prefetches. The preload window allows 4 simultaneous video loads on 4G. Add a semaphore or queue that limits to 2 concurrent prefetches max.

5. **server/index.js (TikTok API routes around line 1855-1875)** — The `/api/tiktok/*` endpoints catch database errors but return 200 with empty data. Return 500 with error message instead.

6. **import-tiktok.js** — Wrap the readFileSync call in try/catch. Also wrap the batch insert loop in a SQLite transaction (`db.exec('BEGIN'); ... db.exec('COMMIT');`) with rollback on error.

7. **src/components/feed/RemixHero.jsx** — Add user-facing feedback (console.warn or toast) when stream-url fetch fails, instead of silently returning.

Don't touch any files not listed above. Run `npm run build` after all fixes to verify no regressions.
```
