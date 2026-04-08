# FeedDeck Progress Report - April 1, 2026

## TL;DR

**Milestones 1-3 are essentially complete. Milestone 4 (Deploy) is partially done. Milestone 5 (Polish) is ~80% done.** Most recent work focused on Docker deployment, TikTok GDPR import, and stream URL reliability fixes. The project is in a "last mile" phase where the remaining work is QA fixes, design polish, and a few deferred features.

**Scope creep verdict: Moderate.** The backlog has grown significantly in the "Discovered Tasks" and "QA Failures" sections (25+ open items), but the core milestone work has stayed disciplined. The real risk isn't scope creep in features, it's the growing tail of QA bugs and design rework items that could become an infinite polish loop.

---

## What Changed Since Yesterday

### Recent Commits (last ~5 days)

| Commit | Type | Impact |
|--------|------|--------|
| `7cf1063` Docker deployment with yt-dlp JS runtime + cookie fixes | feat | Deployment infrastructure |
| `1dd3a29` TTL monitor also NULLs expires_at when clearing expired URLs | fix | Stream reliability |
| `ff97832` Retry stream URL on video playback error | fix | Playback resilience |
| `3d3879f` Flush stale stream URLs on startup and in TTL monitor | fix | Cold start reliability |
| `045ebcf` User-facing error feedback in RemixHero on stream-url fetch failure | fix | UX |
| `3ae7b29` Try/catch for file reads and SQLite transactions in import-tiktok | fix | Error handling |
| `4c0c233` Return 500 on TikTok API database errors | fix | API correctness |
| `dc2b8f2` Cap concurrent stream URL prefetches to 2 in FeedVideo | fix | Performance |
| `f833243` Log ALTER TABLE errors and improve yt-dlp error parsing | fix | Observability |
| `1f7544f` Stabilize onAdvance callback ref in NextUpDialog | fix | React stability |
| `11f89a9` Fix HLS.js memory leak in RemixHero on unmount | fix | Memory leak |
| `26f5c6b` Clean lint: 0 errors, 0 warnings | chore | Code health |

**Pattern:** Almost entirely bug fixes and reliability hardening. No new features. This is healthy for this stage.

---

## Milestone Status

### Complete
- **M1: Desktop MLP** - All tasks done
- **M2: Swipe Feed** - All tasks done except gesture remap (2.2) and service worker caching (2.8 Tier 3)
- **M3: Discovery & Organization** - All major sections done. Remaining: playlist crawling (3.3.1), per-mode cookie files (3.4.1), settings username UI (3.3.1), mobile device testing gate (3.11)
- **M5: Design Polish** - ~80% done. Typography, color, spacing, accessibility all shipped. Remaining: logo SVG, page transitions, hero scroll tweaks, token consolidation

### In Progress
- **M4: Deploy & Advanced** - 4.1 (server deployment) done. 4.2 (social mode pipeline) deferred. 4.3 (themes) done. 4.4-4.7 (AI recs, extension, sync, offline) not started
- **M5a: Video Playback** - Core fixes done, but all "deep playback testing" items (5a.2) are marked `[?]` awaiting manual browser verification

### Not Started
- AI recommendations (4.4)
- Browser extension (4.5)
- Cross-device full sync (4.6)
- Offline/PWA mode (4.7)

---

## Scope Creep Analysis

### The Good
Core milestone work has been disciplined. M1-M3 shipped without significant scope expansion. The Docker deployment (new) is a legitimate infrastructure need, not feature creep.

### The Concerning
The "Discovered Tasks" and "QA Failures" sections now contain **25+ open items**, including:

- 6 P1 bugs from manual QA testing (March 27)
- 10+ P2 UX/design rework items with extensive design specs inline
- Complex redesign specs (category row spotlight-on-hover, queue bottom-sheet drawer) that are essentially new features disguised as polish
- The "category cards spotlight-on-hover redesign" alone is a multi-day feature with its own design spec, debounce logic, and keyboard nav requirements

### Velocity Risk
The ratio of "bug found" to "bug fixed" in the QA section looks healthy (many P0/P1s already fixed), but the P2 items are growing faster than they're being resolved. Items like "ForYou and Remix show same content" and "category row redesign" are not quick fixes -- they're design decisions that need scoping.

### Recommendation
**Draw a hard line between "ship blockers" and "v2 nice-to-haves."** Move the P2 design rework items (category spotlight, queue drawer, carousel rework) into a dedicated "Post-Launch Polish" milestone. Focus remaining effort on:
1. P0/P1 QA bugs (NSFW flash on load, mobile feed load times, broken long-press)
2. Manual device testing gate (3.11)
3. Docker deployment validation

---

## Code Review Findings

### P0 - Fix Before Shipping

**1. Puppeteer request listener leak** (`server/sources/scraper.js:183-191`)
Every `_newPage()` call registers a `page.on('request')` listener that's never removed. Over many scrape operations, this accumulates and prevents GC. Fix: store handler reference, remove in finally block.

**2. HLS.js instance orphan on timeout** (`src/components/feed/FeedVideo.jsx:66-90`)
If `MANIFEST_PARSED` never fires (network issues), the HLS.js instance persists indefinitely. No timeout exists. Fix: add 10s timeout that destroys the instance and rejects the promise.

### P1 - Fix Soon

**3. AbortController race in stream URL warming** (`src/stores/feedStore.js:207-228`)
When `resetFeed()` fires, in-flight fetch completions can write stale data to the new buffer. Fix: validate video URL still matches before updating state.

**4. Proxy-stream pipe missing null body check** (`server/index.js:281-301`)
If upstream returns error status with no body, `Readable.fromWeb(upstream.body)` fails. Fix: check `upstream.body` before piping.

**5. FeedVideo event listener cleanup race** (`src/components/feed/FeedVideo.jsx:165-254`)
Listeners added after abort check can orphan if component unmounts mid-setup. Fix: add `cancelled` checks in all listener callbacks.

### P2 - When Convenient

**6. TTL monitor async error handling** (`server/index.js:1819-1849`) - Wrap in IIFE for proper promise handling.

**7. Scraper consecutive failures not reset on success** (`server/sources/scraper.js:297`) - Counter stays stale after browser recreation.

**8. Missing null body check on proxy upstream** (`server/index.js:281, 327`) - Edge case when CDN returns error with empty body.

---

## Claude Code Review Prompt

If the code review findings above are notable enough to act on, here's a prompt for Claude Code:

```
Review and fix these 8 issues found in the FeedDeck codebase. Fix P0s completely, fix P1s, and add TODOs for P2s.

**P0 #1 - Puppeteer listener leak (server/sources/scraper.js)**
In `_newPage()` (~line 183), `page.on('request', handler)` is registered but never removed when the page closes. Store the handler reference on the page object, then in `_scrapeVideoList`'s finally block (~line 316), call `page.removeListener('request', handler)` before `page.close()`.

**P0 #2 - HLS.js timeout (src/components/feed/FeedVideo.jsx)**
In `loadSource()` (~line 66), the HLS promise has no timeout. If MANIFEST_PARSED never fires, the instance leaks. Add a 10-second setTimeout that calls `_sharedHls.destroy()`, sets it to null, and rejects the promise. Clear the timeout on both resolve and reject paths.

**P1 #3 - feedStore warm race (src/stores/feedStore.js)**
In `_warmStreamUrls()` (~line 212), after fetch completes, verify `state.buffer[idx].url === v.url` before updating. Also distinguish AbortError from real errors in the catch block.

**P1 #4 - Proxy-stream null body (server/index.js)**
In both proxy-stream handlers (~line 281 and ~line 327), add `if (!upstream.body) { res.end(); return }` before calling `Readable.fromWeb()`.

**P1 #5 - FeedVideo listener race (src/components/feed/FeedVideo.jsx)**
In the second useEffect (~line 165), add `if (cancelled) return` guard at the top of every event listener callback (onPlaying, onWaiting, onError, onLoadedMetadata).

**P2 #6 - TTL monitor (server/index.js ~line 1819)** - Add TODO comment noting the async interval should be wrapped in IIFE.

**P2 #7 - Scraper failure reset (server/sources/scraper.js ~line 297)** - Add `this._consecutiveFailures = 0` before the success return in `_scrapeVideoList`.

**P2 #8 - Proxy null body (server/index.js)** - Already covered by P1 #4.

Run `npm run lint` after all changes. Don't break any existing functionality.
```

---

*Report generated automatically by scheduled progress task.*
