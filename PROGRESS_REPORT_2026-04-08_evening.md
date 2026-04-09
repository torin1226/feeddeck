# FeedDeck Progress Report — April 8, 2026 (Evening)

## Backlog Snapshot

| Status | Count |
|--------|-------|
| Complete `[x]` | 424 |
| Open `[ ]` | 45 |
| In Progress `[~]` | 1 |
| Needs Decision `[?]` | 14 |
| Blocked `[!]` | 1 |
| **Total** | **485** |

**Completion rate: 87%**

---

## Changes Since Yesterday (April 7)

**7 items completed on April 8:**

1. **Recovered truncated index.css** — fadeIn keyframe was cut off mid-rule, fixed and deduplicated view transition rules.
2. **Theatre mode loading spinner** — Replaced plain text with spinner + backdrop-blur, added aria role="status" for screen readers.
3. **Hero Like button wired** — Connected to libraryStore.toggleFavorite with filled/unfilled heart state + accent color.
4. **VideoCard touch actions** — Long-press (600ms) opens context menu on mobile, prevents accidental click after long-press.
5. **Global toast system** — New toastStore.js + GlobalToast.jsx component wired into AppShell. Queue operations now show feedback across all surfaces.
6. **HeroSection random year bug** — Fixed `2020 + Math.random()` that flickered on every Like interaction. Now extracts actual upload year.
7. **Skeleton-to-content crossfade** — Added contentReveal keyframe (200ms ease-out opacity + translateY) to index.css.

**Net movement:** +7 items completed, +19 new items added (Design Review Run 4: Competitive Comparison).

---

## Milestone Status (vs. Yesterday)

| Milestone | Yesterday | Today | Delta |
|-----------|-----------|-------|-------|
| 1: Desktop MLP | DONE | DONE | — |
| 2: Swipe Feed | DONE | DONE | — |
| 3: Discovery & Organization | DONE | DONE | — |
| 4: Deploy & Advanced | DONE | DONE | — |
| 5a: Video Playback | ~95% | ~95% | No change |
| 5: Design Polish | ~90% | ~92% | +2% (7 items) |
| 6: TV Mode | NOT STARTED | NOT STARTED | — |
| 7: Visual Identity | NOT STARTED | NOT STARTED | — |

---

## Scope Creep Assessment

**Verdict: Scope creep is now outpacing execution.**

Yesterday this report said "momentum is strong, scope creep is contained." That's no longer accurate. Today's Design Review Run 4 added 19 new items modeled after Netflix/HBO Max competitive patterns. In the same period, 7 items were completed. That's a net increase of 12 open items, expanding the backlog while the core work (M5 polish, M5a playback validation) hasn't moved.

The 14 `[?]` needs-decision items are also a drag. Every unresolved decision is a context switch waiting to happen.

**Specific concerns:**

- "Continue Watching row on Homepage," "Search UI in Header," and "Hero autoplay" were tagged P0 by the design review. These are features, not polish. They should live in M6, not block M5 completion.
- The competitive comparison framing ("Netflix does X, HBO does Y") is generating aspirational scope, not shipping scope. FeedDeck is a personal content viewer, not a streaming service. Different bar.
- The 8 manual playback tests from M5a still haven't been executed. This was called out yesterday too.

**Recommendation:** Freeze the backlog. Stop running automated design reviews that generate new work. Close out M5/M5a with a focused 2-3 session sprint, then triage the 45 open items into M6/M7/Someday. Right now the project is generating tasks faster than it retires them.

---

## Code Review Findings

### What's Solid
Security fundamentals are better than most hobby projects: prepared SQL statements, CDN domain whitelist, SSRF protection, rate limiting, command injection fixed (execFile over shell). Privacy design is thoughtful with multi-layer NSFW protection and nuclear store flush on mode toggle.

### Critical Issues (3)

1. **Truncated source files** — useKeyboard.js, FeedPage.jsx, and OfflineBanner.jsx all have incomplete code (cut off mid-expression). These files will crash at runtime. This was flagged in the morning sprint but only index.css was fixed.

2. **Unsafe JSON.parse on external data** — Multiple bare JSON.parse calls on yt-dlp stdout (~line 762 in server/index.js) with no try-catch. Malformed output from yt-dlp crashes the server process.

3. **SSE endpoint missing disconnect cleanup** — `/api/recommendations/seed` doesn't abort on client disconnect. Long seed imports burn CPU/memory after the user navigates away.

### High Priority (5)

4. **Module-level singleton video/HLS** — `_sharedVideo` and `_sharedHls` in FeedVideo.jsx are never garbage collected. Memory leak on long sessions.
5. **Circular dependency** — modeStore ↔ feedStore use lazy dynamic imports as a workaround. Needs a store orchestrator or event bus.
6. **Puppeteer browser instances not guaranteed to close on error** — Missing try-finally in scraper methods.
7. **EventSource in SettingsPage.jsx lacks unmount cleanup** — Memory leak.
8. **Missing memoization in FeedPage** — Callbacks recreated every render due to changing deps (currentIndex, buffer.length).

### Structural

9. **Zero test coverage.** No test directory exists.
10. **server/index.js is 2,100+ LOC monolith.** Should be split into route modules.
11. **No database migration framework.** Schema changes are unversioned.
12. **Git repo is broken** — index corrupted, no commits have been made. All work is uncommitted.

---

## Claude Code Prompt (If Findings Warrant Action)

The truncated files and unsafe JSON.parse are the most dangerous findings. Here's a prompt for Claude Code:

```
I need you to fix 5 critical issues in the FeedDeck codebase. For each fix, make the minimal change needed — don't refactor surrounding code.

### 1. Fix truncated source files (CRITICAL — app crashes)
These files have incomplete code that was cut off during a session save:

- `src/hooks/useKeyboard.js` — ends at "windo" instead of completing the cleanup return. Fix the cleanup function to properly call `window.removeEventListener('keydown', handleKeyDown)` and close the useEffect.
- `src/pages/FeedPage.jsx` — ends at "SourceCo" instead of completing the SourceControlSheet render. Complete the JSX to properly close all open tags.  
- `src/components/OfflineBanner.jsx` — div tag never closed. Close the component properly.

For each: read the file, understand the intent from context, and complete the truncated code. Run `npx eslint <file>` after each fix to verify syntax.

### 2. Safe JSON.parse wrapper (CRITICAL — server crashes)
Create `server/utils.js` with a `safeParse(str, fallback)` function that wraps JSON.parse in try-catch, logs failures, and returns the fallback value. Then replace all bare JSON.parse calls in `server/index.js` that parse external data (yt-dlp output, database fields) with safeParse. Key locations around lines 762, 882, 1490.

### 3. SSE disconnect cleanup (HIGH — resource leak)
In `server/index.js`, find the `/api/recommendations/seed` SSE endpoint. Add `req.on('close', ...)` handler that sets an `aborted` flag, and check that flag before each major operation in the seed loop. The `/api/search` endpoint already does this correctly — match that pattern.

### 4. EventSource cleanup in SettingsPage (HIGH — memory leak)
In `src/pages/SettingsPage.jsx`, find the EventSource creation. Wrap it in a useEffect with a cleanup function that calls `es.close()` on unmount.

### 5. Puppeteer resource safety (HIGH — memory leak)
In `server/sources/scraper.js`, wrap every `browser.newPage()` call in try-finally to guarantee `page.close()`. Pattern:
```js
const page = await browser.newPage();
try { /* scraping */ } finally { await page.close().catch(() => {}); }
```

Do NOT touch: component splitting, test infra, migration framework, server modularization, or store architecture. Those are separate efforts.

After all fixes, run `npx eslint src/ server/ --max-warnings 0` and report any remaining errors.
```

---

## Bottom Line

The app works. Milestones 1-4 are shipped, the core product is functional end-to-end. But the project is in a maintenance-debt spiral: no git history (broken repo), truncated files from session saves, zero tests, and automated design reviews generating scope faster than it ships. The next session should focus entirely on stabilization — fix the broken files, get git working, close M5/M5a — before adding anything new.

*Report generated automatically by scheduled task. No user action was taken.*
