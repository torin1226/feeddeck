# FeedDeck Progress Report — March 22, 2026

## What Changed in the Last 24 Hours

**19 commits landed.** That's an aggressive pace. Here's what shipped:

### Milestones Completed Yesterday (March 21-22)

| Milestone | Status | Commits |
|-----------|--------|---------|
| M3.0 Source Diversification | Done | Adapter layer, Puppeteer scraper, 6 NSFW sites, health monitoring |
| M3.1 Queue Sync | Done | SQLite-backed, polling, offline indicator |
| M3.2-3.3 Tags + Recs | Done | Tag preferences, rule-based scoring, discover endpoint |
| M3.4 Cookie Auth | Done | cookies.txt import, yt-dlp integration |
| M3.5 Organization | Done | Favorites, watch later, ratings, playlists |
| M3.6-3.9 Search/PiP/Quality/Hero | Done | Multi-site search, PiP, quality selector, hero fitting |
| M3.10 Feed Filters | Done | Source/tag filtering on mobile feed |
| M4.1 Beelink Deployment | Done | systemd, setup script, Tailscale, logging, backups |
| M4.3 Dark/Light Theme | Done | Full theme toggle with flash prevention |
| M4.8 Source Management | Done | Settings page, CRUD API, health dashboard |
| M5.1-5.8 Design Polish | Done | Accessibility, nav, typography, color, motion, spacing, empty states |
| M5.9 Library Upgrade | Done | Tabs, continue watching, progress tracking |
| M5.10 Bundle/Perf | Done | Code splitting, ESLint config |
| M5a.1 Playback Fixes | Partial | Proxy fix, HLS recovery, TTL monitoring. 2 subtasks remain |

**Today's morning sprint** added ESLint cleanup (34 warnings down to 16) and a personalization audit that surfaced a real problem: the recommendation system is wired up but effectively inert because no cookies are imported and discovery queries ignore tag preferences.

## Backlog Scorecard

| Section | Total Tasks | Done | Remaining | % Complete |
|---------|-------------|------|-----------|------------|
| M1 Desktop MLP | ~45 | 45 | 0 | 100% |
| M2 Swipe Feed | ~55 | 54 | 1 (service worker caching) | 98% |
| M3 Discovery | ~45 | 44 | 1 (mobile testing gate) | 98% |
| M4 Deploy & Advanced | ~20 | 14 | 6 | 70% |
| M5 Design Polish | ~35 | 30 | 5 (deferred questions) | 86% |
| M5a Playback | ~15 | 11 | 4 | 73% |

**Overall: ~198/224 tasks done (88%)**

## Are We Progressing or Scope Creeping?

**Verdict: Progressing, but with warning signs.**

The good: M1 through M3 are essentially complete. The app has a working homepage, swipe feed, multi-source discovery, queue sync, and organization features. Deployment scripts exist. Design polish is largely done.

The concerning:

1. **M5a (Playback) is the real blocker.** The most critical milestone — "nothing else matters if this is broken" — is only 73% complete. Two deep-testing subtasks remain untouched. The morning sprint found that video proxying needed a fix (CDN URLs weren't routed through the server on homepage). This suggests playback still has undiagnosed issues.

2. **Deferred items are accumulating.** There are 8 `[?]` items across M4-M5 waiting on user decisions (logo treatment, page transitions, scroll zone, color token consolidation, glass materials, card highlights, social mode pipeline, hero positioning). These aren't scope creep per se, but they're unresolved design debt that'll compound.

3. **Mobile testing gate (3.11) hasn't been touched.** This is explicitly a "do not proceed" checkpoint, and it's still `[ ]`. Everything after it (including the Pi deployment that's already done) technically jumped the gate.

4. **Personalization is architecturally wired but functionally dead.** Tags, recommendations, cookie auth — all built, none producing real results. The discovery pipeline uses generic queries and ignores user preferences. This is the difference between "feature complete" and "feature working."

**Relative momentum is strong on quantity, weaker on depth.** The team is shipping features fast but hasn't circled back to validate that the shipped features actually work end-to-end. The backlog completion percentage flatters — several "done" items need real-device testing.

## Code Review Findings

### Critical (Fix Now)

**1. Missing `crypto` import crashes playlist creation**
`server/index.js` ~line 606, 652 — `crypto.getRandomValues()` called without importing the module. Playlist endpoints will throw at runtime.

### High (Fix Soon)

**2. yt-dlp child process leak in streaming search**
`server/sources/ytdlp.js` ~line 177 — `spawn('yt-dlp', ...)` has no timeout or cleanup on client disconnect. Hung processes accumulate.

**3. Unbounded feed buffer growth**
`src/stores/feedStore.js` ~line 91 — Buffer array grows forever. After extended browsing, hundreds of video objects sit in memory with no eviction.

**4. Puppeteer browser not closed on scrape failures**
`server/sources/scraper.js` ~line 195 — Failed scrapes can leave browser instances running. No health check or restart logic.

### Medium

**5. Silent JSON parse failures** — `server/index.js` multiple locations. Malformed tag data silently skipped.

**6. Proxy stream has no per-chunk timeout** — `server/index.js` ~line 240. Stalled upstream can block response indefinitely.

**7. setInterval callbacks never cleaned up** — `server/index.js` ~lines 1392, 1423, 1460. Three background tasks leak on restart.

**8. Race condition in stream URL prefetching** — `src/stores/feedStore.js` ~line 163. Fire-and-forget fetches update stale buffer state.

## Claude Code Review Prompt

If findings #1-4 are confirmed, paste this into Claude Code:

```
Review and fix these issues in order of severity:

1. **CRITICAL: server/index.js** — `crypto.getRandomValues()` is used for playlist ID generation but `crypto` is never imported. Either import `crypto` from Node's built-in module or use `crypto.randomUUID()` (available in Node 19+). Check if Node 22 is the target runtime. Search for all `crypto.` references in server/ to ensure none are missing imports.

2. **HIGH: server/sources/ytdlp.js `streamSearch()`** — The spawned yt-dlp child process has no timeout. Add a 60-second kill timer. Also wire up the SSE response's `close` event to `child.kill()` so disconnected clients don't leave zombie processes. Verify this pattern in any other spawn() calls in the sources/ directory.

3. **HIGH: src/stores/feedStore.js `fetchMore()`** — The buffer array grows without limit. Add a MAX_BUFFER constant (200 is reasonable) and trim old entries when exceeded. Make sure currentIndex is adjusted when trimming. Also add an AbortController to `_warmStreamUrls()` that gets aborted on `resetFeed()`.

4. **HIGH: server/sources/scraper.js** — After 5 consecutive failures, the adapter auto-disables, but the Puppeteer browser instance stays alive. Add `await this.browser?.close()` in the error path of `_scrapeVideoList()` and set `this.browser = null` so it gets re-launched on next attempt.

5. **MEDIUM: server/index.js background intervals** — Store all setInterval IDs in an array. Add a SIGTERM handler that clears them all and calls `db.close()` before exit. This prevents double-firing in dev mode with nodemon.

After fixing, run `npx eslint . --max-warnings 20` and `node server/index.js` to verify no startup crashes.
```

---

*Report generated automatically on 2026-03-22 by scheduled task.*
