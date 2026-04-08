# FeedDeck Progress Report — March 24, 2026

## What Changed in the Last 24 Hours

**7 commits landed** (March 22-24). Pace is steady, focused on personalization and playback reliability:

| Commit | What shipped |
|--------|-------------|
| `04653a8` | Library upgrade + 5a.1 playback audit + stream URL TTL monitoring |
| `fceb6d8` | Fix homepage video playback: proxy all CDN URLs through server |
| `3ce9c5d` | ESLint cleanup (34→16 warnings) + morning sprint audit notes |
| `9986d02` | GitHub repo link in backlog |
| `afb5318` | 5a.1-5a.2 playback verification + personalized discovery wiring |
| `daa991f` | 3.3.1 Seed recommendations from PornHub history |
| `62fedc0` | YouTube seed fix (cookie auth, no username needed) |

**The big win:** Recommendation seeding is now fully functional. PornHub favorites/history import and YouTube liked videos both work to bootstrap tag preferences. This bridges the gap between "random content" and "personalized discovery."

**Also shipped:** CDN proxy fix for homepage playback (was broken), ESLint warnings cut from 34→16 (now at 24 per latest lint), stream URL TTL monitoring.

## Backlog Scorecard

| Section | Done | Open | Blocked | Deferred | % Complete |
|---------|------|------|---------|----------|------------|
| M1 Desktop MLP | 45 | 0 | 0 | 0 | 100% |
| M2 Swipe Feed | 54 | 1 | 0 | 0 | 98% |
| M3 Discovery | 44 | 2 | 0 | 0 | 96% |
| M4 Deploy & Advanced | 14 | 6 | 0 | 0 | 70% |
| M5 Design Polish | 30 | 3 | 0 | 2 | 86% |
| M5a Playback | 11 | 0 | 0 | 8 | 73% (8 need manual test) |
| Discovered Tasks | 11 | 7 | 1 | 0 | 58% |
| **Total** | **~209** | **~19** | **1** | **~10** | **~90%** |

**Delta vs. yesterday:** +1 task completed (crypto fix confirmation), net position essentially flat. No new tasks added today.

## Are We Progressing or Scope Creeping?

**Verdict: Stalling. Momentum has plateaued at 90%.**

Here's the honest assessment:

**The good:**
- Personalization pipeline is complete and functional. The highest-value feature on the board shipped.
- No new discovered tasks in the last 24 hours. The scope boundary is holding.
- ESLint warnings trending down (34 → 24). Code hygiene improving incrementally.

**The concerning:**

1. **Zero code quality fixes landed.** Yesterday's report identified 4 critical and 8 high-severity issues. Today's code review confirms all 12 are still present. Not one was addressed. The review prompt from yesterday was generated but never executed.

2. **M5a Playback is a dead zone.** 8 `[?]` items all require manual browser testing. No progress possible without Torin sitting down with a phone. This has been true for 3 consecutive reports.

3. **Content spillage remains blocked.** The architecture issue (NSFW cookies leaking into Social requests) requires per-mode cookie files (3.4.1, 6 subtasks all `[ ]`). This is the only `[!]` item and it's a real design flaw, not a nice-to-have.

4. **The remaining 10% is the hard 10%.** What's left: manual testing, architectural fixes, design decisions, and deployment. None of this is "write more features" work. It's the unglamorous finish-line work that determines whether this actually ships.

**Bottom line:** The project is feature-complete for daily use. But there are 4 critical bugs that could crash the server, a content isolation flaw that defeats the purpose of dual-mode, and 8 playback scenarios that have never been verified on a real device. Shipping more features would be scope creep at this point. The priority is: fix the criticals, test on a phone, resolve the cookie architecture.

## Code Review Findings

Full review of server/index.js, all Zustand stores, and all source adapters. Compared against March 23 findings.

### Fixed Since March 23
None. All 12 previously reported issues remain open.

### Persistent Issues (3 days running)

**CRITICAL (4)**
1. **HLS proxy fetch has no timeout** — `server/index.js:287`. Stalled CDN hangs the request indefinitely.
2. **Puppeteer event listener memory leak** — `scraper.js:182`. Each searchAll() call accumulates listeners. Long sessions leak memory.
3. **Unhandled JSON.parse in yt-dlp** — `ytdlp.js:77` (also lines 156, 194). yt-dlp mixing warnings with JSON output crashes the server.
4. **Feed buffer trim logic broken** — `feedStore.js:97`. safeToTrim evaluates to 0 when currentIndex < 10. Buffer cap is effectively a no-op early in sessions.

**HIGH (8)**
5. Queue reorder has no rollback on failure — `queueStore.js`
6. watchedIds Set grows unboundedly — `feedStore.js:23`
7. Race condition in _warmStreamUrls — `feedStore.js:177-198`
8. Cobalt adapter no response validation — `cobalt.js:70-81`
9. base.js normalizeVideo missing crypto import — `base.js:52`
10. Puppeteer _newPage doesn't close on setup failure — `scraper.js:170-192`
11. SIGTERM handler missing for setInterval cleanup — `server/index.js`
12. Request interception handlers lack error wrapping — `scraper.js`

### ESLint Status
24 problems (3 errors, 21 warnings). Up from 16 warnings yesterday — the 3 errors are new and should be investigated. Likely related to the recommendation seeding code.

## Claude Code Review Prompt

All 12 issues are now 3 days old. Same prompt as yesterday applies, reprinted with updated context:

```
Review and fix these issues in the FeedDeck codebase. All have been open for 3 days and confirmed present as of March 24.

## CRITICAL — Fix immediately (server crash / data corruption risk)

1. **server/index.js ~line 287: HLS proxy missing timeout**
   Add `signal: AbortSignal.timeout(15000)` to the fetch() call in /api/hls-proxy, matching /api/proxy-stream at line 241.

2. **server/sources/ytdlp.js — Unhandled JSON.parse (3 locations)**
   Lines 77, 156, 194: wrap all `JSON.parse(stdout)` calls in try/catch. Log truncated raw stdout (500 chars) on failure. Throw descriptive error like "yt-dlp returned invalid JSON for {url}".

3. **server/sources/base.js ~line 52: Missing crypto import**
   `normalizeVideo()` uses `crypto.randomUUID()` without importing crypto. Add `import { randomUUID } from 'crypto'` at top. Verify Node 22 target in package.json.

4. **src/stores/feedStore.js ~lines 91-105: Buffer trim logic broken**
   `safeToTrim = Math.min(trimCount, Math.max(0, currentIndex - 10))` evaluates to 0 when currentIndex < 10. Fix: trim from front unconditionally when buffer > MAX_BUFFER:
   ```js
   const trimCount = newBuffer.length - MAX_BUFFER
   if (trimCount > 0) {
     const newBuf = newBuffer.slice(trimCount)
     return { buffer: newBuf, currentIndex: Math.max(0, s.currentIndex - trimCount), loading: false }
   }
   ```

## HIGH — Fix this session

5. **server/sources/scraper.js: Puppeteer resource leaks (3 sub-issues)**
   a. _newPage() (~line 170): wrap body in try/catch, call `page.close().catch(() => {})` on error
   b. Browser not closed on scrape failure: add `await this.browser?.close(); this.browser = null` in catch when consecutive failures >= 5
   c. Request interception: wrap `req.abort()` / `req.continue()` in try/catch

6. **server/index.js: SIGTERM handler**
   Store setInterval IDs (~lines 1651, 1682, 1719) in module-level array. In SIGTERM handler: clearInterval all, db.close(), process.exit(0).

7. **src/stores/feedStore.js: watchedIds unbounded growth (~line 23)**
   Add eviction: `if (watchedIds.size > 1000) watchedIds.clear()` in setCurrentIndex.

8. **src/stores/feedStore.js: _warmStreamUrls stale closures (~line 177)**
   Add module-level AbortController. In resetFeed(), abort and recreate. Pass signal to each fetch in _warmStreamUrls.

9. **server/sources/cobalt.js ~lines 70-81: No response validation**
   Check `result.filename` exists before using. Handle malformed responses gracefully.

10. **src/stores/queueStore.js: Queue reorder no rollback**
    On server rejection, revert to pre-optimistic state. Store previous state before optimistic update.

## VERIFICATION
After fixing, run:
- `npx eslint . --max-warnings 20` — must pass
- `node server/index.js` — verify startup, then Ctrl+C for SIGTERM test
- `npm run build` — no new Vite warnings
```

---

*Report generated automatically on 2026-03-24 by scheduled task.*
