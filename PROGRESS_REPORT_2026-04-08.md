# FeedDeck Progress Report — April 8, 2026

## Changes Since Yesterday (April 7)

**4 backlog items completed on April 7:**

1. **P0: NSFW Content Flash Fix** — Race condition in localStorage hydration could briefly expose NSFW content on cold start. Added inline script to sanitize localStorage before React loads, plus hydration guard as belt-and-suspenders.
2. **Mobile Feed Video Resize Bug** — `onLoadedMetadata` was triggering effect re-runs causing layout jank on swipe. Fixed to update DOM directly.
3. **Typography Scale Cleanup** — Added 8 named fontSize tokens (micro, caption, label, body-sm, subhead, title, display, headline). Replaced 55+ arbitrary text sizes across 14 files. This is real design system progress.
4. **Page Transition Animation** — CSS View Transitions API for 150ms opacity crossfade between routes with graceful degradation.

**No new git commits in last 2 days.** Last commit was the Docker deployment feat (`7cf1063`). The April 7 work may be uncommitted or was done in a session without pushing.

---

## Milestone Status

| Milestone | Status | Notes |
|-----------|--------|-------|
| 1: Desktop MLP | DONE | All 7 sections complete |
| 2: Swipe Feed | DONE | All 9 sections complete |
| 3: Discovery & Organization | DONE | All 11 sections complete |
| 4: Deploy & Advanced | DONE | Core complete, AI/extension/sync deferred |
| 5a: Video Playback | ~95% | 8 manual browser tests outstanding |
| 5: Design Polish | ~90% | Typography, transitions, accessibility landed |
| 6: TV Mode | NOT STARTED | Long-horizon |
| 7: Visual Identity | NOT STARTED | Long-horizon |

---

## Scope Creep Assessment

**Verdict: Momentum is strong. Scope creep is present but contained.**

The good: Milestones 1-4 are fully shipped. That's the entire core product — desktop, mobile feed, discovery, deployment. The app works end-to-end. Milestone 5 (design polish) is ~90% and the April 7 work (typography tokens, transitions, NSFW flash fix) directly advances it.

The concern: The Discovered Tasks section of the backlog (lines 798-880) has grown to include ~30 items spanning QA failures, infrastructure tasks, design review findings, and new feature ideas. Some of these are legitimate polish (mobile long-press sheet fix, feed load delay), but others feel like scope expansion:
- Category card redesign specs
- Playlist crawling
- Per-mode cookie architecture
- Settings UX overhaul

These are real features disguised as "discovered" work. They don't block the MVP or Phase 1 goals.

**Recommendation:** Draw a hard line between "M5 polish to ship" and "future nice-to-haves." The open blockers that matter are:
1. 5+ second feed load delay (P0 — user experience)
2. Mobile long-press sheet broken (P1 — core interaction)
3. 8 manual playback tests (P1 — confidence gate)

Everything else in Discovered Tasks should be triaged into M6/M7 or a separate "someday" list.

---

## Code Review Summary

### What's Working Well
- **Security fundamentals are solid:** Prepared statements, URL scheme validation, ALLOWED_CDN_DOMAINS whitelist, rate limiting on expensive endpoints
- **Privacy design is thoughtful:** Multi-layer NSFW protection, nuclear store flush on mode toggle, SFW-first cold start
- **Architecture is clean:** Adapter pattern for video sources, Zustand + persist, SSE for long-running operations
- **Error handling is comprehensive:** 181+ try-catch blocks server-side, React ErrorBoundary, graceful shutdown handlers

### Notable Findings

**Critical (3):**
1. **Unsafe JSON.parse** — Multiple `JSON.parse()` calls without try-catch, especially on yt-dlp stdout (`server/index.js` ~line 762). Malformed output crashes the server.
2. **Server binds to 0.0.0.0** — Both Vite and Express listen on all interfaces with no auth. Fine for dev, dangerous on the Beelink deployment without Tailscale as the only access layer.
3. **SSE endpoint missing disconnect cleanup** — The `/api/recommendations/seed` endpoint doesn't abort operations when client disconnects, meaning long seed imports continue burning resources after navigation.

**Important (8):**
4. Missing `parseInt()` radix parameter in 11 locations
5. Puppeteer browser instances not guaranteed to close on error (memory leak risk)
6. HLS proxy URL rewriting uses string concat instead of `new URL()` API
7. Cookie temp files in world-readable `/tmp/` directory
8. EventSource in SettingsPage.jsx lacks cleanup on unmount (memory leak)
9. Large component files (SettingsPage 603 LOC, FeedPage 549 LOC, FeedVideo 477 LOC)
10. Shared module-level video element in FeedVideo is fragile to React tree changes
11. Missing error UI for failed stream loads in feed

**Structural:**
12. Zero test coverage — no `/test` or `/__tests__` directory exists
13. No database migration framework — schema changes have no versioning
14. `server/index.js` is 2,100+ LOC monolith — should be split into route modules

---

## Claude Code Review Prompt

The following prompt is ready to paste into Claude Code if findings warrant action:

```
Review and fix the following issues in the FeedDeck codebase, in priority order. For each fix, make the minimal change needed — don't refactor surrounding code unless it's directly related.

### 1. Safe JSON.parse wrapper (Critical)
Create a utility function `safeParse(str, fallback)` in `server/utils.js` that wraps JSON.parse in try-catch and returns the fallback on failure. Then replace all bare JSON.parse calls in `server/index.js` that parse external data (yt-dlp output, database fields, request bodies) with safeParse. Internal config parsing can stay as-is.

Key locations: server/index.js lines ~762 (yt-dlp stdout), ~882 (tags parsing), ~1490 (metadata parsing).

### 2. SSE disconnect cleanup (Critical)
In server/index.js, find the `/api/recommendations/seed` SSE endpoint (~line 655). Add `req.on('close', ...)` handler that sets an `aborted` flag, and check that flag before each major operation in the seed loop. The `/api/search` endpoint already does this correctly (~line 1041) — match that pattern.

### 3. parseInt radix (Quick fix)
Add radix 10 to all parseInt calls in server/index.js. Search for `parseInt(` and ensure every call uses `parseInt(value, 10)`. There are ~11 instances.

### 4. EventSource cleanup in SettingsPage
In src/pages/SettingsPage.jsx, the EventSource created around line 88 needs cleanup on component unmount. Wrap it in a useEffect that returns a cleanup function calling `es.close()`. If there's already a useEffect, add the cleanup to its return.

### 5. Puppeteer resource safety
In server/sources/scraper.js, ensure every method that creates a page or browser instance uses try-finally to guarantee cleanup. The pattern should be:
```js
const page = await browser.newPage();
try {
  // scraping logic
} finally {
  await page.close().catch(() => {});
}
```

Do NOT touch: component splitting, test infrastructure, migration framework, or server modularization — those are separate efforts.
```

---

*Report generated automatically. No user action was taken.*
