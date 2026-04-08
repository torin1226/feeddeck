# FeedDeck Progress Report — March 25, 2026

## What Changed Since Last Report (March 22)

**3 commits landed** since the last report (down from 19 in the prior period). The pace has slowed considerably.

### Commits Since March 22

| Commit | What Shipped |
|--------|-------------|
| `62fedc0` | Fix YouTube seed: no username required (uses cookie auth) |
| `daa991f` | 3.3.1 Seed recommendations from PornHub history |
| `afb5318` | 5a.1-5a.2 playback verification + personalized discovery |

All three commits are focused on the **recommendation seeding pipeline** (3.3.1) and **playback verification** (5a). No new features. No new milestones completed.

## Backlog Scorecard

| Section | Total Tasks | Done | Remaining | % Complete | Change |
|---------|-------------|------|-----------|------------|--------|
| M1 Desktop MLP | ~45 | 45 | 0 | 100% | — |
| M2 Swipe Feed | ~55 | 54 | 1 | 98% | — |
| M3 Discovery | ~48 | 44 | 4 | 92% | **+3 open** (3.3.1 playlist crawl, 3.4.1 per-mode cookies, settings UI) |
| M4 Deploy & Advanced | ~20 | 14 | 6 | 70% | — |
| M5 Design Polish | ~35 | 33 | 2 | 94% | +3 closed (logo deferred, items moved to M6) |
| M5a Playback | ~15 | 11 | 4 | 73% | — (all remaining are `[?]` manual test gates) |
| **M6 Visual Conviction** | **~90** | **0** | **~90** | **0%** | **NEW MILESTONE** |

**Overall estimated: ~201/~308 tasks (65%)**

Previous report showed 198/224 (88%). The drop from 88% to 65% is entirely due to Milestone 6 adding ~90 new tasks.

## Are We Progressing or Scope Creeping?

**Verdict: Scope creep is now the dominant force.**

### The Good

The recommendation seeding pipeline (3.3.1) shipped. PornHub history import now works with cookie auth, tag extraction populates preferences automatically, and the discover endpoint has real signal. This was flagged as the "highest-leverage feature" in the last report and it's done. The playback verification audit (5a) also ran, confirming the proxy chain works for multiple sources.

### The Concerning

**1. Milestone 6 appeared and it's massive.** Since March 22, the backlog grew by ~90 tasks across 8 new subsections (6.1-6.8). That's more tasks than Milestones 1 and 2 *combined*. The backlog went from 224 to ~308 items. Zero of these new items are complete.

Sections added:
- 6.1 Icon System & Material Language (~7 tasks)
- 6.2 Typography & Spacing System (~6 tasks)
- 6.3 Motion & Route Polish (~8 tasks)
- 6.4 Feed Experience Overhaul (~30 tasks across 10 subsections)
- 6.5 Homepage Overhaul (~15 tasks across 7 subsections)
- 6.6 Library Overhaul (~15 tasks across 6 subsections)
- 6.7 Settings Overhaul (~12 tasks across 8 subsections)
- 6.8 Video Detail Page (~a new page that doesn't exist yet)

**2. The "must-do-first" items aren't done.** M5a playback testing is still 73% complete with 4 manual test gates untouched. M3.11 mobile testing gate is still unchecked. These were called out in the last report and nothing changed.

**3. Velocity dropped 85%.** 19 commits in the period before March 22. 3 commits since. The backlog grew faster than work shipped.

**4. Milestone 6 has internal priority conflicts.** 6.8 (Video Detail Page) is a P0 labeled "single most important UX flow" but it depends on 6.1 (icon system) and 6.2 (typography) to look right. 6.4 (feed overhaul) has its own P0 items. Three different sections claim to be the most important thing.

### Scope Creep Assessment

The last report said "Progressing, with warning signs." The warning signs materialized. Here's the math:

- **Work completed since last report**: ~5 tasks (3 commits worth)
- **Work added since last report**: ~90 tasks (Milestone 6)
- **Net backlog delta**: +85 tasks

For every task completed, 17 were added. That's not iteration, that's scope explosion.

### Recommendation

The project needs a scope freeze and a prioritization pass. Specifically:

1. **Close M5a**: Do the manual testing. It's 4 checkbox items standing between "videos work" and "we hope videos work."
2. **Close M3.11**: Test on a real phone. This gate exists for a reason.
3. **Triage M6 ruthlessly**: 90 tasks split across 8 overhauls is a rewrite, not a polish pass. Pick the 10 highest-impact items and defer the rest to a future phase.
4. **Ship what exists**: The app has a working homepage, feed, library, queue sync, multi-source discovery, and deployment scripts. That's a real product. Polishing it forever isn't shipping it.

## Code Review Findings

### New Issues (Not in March 22 Report)

**HIGH**

| File | Issue |
|------|-------|
| `server/index.js` ~line 36 | **SSRF bypass**: `isAllowedCdnUrl()` hostname check doesn't account for port numbers. Attacker could craft URL with allowed hostname + arbitrary port to proxy internal services. |
| `src/components/feed/FeedVideo.jsx` ~line 100 | **Race condition**: Hard-coded 5s timeout fallback in `loadSource()` can resolve promise before media is actually loaded, causing premature playback on slow connections. |
| `src/pages/FeedPage.jsx` ~line 56 | **Race condition on mode switch**: `setTimeout(() => initFeed(), 0)` allows overlapping feed initializations on rapid mode toggles. |

**MEDIUM**

| File | Issue |
|------|-------|
| `server/index.js` lines 139, 153, 592, 1301, 1333, 1728 | **Silent catch blocks**: 6+ empty/silent catch handlers mask legitimate errors (disk full, bad SQL, permission denied). Production debugging will be painful. |
| `src/stores/queueStore.js` ~line 54 | **No retry on sync failure**: Network errors set `online: false` permanently. No exponential backoff. Users won't know queue sync died. |
| `src/stores/feedStore.js` ~line 70 | **Fire-and-forget watch tracking**: POST to `/api/feed/watched` has no error handling. Watch history silently lost on network failure. |
| `server/index.js` line 52 | **PORT hardcoded**: `const PORT = 3001` ignores `process.env.PORT`. Problem for deployment flexibility. |
| `src/stores/homeStore.js` ~line 10 | **Placeholder data in production**: `breeds`, `adjectives`, `verbs` arrays (puppy generator leftovers) still in store. Will show nonsense if fallback triggers. |

### Previously Reported Issues (March 22) — Status

| Issue | Severity | Status |
|-------|----------|--------|
| Missing `crypto` import crashes playlists | CRITICAL | **Unknown — not verified fixed** |
| yt-dlp child process leak in streaming search | HIGH | **Unknown — not verified fixed** |
| Unbounded feed buffer growth | HIGH | Partially addressed (watchedIds eviction at 1000, but full buffer still unbounded) |
| Puppeteer browser not closed on failures | HIGH | **Unknown — not verified fixed** |
| Silent JSON parse failures | MEDIUM | Still present (6 more silent catches found) |
| Proxy stream no per-chunk timeout | MEDIUM | **Unknown** |
| setInterval callbacks never cleaned up | MEDIUM | **Unknown** |

**None of the March 22 critical/high findings have been confirmed fixed.** The 3 commits since focused on recommendation seeding, not bug fixes.

## Claude Code Review Prompt

The SSRF bypass and race conditions are the new notable findings. Combined with unresolved issues from last report:

```
Review and fix these issues in priority order. After each fix, add a brief comment explaining the change.

1. **HIGH: SSRF bypass in server/index.js** — `isAllowedCdnUrl()` checks `hostname === d` against the CDN allowlist, but doesn't validate the port. A request to `phncdn.com:8080` would pass the check but could be redirected to internal services. Fix: also reject any explicit port that isn't 80 or 443. Use `new URL(url)` and check both `.hostname` and `.port`.

2. **HIGH: Race condition in FeedVideo.jsx loadSource()** — The 5-second setTimeout fallback resolves the load promise regardless of whether the video element has actually loaded. On slow connections this causes a premature "loaded" state. Fix: remove the 5s timeout fallback, or change it to reject (triggering error state) instead of resolve. The `canplay`/`loadeddata` events should be the only success path.

3. **HIGH: Mode switch race in FeedPage.jsx** — `setTimeout(() => initFeed(), 0)` on mode change allows overlapping initializations if the user toggles rapidly. Fix: use an AbortController stored as a ref. Each mode change aborts the previous init before starting a new one.

4. **MEDIUM: Silent catch blocks in server/index.js** — Lines 139, 153, 592, 1301, 1333, 1728 all have empty or comment-only catch blocks. Replace each with `logger.warn()` or `logger.error()` calls that include the error message and the operation context. Silent failures make production debugging impossible.

5. **MEDIUM: Hardcoded PORT** — Line 52 has `const PORT = 3001`. Change to `const PORT = process.env.PORT || 3001` for deployment flexibility.

6. **VERIFY: March 22 findings** — Check if these were fixed in recent commits:
   - `crypto` import for playlist ID generation (server/index.js ~line 606)
   - yt-dlp spawn timeout in `streamSearch()` (server/sources/ytdlp.js ~line 177)
   - Puppeteer browser cleanup on scrape failure (server/sources/scraper.js ~line 195)
   - setInterval cleanup on SIGTERM (server/index.js ~lines 1392, 1423, 1460)
   If any are still unfixed, fix them now.

After all fixes, run:
- `npx eslint . --max-warnings 20`
- `node -e "require('./server/index.js')"` (verify no startup crash)
- Check that `npm run build` completes without errors
```

---

*Report generated automatically on 2026-03-25 by scheduled task.*
