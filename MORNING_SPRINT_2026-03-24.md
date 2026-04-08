# Morning Sprint Report — 2026-03-24 (Tuesday)

## Backlog Sync

Synced from GitHub via Chrome. Latest commit: `62fedc0` (Mar 22) — "Fix YouTube seed: no username required (uses cookie auth)". Two commits since last sprint: the seed feature (`daa991f`) and the YouTube auth fix.

**Backlog is 821 lines.** All milestones 1-5 are complete. No `[~]` in-progress items.

## Blocker

**[!] Content spillage between NSFW and SFW modes** (backlog line 719)
- Combined `cookies.txt` sends PornHub cookies on YouTube requests and vice versa
- Tag preferences from both modes leak into each other's discovery queries
- **Needs:** (1) per-mode cookie files (`cookies-nsfw.txt` / `cookies-social.txt`), (2) `mode` column on `tag_preferences` table, (3) mode-aware queries in `refillCategory()` and `_refillFeedCacheImpl()`
- **Status:** Still blocked. No work done yet. This is the #1 priority for Claude Code.

## Code Review: Recent Changes (62fedc0, daa991f)

### 3.3.1 Seed Recommendations — server/index.js (+232 lines)

**Good:** SSE progress, re-seed guard, `execFile` security, smart tag frequency threshold.

**Issues:**

1. **No try/finally on SSE response.** If an unhandled throw occurs between `res.writeHead(200)` and `res.end()`, the HTTP connection hangs forever. The `onerror` on the client only fires on network drop, not server-side logic errors. Wrap the main body in try/finally.

2. **Sequential metadata extraction.** 200 videos x 30s timeout = up to 100 minutes worst case. Consider 3-5 concurrent `execFile` calls with a semaphore. The SSE updates make it tolerable, but parallel would be 3-5x faster.

3. **No platform whitelist.** `req.query.platform` flows into URL construction and DB keys without validation. Add: `if (!['pornhub', 'youtube', 'tiktok'].includes(platform)) return res.status(400)...`

4. **Username flash on platform switch.** `seedPlatform` in the `useEffect` dep array means switching platforms shows the old username briefly. Clear `setSeedUsername('')` before the fetch.

### Existing Open Bugs (from Discovered Tasks)

| Priority | Task | Can Cowork fix? |
|----------|------|-----------------|
| **HIGH** | Content spillage blocker | No — Claude Code task |
| **HIGH** | Puppeteer browser leak on scrape failure | Partially — `_scrapeVideoList` has `finally { page.close() }` but `_getBrowser()` success + `_newPage()` failure orphans browser. Edge case. |
| **MED** | Hover preview 54 DOM `<video>` elements | `useHoverPreview` singleton pattern looks correct. Likely components not calling `cancelPreview` on unmount. Check `CategoryRow`/`VideoCard` for cleanup `useEffect`. |
| **MED** | SIGTERM missing interval cleanup | Quick fix — store interval IDs, `clearInterval()` in SIGTERM handler |
| **MED** | Proxy-stream stalled upstream | Per-chunk timeout needed (~line 240) |
| **LOW** | AbortController for `_warmStreamUrls` | Fire-and-forget, low real impact |
| **LOW** | Malformed JSON parse failures silent | Add logging |
| **LOW** | 16 react-hooks/exhaustive-deps warnings | Per-hook manual review needed |

### Quick Wins Cowork Can Do Right Now

None of the open bugs are safe for Cowork to fix autonomously without the dev server running for verification. Flagging for Claude Code.

## `[?]` Needs-Decision Items (9 total)

- 1 mobile testing item (3.11) — needs real devices
- 8 playback verification items (5a.2) — these read like QA tasks, not decisions. Recommend converting to `[ ]` and testing.
- 5 design polish items (5.4, 5.5, 5.6) — deferred to cleanup pass, fine to leave

## Recommendations for Today

1. **Claude Code: Fix content spillage blocker (3.4.1).** Split cookies by mode, add `mode` column to `tag_preferences`, filter all discovery queries by mode. Highest leverage work remaining.

2. **Claude Code: SIGTERM interval cleanup.** 5-minute quick win.

3. **Claude Code: Add try/finally to SSE seed endpoint + platform whitelist.** 10-minute hardening pass.

4. **Torin: Convert playback verification `[?]` items to `[ ]`** and run through them manually. These are blocking confidence in playback reliability.

## Process Notes

- **Backlog hygiene:** The Completed section is ~250 lines of history. Consider archiving to `CHANGELOG.md` to keep the backlog scannable.
- **GitHub raw content fetching via Chrome is unreliable** (blocked by cookie/CORS policies on `raw.githubusercontent.com`). Future sprints should use `gh api` CLI or `git pull` instead.
- **Project velocity is impressive:** 5 milestones shipped in 5 days (Mar 19-23). The app is feature-complete for MLP minus the mode-separation bug and manual testing.
