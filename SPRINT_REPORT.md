# Morning Sprint Report - 2026-04-06

## Backlog Sync
Local BACKLOG.md confirmed in sync with GitHub master (git fetch showed no diff).

## Project Status Overview
Last commit: `7cf1063` on 2026-03-26 (11 days ago). No active development since.

**Milestones 1-3:** Essentially complete. All core features shipped.
**Milestone 4:** Deployment done (Beelink EQ12 + Docker). Social pipeline and advanced features (AI recs, browser extension, offline) still open.
**Milestone 5a (Playback):** Core fixes done, but 8 items marked `[?]` need manual browser testing. Automation can't verify actual video playback.
**Milestone 5 (Design Polish):** ~80% done. Key open items: page transitions, hero scroll affordance, FeaturedSection scroll zone tuning, logo SVG.

## Blockers & Decisions Needed
No `[~]` in-progress or `[!]` blocked items. Two items need user decision:
- `[?]` Mobile device testing (2.7) - ready for manual test
- `[?]` Color token consolidation + glass material tokens (5.4) - deferred to cleanup pass

## QA Failures Still Open (from 2026-03-26 testing)

**P0:**
- NSFW content flashes on SFW first load (safety issue)

**P1:**
- Mobile feed: long-press source control sheet broken
- Mobile feed: 5+ second load between videos
- Heart button not clickable on hero

**P2 (9 items):** Duplicate content in subscriptions/up-next, ForYou/Remix same content, play vs theatre button confusion, homepage search broken, feed has no back nav, category row redesign, See All buttons dead, category click needs video page, NSFW placeholders on mode switch, mode toggle redesign, mobile feed container resizing, social feed YouTube-only.

## Code Review & Fixes Applied

### Issues Found
| Issue | Severity | Status |
|-------|----------|--------|
| Puppeteer browser leak on scrape failure | HIGH | **Fixed** - added disconnected state check + logging |
| Silent JSON parse failures (ytdlp.js) | MEDIUM | **Fixed** - added logger.warn for malformed lines |
| Silent JSON parse failures (index.js seed) | MEDIUM | **Fixed** - added logger.warn |
| Per-mode cookie files not implemented | MEDIUM | Backlog (3.4.1) |
| Per-chunk proxy-stream timeout missing | MEDIUM | Backlog |
| No rate limiting on proxy endpoints | MEDIUM | Not in backlog - should add |
| 16 react-hooks/exhaustive-deps ESLint warnings | LOW | Backlog |
| Hover preview 54 video element leak | MEDIUM | Backlog |

### Files Changed
- `server/sources/scraper.js` - Added error logging on scrape failure, browser health check (`!this.browser?.connected`)
- `server/sources/ytdlp.js` - Added logger import, replaced silent catches with `logger.warn` for malformed JSON in search and streamSearch
- `server/index.js` - Added `logger.warn` for malformed JSON in seed import pipeline

## Recommendation for Next Session
**Highest priority:** Fix the P0 NSFW flash on SFW first load. This is a safety bug. The modeStore needs to hydrate synchronously before any render.

**Second priority:** The gesture remap (2.2) is the biggest incomplete feature item - unified swipe left/right = prev/next across all feed tabs.

**Third priority:** The P1 QA failures (mobile feed performance, broken long-press, heart button).
