# Morning Sprint Report - March 27, 2026

## What Landed Yesterday (5 commits)

1. **Docker deployment** (`7cf1063`) - Dockerfile, docker-compose, yt-dlp JS runtime, cookie fixes
2. **TTL monitor fix** (`1dd3a29`) - Also NULLs `expires_at` when clearing expired stream URLs
3. **Feed playback retry** (`ff97832`) - Retry stream URL resolution on video playback error
4. **Stale URL flush** (`3d3879f`) - Flush stale stream URLs on startup and in TTL monitor
5. **TikTok GDPR import** (`3f383fe`) - Full import pipeline with batch processor and API routes (56K+ entries)

## Bugs Fixed This Sprint (by Cowork)

### 1. Background tasks never started (CRITICAL)
`startScheduledFeedRefill()`, `startScheduledTrendingRefresh()`, and `startStreamUrlTTLMonitor()` were defined but **never called**. The feed refill, trending refresh, and TTL monitor were completely dead. Wired them into `app.listen()` callback and registered interval IDs for SIGTERM cleanup.

### 2. Puppeteer page leak on `_newPage()` failure
If `_newPage()` threw (e.g., browser crashed), the page variable was uninitialized but the `finally` block tried to close it. Moved page creation inside try block with null guard in finally.

### 3. Silent JSON parse failures in tag processing
Tag aggregation (`/api/tags/popular`) and recommendation scoring (`/api/discover`) silently swallowed malformed JSON. Added `logger.warn()` with video ID and error message so corrupted tag data is visible.

## Backlog Status

| Milestone | Status | Open Items |
|-----------|--------|------------|
| M1: Desktop MLP | **Done** | 0 |
| M2: Swipe Feed | **Done** | 1 (`[?]` manual mobile testing) |
| M3: Discovery | **Mostly done** | 8 (per-mode cookies, playlist crawl, settings UI) |
| M4: Deploy & Advanced | **Mixed** | 12 (social pipeline, AI recs, extension, offline, sync) |
| M5a: Video Playback | **Code done** | 8 (`[?]` all need manual browser testing) |
| M5: Design Polish | **Mostly done** | 5 (logo, page transitions, hero scroll, featured tighten) |
| QA Failures | **New** | 15 bugs from 2026-03-26 manual testing |
| Discovered Tasks | **Open** | 9 technical debt items |

**Total open items: ~58** (many are future/deferred, ~15 are active bugs)

## Decisions Needed

### 1. QA Bug Priority (P0s need attention NOW)
Three P0 bugs from yesterday's manual testing are blocking the core experience:
- **Homepage cards don't play the right video** - clicking a CategoryRow card plays wrong video in theatre mode
- **Hover previews completely broken** - no preview loads on thumbnail hover at all
- **0-second duration videos in feed** - broken videos shouldn't appear

**Recommendation:** These three P0s should be Claude Code's top priority today. They're the difference between "app works" and "app is broken."

### 2. Per-Mode Cookies (3.4.1) vs QA Fixes
Per-mode cookie separation (6 tasks) is architecturally important but not user-facing. QA P0/P1 fixes are user-facing and blocking.

**Recommendation:** Fix QA P0s first, then P1s. Per-mode cookies can wait.

### 3. Background Tasks Were Dead
The scheduled feed refill, trending refresh, and TTL monitor were never actually running. This means:
- Feed cache was only populated on-demand, not proactively
- Trending content was never auto-refreshing
- Expired stream URLs were only caught on access, not proactively

This is now fixed, but you may want to restart the server to activate these tasks.

## Claude Code Prompt (Priority Work)

```
Fix these QA P0 bugs in priority order. Each fix gets its own commit.

1. **Homepage category cards play wrong video:** In CategoryRow/VideoCard click handler,
   the video ID/URL passed to playerStore or theatre mode is incorrect. Trace the click
   from CategoryRow → VideoCard → playerStore.setActiveVideo and verify the correct video
   object is being passed. The hero carousel may be intercepting the click.

2. **Hover previews broken:** In VideoCard or CategoryRow, the hover preview (300ms debounce
   → stream URL fetch → muted video play) is not firing. Check if the onMouseEnter handler
   is wired up, if the stream URL resolution is working, and if the preview video element
   is being created/shown.

3. **0-second duration videos in feed:** Add a filter in the /api/feed/next endpoint to
   exclude videos where duration = 0 or duration IS NULL. Also add the filter in
   refillFeedCache so 0-duration videos aren't ingested.

After P0s, tackle these P1s:
4. ForYou feed: playback controls overlay not showing (z-index or pointer-events issue)
5. ForYou feed: NextUp dialog never appears (onEnded not firing or not wired)
6. ForYou feed: no navigation to next video (scroll/arrow handlers missing)
7. HeroSection z-index bug: search bar overlaps action buttons

Run `npm run build` after all fixes.
```
