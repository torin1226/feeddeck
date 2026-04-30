# Daily Feed Hydration & Hardening Sprint

> Scheduled Claude Code task. Runs daily. Goal: ensure FeedDeck's content pipeline is always stocked with personalized content, progressively hardened, and never falls back to generic results.

---

## Identity & Context

You are maintaining FeedDeck, a personal media aggregator. Stack: React + Vite + Tailwind frontend, Express backend on port 3001, SQLite via `node:sqlite`, content sourced via yt-dlp (with Arc browser cookies), Puppeteer scraper, and Cobalt API. Two modes: `social` and `nsfw`. Source adapter registry with fallback chains in `server/sources/`.

**Your north star:** When Torin opens FeedDeck, every row should be full of content he'd actually want to watch. No empty shelves. No stale URLs. No generic filler.

---

## Session Protocol

### 1. Orient (always do first)

```
1. Read CLAUDE.md for current architecture state
2. Read BACKLOG.md (first 100 lines minimum) for active priorities
3. Read the most recent MORNING_SPRINT_*.md and PROGRESS_REPORT_*.md files
4. Run: git log --oneline -20 to see what other sessions pushed recently
5. Run: git diff HEAD~5 --stat to see what files changed
6. Run: npx eslint src/ server/ --format compact 2>&1 | head -60 to get current lint state
7. Check server/scripts/warm-cache.js and server/sources/ for the current pipeline state
```

If the memory vault at `../_memory/` exists, follow the memory protocol in CLAUDE.md. If it doesn't exist yet, skip without failing.

### 2. Detect External Changes

Before doing your own work, check if other sessions pushed code that impacts content hydration:

```
git log --oneline --since="24 hours ago" -- server/sources/ server/routes/feed.js server/routes/content.js server/database.js server/scripts/warm-cache.js src/stores/feedStore.js src/stores/useContentStore.js
```

For each commit found:
- Read the diff: `git show <hash> --stat` then `git show <hash> -- <relevant files>`
- Assess: Does this change affect content freshness, personalization scoring, cache population, stream URL resolution, or fallback behavior?
- If yes: review the code for correctness, edge cases, and missed optimizations. Fix issues inline or note them for your own work below.
- If the change introduced a regression (broken query, missing null check, removed fallback), fix it immediately.

### 3. Content Pipeline Health Check

Run diagnostics to understand current state. Execute these queries against the SQLite database at `data/library.db`:

```javascript
// Run via: node -e "..." or a temporary script
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('data/library.db');

// Homepage cache freshness per category
const homepage = db.prepare(`
  SELECT category, mode, COUNT(*) as total,
    SUM(CASE WHEN viewed = 0 THEN 1 ELSE 0 END) as unwatched,
    MIN(fetched_at) as oldest,
    MAX(fetched_at) as newest
  FROM homepage_cache GROUP BY category, mode
`).all();

// Feed cache depth
const feed = db.prepare(`
  SELECT mode, source_domain, COUNT(*) as total,
    SUM(CASE WHEN watched = 0 THEN 1 ELSE 0 END) as unwatched,
    SUM(CASE WHEN stream_url IS NOT NULL AND expires_at > datetime('now') THEN 1 ELSE 0 END) as valid_streams
  FROM feed_cache GROUP BY mode, source_domain
`).all();

// Source health
const sources = db.prepare('SELECT domain, mode, weight, active FROM sources ORDER BY mode, weight DESC').all();

// Expired stream URLs (ticking time bombs)
const expired = db.prepare(`
  SELECT COUNT(*) as count FROM feed_cache
  WHERE watched = 0 AND (stream_url IS NULL OR expires_at < datetime('now'))
`).get();

// Tag preference coverage
const tagPrefs = db.prepare('SELECT COUNT(*) as count FROM tag_preferences').get();
```

**Triage based on results:**

| Condition | Action |
|-----------|--------|
| Any category has < 5 unwatched videos | Trigger refill for that category immediately |
| Any source has 0 unwatched in feed_cache | Investigate why — is the adapter disabled? cookies expired? domain down? |
| > 20% of unwatched videos have expired stream URLs | Run batch stream URL re-resolution |
| Sources table has inactive adapters | Check if cooldown expired, re-enable if appropriate |
| Tag preferences < 10 | Scan existing library for common tags and note as potential personalization gap |
| Homepage cache oldest entry > 48 hours | Full cache purge and refill for that mode |
| Feed cache total unwatched < 50 for either mode | Emergency refill — run warm-cache for that mode |

### 4. Hardening Work (rotate through these daily)

Don't try to do everything every day. Pick 1-2 based on what the health check reveals and what was done in recent sessions.

> **Guiding principle (post-2026-04-30 cache audit):** *Selection logic, not
> refill cadence.* The cache is fresh — most rows refill within 6h, and the
> 30-min scheduled refresh is plenty. Future hydration work should improve
> **what** content gets selected (scoring weights, topic_sources mix, lazy-row
> drops, taste-aligned creator promotion), not **when** content gets fetched.
> If you find yourself reaching for "tighten the refill interval" or "add
> another scheduled job", stop and ask whether the deeper problem is selection.
>
> **First diagnostic each session:** `curl localhost:3001/api/rows/health`.
> `underperformingRows` (≥0.4 thumbs-down ratio over 30d, ≥5 impressions) are
> deprecation candidates — propose drops in BACKLOG 3.13. `emergentClusters`
> (tag co-occurrences not covered by any row's topic_sources) are new-row
> candidates — propose additions.

#### A. Personalization Depth
- Analyze watch history patterns: which sources/tags/creators get watched vs skipped
- Tune source weights in the `sources` table based on actual engagement data
- Ensure `subscription_backups` table is populated and the 5x boost in feed.js is working
- Add new tag-based filtering if popular tags in the library aren't reflected in feed queries
- Check that `tag_preferences` (liked/disliked) are actually filtering feed results, not just stored
- Look for opportunities to add creator-level preferences (beyond source-level weights)

#### B. Resilience & Fallback Chains
- Test each adapter in the registry: yt-dlp, scraper, cobalt, creator
- Verify fallback chains fire correctly: disable primary temporarily, confirm secondary picks up
- Check `cookie-health.js` results — if any cookies are expired, log a warning in the progress report
- Ensure warm-cache.js handles all error paths: network timeout, rate limit, malformed response, empty results
- Add retry logic where missing (exponential backoff, max 3 attempts)
- Verify the auto-disable threshold (10 consecutive failures → 2min cooldown) is appropriate
- Ensure no code path can result in serving a generic/empty feed — there should ALWAYS be a fallback

#### C. Cache Integrity
- Purge truly stale entries (fetched > 7 days ago AND watched)
- Dedup check: same URL appearing multiple times across sources
- Validate stream URLs aren't just stored but actually playable (spot-check 2-3)
- Ensure `expires_at` is being set correctly on new entries
- Check for orphaned entries (videos in cache but source no longer active)

#### D. Performance
- Profile slow queries: any SQL taking > 100ms under normal load?
- Check if indexes exist on: `feed_cache(mode, watched)`, `feed_cache(source_domain)`, `homepage_cache(category, mode, viewed)`
- Review warm-cache.js concurrency settings — is CONCURRENCY appropriate for the platform?
- Check for N+1 query patterns in feed.js or content.js routes
- Ensure prepared statements are reused, not recreated per request

#### E. Source Expansion
- Check CONTENT_QUERIES.md for sources not yet in the database
- If a new source domain appears in recent library additions, consider adding it to the sources table
- Look for creator channels that appear frequently in watch history — could be auto-subscribed
- Check if any category queries have gone stale (YouTube search queries drift over time — "viral this week" should actually return this week's content)

### 5. Code Quality Pass

After making functional changes, always:

```bash
# Lint check
npx eslint src/ server/ --fix

# If lint --fix changed files, review the changes
git diff

# Type-check / smoke test the server
node --experimental-detect-module server/index.js &
sleep 3
curl -s http://localhost:3001/api/sources/health | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d)))"
curl -s "http://localhost:3001/api/feed/next?mode=social&count=3" | node -e "process.stdin.on('data',d=>{const r=JSON.parse(d);console.log('Feed items:',r.videos?.length,'Sources:',new Set(r.videos?.map(v=>v.source)))})"
curl -s "http://localhost:3001/api/homepage?mode=social" | node -e "process.stdin.on('data',d=>{const r=JSON.parse(d);console.log('Categories:',Object.keys(r.categories||{}).length)})"
kill %1 2>/dev/null

# If you modified any source adapter or route, run tests if they exist
npx vitest run --reporter=verbose 2>&1 | tail -30
```

**Comment standards for this task:**
- Add `// HYDRATION:` prefix to any comment related to content freshness logic
- Add `// FALLBACK:` prefix to any fallback chain comment
- Add `// TODO(hydration):` for things you'd like to address but ran out of scope
- Don't over-comment obvious code. Comments explain WHY, not WHAT.

### 6. Commit Protocol

Only commit after ALL of these pass:

```bash
# 1. Lint clean (warnings OK, errors not)
npx eslint src/ server/ 2>&1 | grep -c "error" # should be 0

# 2. Build succeeds
npm run build 2>&1 | tail -5

# 3. Server starts without crash
timeout 5 node --experimental-detect-module server/index.js 2>&1 | tail -10

# 4. No unintended file changes
git diff --stat
```

Commit message format:
```
hydration: <what you did in ≤50 chars>

<1-3 lines explaining the WHY and any tradeoffs>

Diagnostics: <key numbers from health check, e.g. "feed_cache: 234 unwatched, 3 expired URLs resolved">
```

Stage only the files you intentionally changed. Never `git add .` blindly.

### 7. Progress Report

After committing, append a brief entry to the most recent `PROGRESS_REPORT_*.md` or create one for today:

```markdown
### Daily Hydration Run — [timestamp]
**Cache State:** [homepage categories filled / feed_cache unwatched count per mode]
**Actions Taken:** [1-3 bullet points]
**External Changes Reviewed:** [commits reviewed, any issues found]
**Hardening Focus:** [which section A-E you worked on]
**Next Session Should:** [what to prioritize tomorrow]
```

### 8. Emergency Protocols

If during your run you discover:

- **All adapters failing:** Don't panic. Check network connectivity first. Then check if yt-dlp needs updating (`pip install -U yt-dlp`). Log the failure state but don't commit broken fixes.
- **Database corrupted:** Do NOT attempt repair. Log the issue in PROGRESS_REPORT and stop. Torin will handle backup restoration.
- **Git index corrupted:** Run `git checkout HEAD -- .` to restore index from HEAD. Do NOT commit in a corrupted state.
- **Rate limited by a source:** Increase that source's cooldown timer, reduce fetch frequency, move on to other sources. Don't hammer a rate limit.

---

## What "Done" Looks Like

A successful daily run means:
1. Both modes (social + nsfw) have ≥ 50 unwatched videos in feed_cache
2. Every homepage category has ≥ 5 unwatched videos
3. < 10% of unwatched videos have expired stream URLs
4. All source adapters are either healthy or have documented reasons for being disabled
5. Zero ESLint errors (warnings acceptable)
6. Build passes
7. Changes committed with descriptive message
8. Progress report updated
