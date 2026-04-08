# FeedDeck Progress Report — April 2, 2026

## The Numbers

| Metric | Count |
|--------|-------|
| Tasks completed | 178 |
| Tasks open | 30 |
| Needs decision / manual test | 14 |
| Completion rate | **85.6%** |

Last commit: **March 26** (7 days ago). Zero commits since March 31. No code changes yesterday or today.

---

## What's Been Built (Milestones 1-5)

**Milestone 1 (Desktop MLP):** Done. All tasks shipped.

**Milestone 2 (Swipe Feed):** ~95% done. Remaining:
- Gesture remap (swipe left/right = prev/next) not wired into all feed tabs
- Service worker video segment caching (Tier 3 optimization)
- Mobile device testing gate unsigned

**Milestone 3 (Discovery & Organization):** ~90% done. Remaining:
- Playlist crawling for deeper tag seeding
- Per-mode cookie files (social vs NSFW separation in yt-dlp adapter)
- Settings UI for PornHub username field
- Mobile device sign-off gate

**Milestone 4 (Deploy & Advanced):** Deployment infrastructure done. Open items are all future features (AI recs, browser extension, offline mode, cross-device sync). Social mode pipeline deferred.

**Milestone 5 (Design Polish):** Typography, color, spacing, accessibility all shipped. Remaining polish items are deferred cleanup passes (token consolidation, glass materials, page transitions, hero scroll affordance).

**Milestone 5a (Video Playback):** Core playback chain fixed. 8 items still need **manual browser testing** — can't be verified via automation.

---

## Scope Creep Assessment

**Verdict: Moderate scope creep, but it's the right kind.**

The backlog grew significantly since M1 shipped on March 20. The "Discovered Tasks" and "QA Failures" sections added ~25 new items, most from actual manual testing on March 26-27. These aren't feature creep — they're real bugs and UX issues found by using the product.

However, there are signs of scope expansion worth watching:

1. **Category card spotlight redesign** (P2) is a full design rework spec, not a bug fix. This is new scope disguised as a QA finding.
2. **Queue drawer redesign** is a full bottom-sheet rewrite with sort functionality. Also new scope.
3. **Reddit export import pipeline** was built by Cowork but never wired in. Sitting idle.
4. **TikTok GDPR import** shipped March 26 with 56K imports — impressive but also a new pipeline that wasn't in the original plan.

The core velocity concern: **no commits in 7 days**. The last burst was March 25-26 (19 commits across 2 days). Before that, March 21-22 (22 commits). The pattern is intense 2-day sprints followed by week-long gaps.

---

## What's Actually Blocking Progress

1. **Manual testing gate** — 8 playback tests and the mobile sign-off require a human with a phone on the same WiFi. No amount of code changes moves these forward.
2. **QA P1 bugs from March 27** — 3 bugs still open: mobile long-press broken, 5+ second load between videos, heart button not clickable on hero. These are real user-facing issues.
3. **P0 safety bug** — NSFW content flashes on SFW first load. This is the single most critical open item. Mode hydration needs to block rendering.

---

## Code Review Summary

A full code review was run against the codebase. 16 findings total.

**Critical (3):**
- Stream URL resolution failures logged only as counts, not which URLs failed — makes debugging blind
- Proxy-stream forwards upstream error status codes (502/503) directly to client without validation
- Scattered JSON.parse calls without try-catch (backlog item already exists for this)

**Warning (5):**
- TTL monitor uses exact 2-hour expiry with no buffer — race condition at boundary
- Background refill tasks have no retry backoff; permanent source failures spam logs forever
- parseInt on query params returns NaN gracefully by accident, not by design
- Bare catch blocks throughout server/index.js hide errors (counted 12+ instances)
- server/index.js is 2000+ lines — needs module extraction

**Info (8):**
- Dockerfile pulls latest yt-dlp without version pinning (non-deterministic builds)
- Health endpoint returns 200 even when yt-dlp is unavailable (Docker won't restart)
- Cookie temp file cleanup has a theoretical race condition
- HLS error recovery only retries once (no backoff)
- CORS headers inconsistent between proxy endpoints
- Unused imports in server/index.js
- No URL validation on TikTok import source
- Missing page transition animation (already in backlog)

---

## Claude Code Review Prompt

If the findings above warrant action, paste this into Claude Code:

```
Review and fix the following issues in server/index.js, prioritized by severity:

1. **CRITICAL — Proxy status forwarding:** In the /api/proxy-stream endpoint (~line 284), the upstream HTTP status is forwarded directly to the client. Add validation: only forward 200/206. For any other status, log the upstream error and return 502 to the client with a JSON error body.

2. **CRITICAL — Stream URL failure logging:** In _preResolveStreamUrls() (~line 1715), Promise.allSettled results are counted but rejected promises don't log which URL failed. Add: `if (r.status === 'rejected') logger.warn('Stream URL resolve failed', { url: batch[idx], reason: r.reason?.message })`

3. **WARNING — TTL buffer:** In the TTL monitor and _preResolveStreamUrls, add a 5-minute buffer to expiry times. Change `'+2 hours'` to `'+2 hours +5 minutes'` to prevent edge-case premature expiration.

4. **WARNING — Health endpoint:** Make /api/health return 503 (not 200) when ytdlpAdapter is unavailable, so Docker healthcheck can detect and restart.

5. **WARNING — parseInt safety:** All parseInt(req.query.*) calls should use explicit fallback: `const val = parseInt(x, 10); if (isNaN(val)) val = defaultValue;` Check lines 617, 854, 973, 1401.

6. **INFO — Dockerfile version pinning:** Pin yt-dlp to a specific release version instead of /releases/latest.

7. **INFO — Unused imports:** Remove writeFileSync and statSync from the fs import at line 4.

Don't refactor server/index.js into modules yet — that's a separate task. Focus on the targeted fixes above. Run the linter after changes.
```

---

## Recommendation

The project is in a strong position feature-wise. The risk isn't scope creep killing momentum — it's the 7-day commit gap becoming a pattern. The three highest-leverage actions right now:

1. **Fix the P0 NSFW flash bug.** This is a safety issue that undermines the entire discretion premise of the app.
2. **Do the manual mobile testing.** 8 playback tests and 3 QA P1 bugs are all waiting on someone with a phone.
3. **Fix the 3 critical code review items.** These are small, targeted changes that improve reliability.

Everything else (queue drawer redesign, category spotlight, Reddit import wiring) is nice-to-have that can wait.
