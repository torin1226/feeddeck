# FeedDeck Progress Report — March 27, 2026

## What Changed in the Last 48 Hours

**18 commits**, **44 files changed**, **3,432 lines added**, 227 removed. Big two days.

### Major Work Completed

1. **Docker Deployment** — Multi-stage Dockerfile with Node 22, Chromium, ffmpeg, yt-dlp, and curl_cffi for TLS impersonation. docker-compose.yml, .dockerignore. Cookie writeback fix for Docker volume permissions.

2. **TikTok GDPR Import Pipeline** — Full pipeline: `import-tiktok.js` parses TikTok data exports (favorites, likes, watch history), `process-tiktok-imports.js` enriches via yt-dlp. 56K+ imports seeded, 101 videos processed at ~93% success rate. Four new API routes.

3. **Stream URL Reliability Overhaul** — Three targeted fixes:
   - Flush all stale stream URLs on server startup (prevents 500/403s after restart)
   - TTL monitor now NULLs both stream_url AND expires_at (consistency fix)
   - FeedVideo retries stream URL on video playback error (handles CDN expiry mid-session)

4. **Desktop Feed Views (ForYou + Remix)** — Netflix-style browse view with:
   - ForYouFeed horizontal scroll-snap with autoplay
   - TheatreOverlay with mouse-reveal controls and hold-to-scrub
   - Scrubbable timeline progress bar
   - NextUpDialog with countdown and auto-advance
   - Desktop tab bar (For You / Remix)
   - Desktop breakpoint hook

5. **Mobile Feed Polish** — Adaptive video height for landscape content, swipe-to-theatre mode, double-tap seek in theatre.

---

## Backlog Scorecard

| Milestone | Status | Open Tasks |
|-----------|--------|------------|
| M1: Desktop MLP | **COMPLETE** | 0 |
| M2: Swipe Feed | **COMPLETE** (minus manual mobile test sign-off) | 1 (manual gate) |
| M3: Discovery & Org | ~90% complete | Per-mode cookies (3.4.1), playlist crawl, settings UI username field, mobile device test gate |
| M4: Deploy & Advanced | Partial | Social mode pipeline deferred, AI recs, browser extension, offline, cross-device sync |
| M5: Design Polish | ~85% complete | Logo SVG, page transitions, hero scroll tweaks, color token consolidation |
| M5a: Video Playback | Code complete, awaiting manual test | 8 items need manual browser verification |
| QA Failures | **13 open bugs** | 3 P0, 4 P1, 4 P2 |

---

## Are We Progressing or Scope Creeping?

**Verdict: Progressing, but with a growing QA tail.**

The last 48 hours were productive on *new capability* (Docker, TikTok import, desktop feed views, stream reliability). These are all on the critical path: Docker enables deployment, TikTok import seeds the recommendation engine, desktop feed views are core M2 deliverables, and stream reliability is table-stakes.

**The concern:** There are now **13 open QA bugs** from March 26 manual testing, including 3 P0s (homepage cards don't play correct video, hover previews broken, 0-duration videos in feed). These are user-facing regressions that will compound if new features keep landing without fixing them.

**Scope creep risk is moderate.** The TikTok GDPR import was net-new work not in the original backlog (added as a discovered task). It's defensible as it feeds the recommendation engine, but the 56K pending imports represent ongoing processing debt. The ForYou/Remix desktop views are also net-new UI patterns that weren't in the original M2 spec (which was mobile-focused swipe feed).

**Recommendation:** Pause new feature work. Fix the 3 P0 QA bugs, then do the manual mobile test sign-off (M2.7 and M3.11 gates). The backlog is feature-rich enough to ship; what's missing is stability.

---

## Code Review Findings

### Critical (fix before next feature work)

| Issue | Location | What's Wrong |
|-------|----------|-------------|
| **Retry counter never resets** | `FeedVideo.jsx:109,181` | `streamRetries` ref increments to 1 and never resets. If video A fails and retries, video B in the same component won't retry because counter is already at max. |
| **No URL validation on TikTok import** | `import-tiktok.js:90` | URLs extracted from GDPR export with no validation. Malformed/injection URLs can be inserted into DB. |
| **No initial TTL flush at startup** | `server/index.js:~1990` | Server starts without flushing expired URLs. Between startup and first TTL check (5 min), stale URLs are served. The startup flush code exists but may not run before the listen call. |

### Medium (fix soon)

| Issue | Location | What's Wrong |
|-------|----------|-------------|
| HLS init duplicated 3x | `FeedVideo.jsx`, `ForYouSlot.jsx`, `RemixHero.jsx` | Three copies of HLS setup with slight variations. Bug fixes need applying in 3 places. |
| Stream URL fetch errors swallowed | `RemixHero.jsx:30`, `ForYouSlot.jsx:52` | `catch { return }` / `catch { /* fallback */ }` with no logging or user feedback. Hero shows blank. |
| Missing null check on onAdvance | `NextUpDialog.jsx:40` | `onAdvance()` called without `?.` guard. Will crash if prop is undefined. |
| Dockerfile incomplete | `Dockerfile:40-41` | File appears truncated mid-comment. Missing EXPOSE, USER, HEALTHCHECK, ENTRYPOINT. |
| Docker deps not version-pinned | `Dockerfile:21,23` | yt-dlp and curl_cffi downloaded as latest. Non-reproducible builds. |
| DB errors masked | `import-tiktok.js:105-119` | INSERT OR IGNORE hides non-duplicate failures. No try-catch wrapper. |
| Puppeteer browser leak | `server/sources/scraper.js:~195` | Failed scrapes don't close browser instance. Already in backlog as discovered task. |

### Minor

| Issue | Location | What's Wrong |
|-------|----------|-------------|
| Duplicate CSS keyframes | `NextUpDialog.jsx:61-66,123-128` | `foryou-slideInRight` defined twice in same file. |
| No index on expires_at | `feed_cache` table | TTL monitor queries filter on `expires_at` without index. Slow at scale. |

---

## Claude Code Review Prompt

If the critical findings above warrant action, here's a prompt to hand to Claude Code:

```
Review and fix these three issues in the FeedDeck codebase:

1. **FeedVideo.jsx retry counter bug** — `streamRetries.current` (around line 109) increments when a video fails but never resets when a new video loads into the same component slot. Reset the counter to 0 in the effect that runs when the video URL/slot changes, so each new video gets its own retry budget.

2. **import-tiktok.js URL validation** — Around line 90 where URLs are extracted from TikTok GDPR export with `linkMatch[1].trim()`, add validation that the URL matches expected TikTok video URL patterns (https://www.tiktok.com/@.../video/...) before inserting into the database. Log and skip malformed URLs.

3. **NextUpDialog.jsx null safety** — Around line 40, `onAdvance()` is called without a null check. Change to `onAdvance?.()` to prevent crashes when the prop isn't provided.

Also do a quick check: in server/index.js around the startup initialization (~line 1990), verify that the stream URL flush (NULLing all cached stream_urls) runs BEFORE app.listen() returns, not after. If it runs after, move it to a synchronous initialization step before the server starts accepting requests.

Don't touch anything else. Run `npm run build` after changes to verify no regressions.
```

---

*Report generated automatically — March 27, 2026*
