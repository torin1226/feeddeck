# FeedDeck Progress Report — April 5, 2026

## TL;DR

**Last commit: March 26.** No commits in the last 10 days. The project has stalled.

Milestones 1-3 and 5 are substantially complete. Milestone 4 (deployment) is partially done. But there's a growing tail of QA bugs and design rework items from March 27 manual testing that haven't been touched. The backlog is healthy in structure but increasingly front-loaded with polish and rework tasks that keep expanding in scope.

---

## What's Been Built (Completed)

Milestones 1 through 3 are essentially done — this is a real, functional app:

- Desktop MLP: homepage with hero carousel, category rows, theatre mode, hover previews, search, quality selector, PiP
- Swipe Feed: full TikTok-style vertical feed with gesture system, autoplay, preloading, theatre overlay, ForYou + Remix views
- Discovery & Organization: source adapter layer (yt-dlp + Puppeteer scrapers + Cobalt), tag preferences, basic recommendations, cookie auth, queue sync, playlists, favorites, ratings, PornHub/YouTube/TikTok history seeding
- Design Polish (Milestone 5): typography overhaul, color identity, accessibility pass, empty states, library upgrade, bundle splitting
- Deployment (Milestone 4 partial): Docker config, Beelink setup scripts, systemd service, logging, backups

## What Changed Since Yesterday

Nothing. Last activity was March 26 (Docker deployment + TTL fixes). The backlog hasn't been updated since March 27 QA session.

---

## Scope Creep Assessment

**Verdict: Yes, scope creep is a real drag on momentum.**

Evidence:

1. **QA failures from March 27 generated ~15 new tasks** ranging from P0 bugs to full design rework specs. Several of these (category row redesign, queue drawer redesign, homepage search bar) are substantial multi-day features disguised as "fixes."

2. **The Discovered Tasks section keeps growing.** Reddit import pipeline, category card spotlight redesign, queue bottom-sheet redesign — these are feature-sized items that landed mid-sprint.

3. **Deferred items accumulate without resolution.** Per-mode cookie files (3.4.1), page transitions (5.5), hero scroll affordance (5.5), logo treatment (5.3) — all marked as "deferred" but still sitting in the backlog without a target milestone.

4. **Manual testing gate (3.11) is blocking Milestone 4** but no sign of it happening.

### What's Actually Blocking Ship

The honest priority stack:

- **P0 bugs from QA:** NSFW flash on SFW first load, mobile feed 5+ second load times, heart button not clickable, long-press source control broken
- **The 10-day silence** — momentum loss is the real enemy here
- **Milestone 4.2** (Social mode pipeline) is deferred indefinitely — fine for NSFW-first, but the dual-mode architecture is half-built

### What Should Be Cut or Deferred

- Category row spotlight redesign → ship the fix (vertical scroll bug), defer the redesign
- Queue drawer bottom-sheet → current FloatingQueue works, defer redesign
- Reddit import pipeline → nice-to-have, not blocking anything
- AI recommendations (4.4) → correctly deferred already
- Browser extension (4.5) → correctly deferred

---

## Code Review Findings

### Critical Issues

| Area | Issue | Impact |
|------|-------|--------|
| **useHoverPreview.js** | Video elements never cleaned up — global singleton refs (`activeAbort`, `activeVideo`) don't properly dispose elements. Root cause of 54 orphaned `<video>` tags in DOM | Memory leak, degrades performance over session |
| **server/sources/scraper.js** | Puppeteer browser not closed on page init failure. No concurrent browser limit — 10 parallel scrapes = 10 Chromium processes | Memory bomb on server |
| **useFeedGestures.js** | Anonymous `setTimeout` in double-tap handler never cleared on unmount | Callback fires on unmounted component |
| **server/sources/ytdlp.js** | `stderr` not consumed on spawned processes — buffer fills up and process hangs. 50MB `maxBuffer` default per call | Process hangs, memory bloat |
| **server/index.js** | Graceful shutdown has no timeout — stuck background task hangs server forever | Deployment reliability |
| **feedStore.js** | `watchedIds` Set grows unbounded (only clears at >1000 entries via setCurrentIndex) | Memory leak in long sessions |

### Medium Issues

- ForYouFeed.jsx: IntersectionObserver recreated on every buffer.length change (DOM thrashing)
- feedStore.js: Race condition between `prefetch()` and `initFeed()` causing duplicate API calls
- VideoPlayer.jsx: `video` object as useEffect dependency causes listener churn
- server/index.js: Empty domains array in feed filter creates invalid SQL `IN ()` clause
- proxy-stream: No per-chunk timeout on upstream pipe (stalled upstream blocks response forever)

### Low Priority

- 16 unresolved `react-hooks/exhaustive-deps` ESLint warnings
- ForYouFeed key prop includes array index (reorder risk)
- Malformed JSON in tag processing silently skipped (no logging)

---

## Claude Code Review Prompt

If these findings warrant action, here's a prompt for Claude Code:

```
Review and fix the following issues in priority order. For each fix, make a separate commit.

1. **CRITICAL: useHoverPreview.js video element leak**
   - File: src/hooks/useHoverPreview.js
   - Problem: Global `activeVideo` ref holds orphaned video elements. `cancelPreview()` calls `removeAttribute('src')` but doesn't call `pause()` first, doesn't remove event listeners, and doesn't null the reference. Over time, 50+ video elements accumulate in DOM.
   - Fix: In `cancelPreview()`, call `video.pause()` before removing src. Remove the `canplay` listener explicitly (don't rely on `{ once: true }` which may not fire if aborted). Set `activeVideo = null` after cleanup. In `startPreview()`, ensure any previous video element is fully disposed before creating/reusing one.

2. **CRITICAL: scraper.js Puppeteer browser leak**
   - File: server/sources/scraper.js
   - Problem: If `_newPage()` fails after page creation but before the caller's try/catch, the page leaks. No limit on concurrent browser instances.
   - Fix: Wrap `_newPage()` internals so page is closed on ANY error. Add a semaphore or queue (max 3 concurrent pages). Add `page.close()` in a finally block for every method that calls `_newPage()`.

3. **HIGH: useFeedGestures.js timer leak**
   - File: src/hooks/useFeedGestures.js
   - Problem: `setTimeout` for single-tap delay (double-tap detection) is created anonymously and never stored in a ref. On unmount, this timer fires on a dead component.
   - Fix: Store the timeout ID in a ref. Clear it in the useEffect cleanup function.

4. **HIGH: ytdlp.js stderr not consumed**
   - File: server/sources/ytdlp.js, `streamSearch()` method
   - Problem: Spawned yt-dlp process stderr is not read. If stderr buffer fills (default 200KB), process hangs.
   - Fix: Add `child.stderr.on('data', () => {})` or pipe stderr to a collector. Also reduce `maxBuffer` from 50MB to 10MB in the `ytdlp()` helper.

5. **MEDIUM: server/index.js graceful shutdown timeout**
   - Problem: SIGTERM handler awaits cleanup with no timeout. Stuck interval or DB operation hangs shutdown forever.
   - Fix: Add a `setTimeout(process.exit, 10000)` fallback in the SIGTERM handler.

6. **MEDIUM: feedStore.js watchedIds unbounded growth**
   - File: src/stores/feedStore.js
   - Problem: `watchedIds` Set grows forever. Only checked when `setCurrentIndex` is called.
   - Fix: Check Set size in `markWatched()` too. If > 500, evict oldest half (convert to array, slice, rebuild Set).

Run `npm run lint` after all fixes and resolve any new warnings introduced.
```

---

## Recommendation

The project is feature-complete for an MVP. The 10-day gap is the biggest risk. Priority should be:

1. Fix the P0 QA bugs (NSFW flash, mobile feed latency, broken click handlers)
2. Fix the critical code review items (memory leaks will bite hard on the Beelink)
3. Do the manual mobile testing gate (3.11) and ship to the Beelink
4. Resist the urge to redesign category rows and queue drawer before shipping
