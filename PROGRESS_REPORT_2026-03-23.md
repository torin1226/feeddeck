# FeedDeck Progress Report — March 23, 2026

## What Changed in the Last 24 Hours

**5 commits landed** (March 22-23). Pace dropped from yesterday's 19-commit blitz, but the work was higher-leverage:

| Commit | What shipped |
|--------|-------------|
| `3ce9c5d` | ESLint cleanup (34→16 warnings) + personalization audit |
| `9986d02` | GitHub repo link in backlog |
| `afb5318` | 5a.1-5a.2 playback verification + personalized discovery wiring |
| `daa991f` | 3.3.1 Seed recommendations from PornHub history |
| `62fedc0` | YouTube seed fix (cookie auth, no username needed) |

**The big win:** Recommendation seeding is live. Users can now import PornHub favorites/history and YouTube liked videos to bootstrap the tag preference engine. This was the highest-leverage feature on the board — the difference between "random videos" and "videos you'll actually want to watch."

**Also fixed:** `crypto` import crash (playlist creation was DOA), tag preferences now influence discovery queries, yt-dlp streamSearch timeout added, feed buffer capped at 200.

## Backlog Scorecard

| Section | Total | Done | Remaining | % Complete | Delta vs. Yesterday |
|---------|-------|------|-----------|------------|-------------------|
| M1 Desktop MLP | ~45 | 45 | 0 | 100% | — |
| M2 Swipe Feed | ~55 | 54 | 1 (service worker cache) | 98% | — |
| M3 Discovery | ~45 | 44 | 1 (mobile testing gate) | 98% | — |
| M4 Deploy & Advanced | ~20 | 14 | 6 | 70% | — |
| M5 Design Polish | ~35 | 30 | 5 (deferred decisions) | 86% | — |
| M5a Playback | ~15 | 11 | 4 | 73% | — |
| Discovered Tasks | ~17 | 10 | 7 (+1 blocked) | 59% | +4 done, +2 new |

**Overall: ~208/232 tasks (90%, up from ~88% yesterday)**

The completion count rose because yesterday's morning sprint knocked out 4 discovered tasks (crypto fix, tag wiring, streamSearch timeout, buffer cap). Two new discovered tasks were added (hover preview cleanup, content spillage blocker).

## Are We Progressing or Scope Creeping?

**Verdict: Progressing. Momentum is real but plateauing.**

**The good:**
- Personalization pipeline went from "architecturally wired but functionally dead" (yesterday's words) to actually seeding real tag preferences from user history. That's the single most important behavioral change in the last 48 hours.
- 4 code quality issues from yesterday's report were fixed same-day. That's responsive engineering.
- Overall completion ticked up 2% despite adding new tasks. Net positive.

**The concerning:**
1. **M5a Playback is still the blocker at 73%.** Eight `[?]` items in 5a.2 all require manual browser testing. No automation path exists — Chrome blocks media in MCP-controlled tabs. This is a manual labor problem, not a code problem. Torin needs to sit down with a phone and test.

2. **Content spillage is a design flaw, not a bug.** The `[!]` blocked item — NSFW cookies leaking into Social requests, NSFW tags influencing Social discovery — is an architecture issue. It requires per-mode cookie files (3.4.1, 6 subtasks all `[ ]`) and a new `mode` column on `tag_preferences`. This isn't scope creep; it was always implicit in dual-mode architecture. But it's now explicitly surfaced and blocking.

3. **Discovered Tasks growing faster than shrinking.** 17 total, 7 open + 1 blocked. Yesterday it was ~13 total, ~7 open. The review cycle is surfacing real issues, but each sprint adds as many items as it closes.

4. **Deferred decisions accumulating.** 8 `[?]` items across M4-M5 (logo, page transitions, scroll zone, color tokens, glass materials, card highlights, hero positioning, plus the new content spillage). These are design debt that needs Torin's attention.

**Bottom line:** The project is feature-complete enough to use daily. The gap is between "works in dev" and "works reliably on a phone." That gap is 100% testing + the content spillage fix.

## Code Review Findings

Three-part deep review covering `server/index.js`, all Zustand stores, and all source adapters. Compared against yesterday's findings to track what's new vs. persistent.

### Fixed Since Yesterday (confirmed)
- ✅ `crypto` import — fixed, backlog marked done
- ✅ yt-dlp streamSearch timeout — 60s kill timer added
- ✅ Feed buffer cap — MAX_BUFFER=200 with safe eviction

### Persistent Issues (reported yesterday, still open)
- ❌ Puppeteer browser not closed on scrape failure (`scraper.js`)
- ❌ SIGTERM handler missing for setInterval cleanup (`server/index.js`)
- ❌ Proxy-stream per-chunk timeout (`server/index.js`)
- ❌ AbortController for `_warmStreamUrls()` (`feedStore.js`)
- ❌ Silent JSON parse failures in tag processing (`server/index.js`)

### New Findings

#### CRITICAL (4 new)

**1. HLS proxy fetch has no timeout** — `server/index.js` line 287
The `/api/hls-proxy` fetch lacks `AbortSignal.timeout()` while the adjacent `/api/proxy-stream` has a 15s timeout. A stalled CDN hangs the request indefinitely.

**2. Puppeteer event listener memory leak** — `scraper.js` lines 182-189
`page.on('request', ...)` registered in `_newPage()` is never removed. Each `searchAll()` call creates multiple pages with accumulated listeners. Long-running searches leak memory.

**3. Unhandled JSON.parse in yt-dlp extractMetadata** — `ytdlp.js` line 77
`JSON.parse(stdout)` has no try/catch. If yt-dlp outputs warnings mixed with JSON (which it does), the server crashes.

**4. Feed buffer trim logic is broken** — `feedStore.js` lines 91-105
`safeToTrim = Math.min(trimCount, Math.max(0, currentIndex - 10))` evaluates to 0 when `currentIndex < 10`, which is always true early in a session. The MAX_BUFFER=200 cap added yesterday is effectively a no-op until the user scrolls past video #10.

#### HIGH (6 new)

**5. Queue reorder has no rollback on failure** — `queueStore.js` lines 148-179. Optimistic update persists even when server rejects.

**6. `watchedIds` Set grows unboundedly** — `feedStore.js` line 23. Never evicted. Memory accumulates across entire session.

**7. Race condition in `_warmStreamUrls()`** — `feedStore.js` lines 177-198. Fire-and-forget fetches with stale closures can overwrite newer buffer data.

**8. Cobalt adapter no response validation** — `cobalt.js` lines 70-81. Assumes `result.filename` exists. Malformed response corrupts metadata.

**9. `base.js normalizeVideo()` uses `crypto.randomUUID()` without import** — `base.js` line 52. Every video missing an `id` field crashes the normalizer.

**10. Puppeteer `_newPage()` doesn't close page on setup failure** — `scraper.js` lines 170-192. If `setUserAgent()` or `setViewport()` throw, orphaned page stays open.

#### MEDIUM (8 new)
- `libraryStore.markWatched()` has no server sync — watch history lost on refresh
- `libraryStore` fire-and-forget mutations (favorite, rating, watchLater) fail silently
- SQL injection risk in `PUT /api/sources/:domain` — dynamic column names from user input
- Puppeteer `page.evaluate()` calls have no timeout
- `searchAll()` returns empty array when ALL sites fail (indistinguishable from "no results")
- `homeStore.fetchHomepage()` silently falls back to placeholders with no error state
- Request interception handlers lack error wrapping (`req.abort()`/`req.continue()` can throw)
- `useQueueSync` has unstable `fetchQueue` reference in dependency array

## Claude Code Review Prompt

Findings are notable. Here's the prompt:

```
Review and fix these issues in the FeedDeck codebase, in priority order:

## CRITICAL — Fix immediately

1. **server/index.js ~line 287: HLS proxy missing timeout**
   Add `signal: AbortSignal.timeout(15000)` to the fetch() call in the /api/hls-proxy handler, matching the pattern used in /api/proxy-stream at line 241.

2. **server/sources/ytdlp.js ~line 77: Unhandled JSON.parse**
   Wrap `JSON.parse(stdout)` in extractMetadata() with try/catch. Log the raw stdout on parse failure (truncated to 500 chars). Throw a descriptive error like "yt-dlp returned invalid JSON for {url}".

3. **server/sources/base.js ~line 52: Missing crypto import**
   `normalizeVideo()` uses `crypto.randomUUID()` but crypto is not imported. Add `import { randomUUID } from 'crypto'` at the top of base.js. Check if this is a Node built-in (it is in Node 19+). Verify the project targets Node 22 (check package.json engines or setup script).

4. **src/stores/feedStore.js ~lines 91-105: Buffer trim logic never trims**
   The safeToTrim calculation evaluates to 0 when currentIndex < 10. Fix: change the trim strategy to always trim from the front when buffer exceeds MAX_BUFFER, adjusting currentIndex accordingly. Something like:
   ```js
   const trimCount = newBuffer.length - MAX_BUFFER
   const newBuf = newBuffer.slice(trimCount)
   return { buffer: newBuf, currentIndex: s.currentIndex - trimCount, loading: false }
   ```
   Make sure currentIndex doesn't go negative (clamp to 0).

## HIGH — Fix soon

5. **server/sources/scraper.js: Puppeteer resource leaks (3 issues)**
   a. In `_newPage()` (~line 170): wrap the entire method body in try/catch. On error, call `page.close().catch(() => {})` before re-throwing.
   b. In `_scrapeVideoList()`: add `await this.browser?.close()` and `this.browser = null` in the catch block when consecutive failures >= 5 (the auto-disable path).
   c. In `_newPage()` (~line 182): wrap request interception handler in try/catch: `req.abort().catch(() => {})` and `req.continue().catch(() => {})`.

6. **server/index.js: SIGTERM handler (~line 1763)**
   Store all three setInterval IDs (lines ~1651, 1682, 1719) in a module-level array. In the SIGTERM handler, clearInterval all of them, then call db.close(), then process.exit(0).

7. **src/stores/feedStore.js: watchedIds unbounded growth (~line 23)**
   Convert watchedIds from a Set to a bounded structure. Options: (a) use a simple array with .slice(-500) to keep last 500, or (b) clear it when it exceeds 1000 entries. The simplest fix is adding a check in setCurrentIndex: `if (watchedIds.size > 1000) watchedIds.clear()`.

8. **src/stores/feedStore.js: _warmStreamUrls stale closures (~line 177)**
   Add an AbortController at the module level. In resetFeed(), call controller.abort() and create a new one. Pass the signal to each fetch() in _warmStreamUrls(). Before updating state in the .then(), verify the current buffer still contains the video ID (already done, but also check the signal isn't aborted).

After fixing, run:
- `npx eslint . --max-warnings 20` — should pass
- `node server/index.js` — verify no startup crashes, check that SIGTERM shuts down cleanly
- `npm run build` — verify no new Vite warnings
```

---

*Report generated automatically on 2026-03-23 by scheduled task.*
