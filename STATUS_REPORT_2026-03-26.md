# FeedDeck Status Report — March 26, 2026

## Summary

**441 total tasks tracked. 392 done (89%). 36 open. 13 awaiting user decision.**

No commits have landed since March 22. The last burst was 7 commits on that day covering recommendation seeding, playback fixes, ESLint cleanup, and library upgrades. Development has been idle for 4 days.

## Milestone Status

| Milestone | Total | Done | Open | Blocked/Decision | % Complete |
|-----------|-------|------|------|-------------------|------------|
| M1 Desktop MLP | ~45 | 45 | 0 | 0 | 100% |
| M2 Swipe Feed | ~55 | 54 | 1 | 1 | 98% |
| M3 Discovery & Org | ~50 | 46 | 3 | 1 | 92% |
| M4 Deploy & Advanced | ~20 | 14 | 6 | 0 | 70% |
| M5 Design Polish | ~35 | 30 | 3 | 3 | 86% |
| M5a Playback | ~15 | 11 | 0 | 8 | 73%* |
| Discovered Tasks | ~17 | 10 | 7 | 0 | 59% |

*M5a's remaining items are all `[?]` — they require manual browser testing that can't be automated.

## What Shipped Since Last Report (March 22)

7 commits landed on March 22. Nothing since then.

| Commit | What |
|--------|------|
| `62fedc0` | Fix YouTube seed: no username required (uses cookie auth) |
| `daa991f` | 3.3.1 Seed recommendations from PornHub history |
| `afb5318` | 5a.1-5a.2 playback verification + personalized discovery |
| `9986d02` | Add GitHub repo link to backlog |
| `3ce9c5d` | ESLint cleanup + morning sprint audit notes |
| `fceb6d8` | Fix homepage video playback: proxy all CDN URLs through server |
| `04653a8` | 5.9 Library upgrade + 5a.1 playback audit fixes + stream URL TTL monitoring |

## What's Left — By Priority

### P0: Must fix (blocking quality)

1. **Puppeteer browser leak on scrape failure** — `server/sources/scraper.js` ~line 195. Failed scrapes leave headless Chrome instances alive. Will exhaust memory on the Beelink over time.
2. **Hover preview video element leak** — 54 `<video>` elements found in DOM. Not cleaned up on mouseout. Memory grows with browsing.
3. **Proxy stream has no per-chunk timeout** — `server/index.js` ~line 240. A stalled upstream holds the response open forever.

### P1: Should fix (correctness/resilience)

4. **SIGTERM handler missing** — 3 `setInterval` callbacks in `server/index.js` never cleared. DB not closed on shutdown. Causes issues with nodemon in dev.
5. **AbortController missing in `_warmStreamUrls()`** — Fire-and-forget fetches can update stale buffer state after `resetFeed()`.
6. **Silent JSON parse failures** — Malformed tag data silently skipped in server. Should log warnings.
7. **16 ESLint `react-hooks/exhaustive-deps` warnings** — Need per-hook manual review.

### P2: Deferred decisions (need user input)

8. **Mobile device testing gate (3.11)** — Explicit checkpoint: test on a real phone before proceeding. Not done.
9. **Per-mode cookie files (3.4.1)** — 6 subtasks to separate Social/NSFW cookies in the adapter layer.
10. **Service worker video caching (2.8 Tier 3)** — Cache first 500KB of preloaded video for instant swipe transitions.
11. **Social mode content pipeline (4.2)** — What sources/categories for social mode? Deferred.
12. **8 design polish `[?]` items** — Logo SVG, page transitions, scroll zone tuning, color tokens, glass materials, card highlights, hero positioning.

### P3: Future features (not started)

- AI recommendations via Claude API (4.4)
- Browser extension (4.5)
- Cross-device full sync (4.6)
- Offline mode / PWA (4.7)

## Assessment

**The app is functionally complete for its NSFW use case.** M1-M3 cover the full flow: homepage browsing, swipe feed, multi-source discovery, queue sync, organization, search, and playback. The Beelink deployment works. Recommendation seeding from PornHub history is wired up.

**The gap is reliability, not features.** The three resource leaks (Puppeteer, video elements, proxy timeout) are the most important open items. They won't crash during a short session but will degrade over hours of use on the always-on Beelink.

**The 8 manual testing items in M5a are the biggest unknown.** The playback chain has been verified via API but never tested end-to-end in a real browser. There could be silent failures hiding behind working API responses.

**Recommendation: fix the 3 resource leaks, then do a manual testing session on desktop + phone before adding any new features.**

---

*Report generated on 2026-03-26.*
