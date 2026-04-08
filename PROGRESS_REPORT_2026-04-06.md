# FeedDeck Progress Report — April 6, 2026

## TL;DR

**Day 11 with zero commits on master.** Two branches with critical fixes have been sitting unmerged since April 2. This is now the fourth consecutive report flagging them. The codebase is feature-complete for MVP but the merge bottleneck has frozen all forward progress.

---

## Changes Since Yesterday (April 5)

**Backlog:** No changes. Same 71KB file, same task counts.

**Code:** Zero commits on master. The two unmerged branches remain:

| Branch | Commits | What It Contains |
|--------|---------|-----------------|
| `fix-p0-qa-failures` | 9 commits, 42 files | P0/P1/P2 QA fixes, SQL injection fix, command injection fix, N+1 fix, 35-component Zustand selector migration, React.memo on hot paths, hover preview fix, proxy-stream idle timeout |
| `march-31` | 1 commit | Per-mode cookie files (3.4.1), stability fixes |

**ESLint:** Previous session fixed 1 error and 2 warnings (1→0 errors, 24→22 warnings). These fixes live only in the sprint report files, not committed.

**Net progress since April 5: Zero.**

---

## Scope Creep Assessment

**Verdict: Scope creep is no longer the primary risk. Inertia is.**

The backlog hasn't grown since March 27. The ~15 QA items and ~8 discovered tasks from that session are still the same ones sitting open. No new scope has been added. The core milestones remain disciplined.

The real problem is a three-layer bottleneck:

1. **Merge gate:** Two branches with ~50% of remaining bug fixes can't land without manual merge by Torin
2. **Manual testing gate:** 8 playback tests and mobile sign-off (3.11) require a human with a phone
3. **Motivation gap:** 11-day commit drought follows a pattern of intense 2-day sprints then week-long gaps (March 21-22, March 25-26, then silence)

The project IS progressing toward its end goal in terms of what's been built. But it's been stuck at the "merge and test" phase for nearly two weeks. The unmerged `fix-p0-qa-failures` branch alone would resolve roughly half the open backlog items.

---

## Completion Summary

| Area | Status | Change vs Yesterday |
|------|--------|-------------------|
| Milestone 1 (Desktop MLP) | 100% | — |
| Milestone 2 (Swipe Feed) | ~95% | — |
| Milestone 3 (Discovery) | ~85% | — |
| Milestone 4 (Deploy) | ~40% | — |
| Milestone 5 (Polish) | ~70% | — |
| Open QA failures | ~15 items | — |
| Discovered tasks | ~8 items | — |
| Unmerged branch fixes | 10 commits | — (day 4 of warning) |

**178 tasks completed. ~30 open. 85.6% completion rate.** Unchanged from April 2.

---

## Code Review Findings (Fresh Scan)

Today's automated review found **14 issues** across the codebase. Cross-referencing with previous reports (April 2 and April 5), here's what's new vs. recurring:

### Recurring Issues (flagged before, still unfixed on master)

| Issue | First Flagged | Status |
|-------|--------------|--------|
| useHoverPreview.js video element leak (54+ orphaned elements) | Apr 5 | **Fixed in unmerged branch** |
| Puppeteer browser leak on page init failure | Apr 5 | Open |
| useFeedGestures.js timer leak on unmount | Apr 5 | Open |
| ytdlp.js stderr not consumed (process hang risk) | Apr 5 | Open |
| Graceful shutdown has no timeout | Apr 5 | Open |
| feedStore.js watchedIds unbounded growth | Apr 5 | Open |
| Proxy-stream forwards upstream error codes directly | Apr 2 | Open |
| Stream URL failure logging is blind | Apr 2 | Open |

### New Findings Today

1. **HIGH: HLS singleton not destroyed on FeedVideo unmount** — `_sharedHls` persists as module-level variable when component navigates away without loading a new source. Memory leak on the Beelink.

2. **HIGH: FeedFilterSheet timer leak** — Two naked `setTimeout()` calls (lines 105, 117) that call `initFeed()` without storing timer IDs. Impossible to clean up on unmount.

3. **HIGH: ForYouFeed IntersectionObserver churn** — Observer recreated on every `buffer.length` change. Rapid re-renders cause temporary observer leaks.

4. **MEDIUM: Feed endpoint parseInt returns NaN** — `parseInt(req.query.count)` failure cascades to SQLite `LIMIT NaN` which coerces to 0. Returns empty results silently.

5. **MEDIUM: Feed refill race condition** — No timeout on individual source fetches during refill. Slow source blocks entire pipeline.

6. **MEDIUM: QueueSync polling fires after unmount** — Fetch completes and updates store on dead component.

---

## Are We Progressing Toward the End Goal?

**Yes, in terms of what's been built. No, in terms of shipping.**

The app is functionally complete for an NSFW-first MVP. All core features work: desktop browsing, mobile swipe feed, theatre mode, discovery, organization, search, cookie auth, Docker deployment. 178 of ~208 tasks are done.

But the last 14% is stuck behind two human gates (merge + mobile testing) and an 11-day pause. The unmerged branches contain fixes for the worst bugs. Every day they sit unmerged, the reports just repeat themselves.

**Scope creep is not the problem.** The backlog hasn't grown. The problem is execution momentum on the final stretch.

---

## Recommended Actions (Priority Order)

1. **Merge `fix-p0-qa-failures` into master** — resolves ~50% of open items
2. **Merge `march-31` after** — likely conflict on server/index.js
3. **Fix NSFW flash on SFW load** — P0 safety, not in either branch
4. **Run mobile testing gate (3.11)** — blocks Pi deployment
5. **Fix the 3 new HIGH code review items** — HLS leak, timer leak, observer churn
6. **Deploy to Beelink** — the actual end goal

---

## Claude Code Review Prompt

The following issues are notable and worth fixing. Paste into Claude Code:

```
Review and fix these issues in priority order. Make a separate commit for each fix. Run `npm run lint` after all changes.

1. **HIGH: HLS singleton leak in FeedVideo.jsx**
   - File: src/components/feed/FeedVideo.jsx, around line 251
   - Problem: Module-level `_sharedHls` persists when component unmounts without loading a new source. HLS instance stays alive, consuming memory and network.
   - Fix: Add cleanup in the useEffect return that checks if `_sharedHls` exists and this component owns it. Call `hls.stopLoad()` and `hls.destroy()`. Set `_sharedHls = null`. Guard against double-destroy if another component already cleaned up.

2. **HIGH: Timer leak in FeedFilterSheet.jsx**
   - File: src/components/feed/FeedFilterSheet.jsx, lines ~105 and ~117
   - Problem: Two `setTimeout(() => initFeed(), ...)` calls don't store the timer ID. If component unmounts before timeout fires, `initFeed()` runs on dead state.
   - Fix: Create a `const initTimer = useRef(null)`. Store both timeout IDs: `initTimer.current = setTimeout(...)`. In the cleanup function, add `clearTimeout(initTimer.current)` alongside the existing `clearTimeout(searchTimer.current)`.

3. **HIGH: IntersectionObserver churn in ForYouFeed.jsx**
   - File: src/components/feed/ForYouFeed.jsx, lines ~44-88
   - Problem: Observer is in a useEffect with `buffer.length` in the dependency array. Every buffer change disconnects and recreates the observer, causing DOM thrashing.
   - Fix: Remove `buffer.length` from the dependency array. Instead, use a ref to track the current buffer and read it inside the observer callback. Or memoize the observer setup so it only recreates when the actual observed elements change.

4. **MEDIUM: parseInt NaN in feed endpoint**
   - File: server/index.js, in `/api/feed/next` handler
   - Problem: `parseInt(req.query.count, 10) || 10` works, but if someone passes `count=abc`, parseInt returns NaN, `NaN || 10` returns 10 — this actually works by accident. However, verify this is consistent across ALL parseInt calls in the file. Check lines ~617, 854, 973, 1401 for similar patterns that might NOT have the `|| default` fallback.

5. **MEDIUM: Puppeteer browser leak (recurring)**
   - File: server/sources/scraper.js
   - Problem: If `_newPage()` fails after page creation, the page leaks. No concurrent browser limit.
   - Fix: Wrap `_newPage()` in try/finally so page.close() always runs on error. Add a simple semaphore: `const MAX_PAGES = 3; let activePages = 0;` Check before creating, decrement in finally.

6. **LOW: Graceful shutdown timeout**
   - File: server/index.js, SIGTERM handler
   - Problem: No timeout on cleanup. A stuck background task blocks shutdown forever.
   - Fix: Add `const forceExit = setTimeout(() => { console.error('Forced exit after 10s'); process.exit(1); }, 10000); forceExit.unref();` at the start of the SIGTERM handler.

After fixes, run `npm run lint` and `npm run build` to verify nothing broke.
```

---

*Report generated automatically by scheduled task. No human was present during generation.*
