# Reliability — Snitch Wrapper + Boundary Audit (Milestone 7)

**Date:** 2026-05-16
**Status:** Approved for implementation planning
**Scope:** Server-side only. Client-side reliability is a separate future milestone.
**Replaces:** Ad-hoc try/catch + silent fallbacks scattered across `server/sources/`, `server/routes/`, `server/scoring.js`
**Decision conversation:** Brainstorm session 2026-05-16 (this file's commit message)

---

## Summary (plain English)

The app keeps shipping a class of bug where it *looks* like it's working but it's actually serving stale, empty, or wrong data — because some outside thing (yt-dlp, a website, a cookie) changed shape and the code silently fell back to a default instead of complaining. Recent examples: placeholder dogs leaking onto the homepage, dead Pornhub MP4 format IDs returning 404s for weeks, NSFW content leaking into the safe feed through a missing `mode` parameter, Instagram cookies expiring and the app pretending the response was just "empty results."

The fix: route every call that leaves the app (HTTP fetches, yt-dlp shells, cookie file reads, scraper calls) through one small wrapper that tags the outcome (`ok`, `empty`, `wrong-shape`, `auth-failed`, `rate-limited`, `timeout`, `blocked`, `unknown-error`). Failures go to a rotated log file (7 days, failures only). A running tally per boundary feeds a `/debug/boundary-stats` page so Torin can see at a glance which boundaries are eating shit today.

Then: instrument the worst offender first (yt-dlp), wrap the rest in week 2, watch logs in weeks 3–4 and fix the loudest things. A parallel pattern audit runs alongside all three weeks, sweeping the codebase for known anti-patterns (`.catch(() => [])`, hardcoded external IDs, silent `Promise.allSettled` drops).

---

## Design Decisions (Pre-Resolved)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Reliability flavor in scope | Silent degradation + external brittleness (B + D) | Torin's two highest-pain bug categories from last 3 weeks |
| Review methodology | Boundary contract + probe-driven fix (Approach 3) | Telemetry catches future failures; pattern audit catches known ones now |
| Scope of "wrap everything" | Wrap by impact, not completeness | Only external-world calls whose silent failure shows up as "this looks weird" later |
| Logging — disk | Failures only, rolled at 7 days | Keeps disk usage <1MB/week realistic; failures are the signal anyway |
| Logging — memory | 24h rolling tally per boundary | Fast debug page; reset daily; bounded memory |
| Privacy | No URLs, no response bodies, no user data in logs | Boundary name + outcome + duration only |
| Client-side scope | Out for this milestone | Different shape (cache invalidation, useEffect deps); deserves its own pass |
| Sprint structure | 3 weeks + parallel pattern sweep | Phase 1 builds infra + pilot; phase 2 wraps the rest; phase 3 is data-driven cleanup |
| Backwards compatibility | Wrapper is opt-in at each call site | No need to migrate all 70 server files in one PR; incremental adoption |

---

## Component Architecture

### Files Created

| File | Purpose |
|------|---------|
| `server/boundary/wrap.js` | Core wrapper. ~80 lines. Exports `boundary.fetch(url, opts)`, `boundary.exec(cmd, args, opts)`, `boundary.readCookie(path, opts)`, `boundary.scrape(fn, opts)`. Each returns `{ outcome, value, durationMs }`. |
| `server/boundary/outcomes.js` | The 8-tag enum + classification helpers. Maps HTTP status / Node error codes / yt-dlp stderr fragments to outcome tags. |
| `server/boundary/sink.js` | Two-layer logger: appends failures to `data/boundary-failures.log` (rolled at 7 days, ~1MB cap per file), maintains in-memory `Map<boundaryName, { ok, empty, wrong_shape, auth_failed, rate_limited, timeout, blocked, unknown_error, lastFailureAt }>` reset every 24h. |
| `server/routes/debug-boundary.js` | New route. `GET /api/debug/boundary-stats` returns the in-memory tally as JSON. `GET /api/debug/boundary-failures?n=50` tails the failure log. |
| `src/pages/DebugBoundaryPage.jsx` | Lightweight read-only page at `/debug/boundary-stats`. Table of boundaries × outcome counts, sorted by failure count descending. Refreshes every 10s. **Plain HTML/Tailwind, no router-level auth — relies on local-only deploy.** |
| `server/boundary/__tests__/wrap.test.js` | Contract tests for outcome classification, log rotation, in-memory tally reset. |
| `server/boundary/__tests__/outcomes.test.js` | Classification edge cases (yt-dlp stderr → tag, HTTP status → tag, Node error code → tag). |

### Files Modified (Sprint 1 — pilot wrap)

| File | Change |
|------|--------|
| `server/sources/youtube.js` (and any other file that shells yt-dlp) | Replace direct `execFile('yt-dlp', ...)` with `await boundary.exec('yt-dlp', args, { name: 'yt-dlp-stream-url', timeoutMs: 30000 })`. |
| `server/index.js` | Register `/api/debug/boundary-stats` route. |
| `src/App.jsx` (or wherever routes are declared) | Register `/debug/boundary-stats` page. |

### Files Modified (Sprint 2 — wrap the rest)

| File | Boundary name | Wrapped call |
|------|---------------|--------------|
| `server/sources/reddit.js` | `reddit-creator` | Outbound HTTP to reddit.com |
| `server/sources/tiktok.js` | `tiktok-creator` | Outbound scrape calls |
| `server/sources/instagram.js` | `instagram-creator` | Scrape + cookie read |
| `server/sources/twitter.js` | `twitter-creator` | Outbound HTTP |
| `server/cookies.js` | `cookie-read-{site}` | File read + parse |
| `server/routes/proxy-stream.js` | `proxy-stream` | Outbound HTTP to CDN |
| `server/routes/proxy-image.js` | `proxy-image` | Outbound HTTP to image host |
| `server/sources/pornhub.js`, `eporner.js`, `spankbang.js` | `nsfw-{site}-stream-url` | yt-dlp + scrape calls |

Total wrapped call sites Sprint 1 + Sprint 2: estimated 20–30, NOT all 70 server files.

### Files NOT Wrapped (explicit non-goals)

- SQLite reads/writes via `database.js` — we control SQLite; failures already throw loudly
- In-memory cache reads (homeStore-style) — no external dep
- Pure utility functions (`scoring.js`, `topics.js` keyword matching) — no I/O
- Test files — wrappers would distort coverage signal

---

## Outcome Taxonomy

Every wrapped call resolves to exactly one of:

| Tag | Meaning | Triggering signals |
|-----|---------|--------------------|
| `ok` | Worked, returned expected data | Status 2xx + non-empty + matches expected shape |
| `empty` | Worked but returned nothing | Status 2xx + empty body / empty array / null |
| `wrong_shape` | Got data but in unexpected format | JSON parse failure, missing required field, type mismatch |
| `auth_failed` | Cookie expired or login broke | HTTP 401, 403, "login required" body fragment, cookie file missing |
| `rate_limited` | Got throttled | HTTP 429, retry-after header, "rate limit" stderr fragment |
| `timeout` | Never responded in time | AbortController fired, Node `ETIMEDOUT`, `ECONNRESET` after configured timeout |
| `blocked` | IP/geo block | HTTP 451, 403 with geo body fragment, Cloudflare challenge page |
| `unknown_error` | Anything else | Default bucket — should investigate if this grows |

Each wrapped call MAY also return the underlying `error` object on failure, but the caller is encouraged to use the outcome tag for branching logic.

---

## Data Flow

```
[external call site]
  → boundary.fetch(url, { name: 'reddit-creator', timeoutMs: 10000 })
    → invokes underlying fetch with AbortController
    → wraps response in try/catch
    → calls outcomes.classify(response | error) → tag
    → sink.record(name, tag, durationMs)
      → if tag !== 'ok': append { ts, name, tag, durationMs } to data/boundary-failures.log
      → always: bump in-memory tally for (name, tag)
    → returns { outcome: tag, value: responseBodyOrNull, durationMs }
```

Caller pattern:

```js
const { outcome, value } = await boundary.fetch(url, { name: 'reddit-creator' });
if (outcome !== 'ok') {
  // honest failure path — log context, return empty result with metadata, do NOT silently fall back
  return { items: [], failureReason: outcome };
}
// use value
```

---

## Sprint Sequencing

### Sprint 1 — Infrastructure + Pilot (Week 1, ~3–5 days)

1. Build `server/boundary/wrap.js` + `outcomes.js` + `sink.js` with tests
2. Build `/api/debug/boundary-stats` route + JSON response
3. Build `/debug/boundary-stats` page (frontend, read-only)
4. Wrap **yt-dlp only** as pilot — the worst silent-failure offender per memory entries `debug_pornhub_dead_mp4_format_ids.md` and `debug_eporner_polite_fetch_race.md`
5. Manual verification: run the app, induce a yt-dlp failure (kill network mid-call), confirm it shows up in the log + debug page

**Exit criteria:** wrapper works end-to-end, yt-dlp calls visible in `/debug/boundary-stats`, failure events in `data/boundary-failures.log`.

### Sprint 2 — Wrap the Rest (Week 2, ~3–5 days)

1. Wrap the four social scrapers (`reddit`, `tiktok`, `instagram`, `twitter`)
2. Wrap cookie reads in `server/cookies.js`
3. Wrap the two proxy endpoints (`proxy-stream`, `proxy-image`)
4. Wrap NSFW source yt-dlp + scrape calls (`pornhub`, `eporner`, `spankbang`)
5. Update each call site's failure path: replace silent `.catch(() => [])` with `if (outcome !== 'ok') return { items: [], failureReason: outcome }`

**Exit criteria:** all 20–30 target call sites wrapped, no `.catch(() => [])` remains in wrapped files, debug page shows tally for every boundary.

### Sprint 3 — Observe and Fix (Weeks 3–4, ongoing)

1. Let the app run normally for 3–5 days collecting baseline failure rates
2. Read `/debug/boundary-stats` daily — rank boundaries by `(non-ok count) × (user-visible impact)`
3. Top 3 by rank → root-cause and fix
4. Re-baseline, repeat
5. Stop when daily non-ok event count is <5 across all boundaries for 3 consecutive days (or when remaining failures are documented expected behaviors like Instagram's known cookie expiry)

**Exit criteria:** documented baseline + at least 3 root-cause fixes shipped + remaining non-ok events have a known explanation.

### Parallel Track — Pattern Audit (runs alongside all 3 sprints)

Search the codebase for known anti-patterns and ship small fixes as they're found:

| Pattern (grep target) | Why it's bad |
|-----------------------|--------------|
| `.catch(() => [])` and `.catch(() => null)` | Silent empty on error — exactly the bug class M7 exists to kill |
| `.catch(() => ({}))` | Same as above, with object default |
| `if (!response.ok) return []` (or similar) | HTTP error → empty array, no signal |
| `Promise.allSettled` without checking `result.status === 'rejected'` count | Silent drops of failed promises |
| Hardcoded format IDs like `'1080p'`, `'720p'`, `'480p'` in `getStreamUrl` paths | External shape change → dead path (see `debug_pornhub_dead_mp4_format_ids.md`) |
| Calls missing the `mode` parameter | NSFW leakage (see `debug_trail_mode_leak.md`) |
| `?? 'fallback'` after parsing an *expected* required value | Masks "actually empty" vs "actually missing" |

Each finding → one tiny PR. Don't bundle.

---

## Success Criteria

**Quantitative (measurable):**

1. By end of Sprint 2: all target call sites (20–30) routed through wrapper. Verified by grep for direct `fetch(`/`execFile(`/`fs.readFile(` in wrapped files returning zero results outside of test files.
2. By end of Sprint 3: daily non-ok event count <5 across all boundaries for 3 consecutive days, OR a documented exception for each remaining recurring failure.
3. Disk usage of `data/boundary-failures.log*` stays under 5MB total at all times (rolling 7-day window with auto-rotation).

**Qualitative (the milestone goal):**

- For 30 consecutive days after Sprint 3 completes: no new B-class (silent degradation) or D-class (external brittleness) bug is first noticed by Torin via "this looks weird." Instead, the `/debug/boundary-stats` page surfaces the issue first.

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Wrapper adds latency to every external call | Wrapper does minimal work (timestamp + outcome classify + map update). Target overhead <1ms per call. Tested in Sprint 1. |
| In-memory tally Map grows unbounded if boundary names are dynamic | Boundary names are static string constants in code (`'reddit-creator'`, not `` `reddit-${creatorId}` ``). Enforce via lint or convention. |
| Log file fills disk if rotation breaks | Rotation tested in Sprint 1. Sink has a fail-safe: if write fails, drop the event silently rather than crash the request. |
| "Wrap everything" scope creep | Spec lists explicit non-goals (SQLite, in-memory caches, pure utils). New wrap requests during sprint must justify against the "would silent failure show up to Torin as 'this looks weird'?" test. |
| Pattern audit finds 100s of `.catch(() => [])` calls — too many small PRs | Triage first: pattern-audit findings go to BACKLOG.md Discovered Tasks. Top 10 by code-path criticality fixed in sprint. Rest scheduled later. |
| Debug page exposed to anyone who can reach the server | Acceptable risk — the deploy target is a single Beelink box on Torin's home network, not public. Document this in a header comment on `DebugBoundaryPage.jsx`. |
| Wrapper changes break existing tests | Wrapper is opt-in; old code paths keep working until call site is migrated. Sprint 1 pilot proves migration pattern; Sprint 2 follows same recipe. |

---

## Related Work (memory references)

These memory entries are the prototypical bugs M7 exists to prevent. Read them before starting Sprint 1:

- `debug_placeholder_dogs_migration_loop.md` — silent client fallback + no readiness probe
- `debug_pornhub_dead_mp4_format_ids.md` — hardcoded format IDs went dead, app kept calling them
- `debug_trail_mode_leak.md` — missing `mode` param leaked NSFW into SFW feed
- `debug_feed_watched_ids_phantom_endpoint.md` — call to non-existent endpoint hung for 30s
- `debug_cookie_poisoning_false_alarm.md` — skip set marked sources expired without probing
- `debug_eporner_polite_fetch_race.md` — read-modify-write race across awaits
- `debug_creators_sentinel_personalization.md` — refill loop corrupted sentinel
- `debug_feed_join_amplification.md` — LEFT JOIN amplification gave wrong row counts

---

## Out of Scope (explicitly NOT in M7)

- Client-side reliability (cache invalidation, useEffect deps, Zustand store consistency) → separate future milestone
- Security audit (SSRF in proxy endpoints, secret handling, CSRF) → milestone H if/when Torin requests it
- Performance work (bundle size, N+1 queries, slow renders) → separate
- Code quality / dead code removal (oversized files, duplicated logic) → separate
- Test coverage gap closure beyond what wrapping naturally introduces → separate
- Dependency / supply chain audit → separate

---

## Open Questions for User Review

None — design is complete pending Torin's read of this file.
