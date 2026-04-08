# Stale-While-Revalidate Homepage Cache

**Date:** 2026-04-06
**Status:** Approved
**Problem:** Homepage cache uses a 24-hour TTL as a visibility gate — expired rows are hidden from the API response. For a user who opens the app once every 1-2 weeks, this means an empty homepage every time, with async refill firing in the background but nothing to show while it works.

**Solution:** Stale-while-revalidate model. Never hide cached content. Show stale content immediately, refresh in background, animate fresh content into place card-by-card.

---

## 1. Backend — Cache Query & Staleness Model

### Current behavior
```sql
SELECT * FROM homepage_cache
WHERE category_key = ? AND expires_at > datetime('now')
ORDER BY fetched_at DESC LIMIT 20
```
Expired rows are invisible. Empty categories return `videos: []`.

### New behavior
```sql
SELECT *, (expires_at < datetime('now')) AS stale
FROM homepage_cache
WHERE category_key = ?
ORDER BY stale ASC, fetched_at DESC
LIMIT 20
```

- Fresh content sorts first, stale content fills in behind it.
- Nothing is ever hidden from the response.
- TTL remains 24 hours but controls **sort priority and refill triggers**, not visibility.
- `needsRefill` is computed by counting only *fresh* rows (where `stale = 0`). The main query returns all rows, but the refill trigger counts fresh ones separately:
  ```sql
  SELECT COUNT(*) FROM homepage_cache
  WHERE category_key = ? AND expires_at > datetime('now')
  ```
  If this count is < 8, refill is triggered for that category.
- The `/api/homepage/viewed` endpoint uses the same fresh-only count for its refill threshold check.
- Each video in the API response JSON includes its `stale` flag (boolean) so the frontend can identify which cards to animate on refresh.

### Database index
Add a composite index for the new query pattern:
```sql
CREATE INDEX IF NOT EXISTS idx_homepage_cache_category_freshness
ON homepage_cache (category_key, expires_at, fetched_at DESC);
```

### Cleanup
- Rows older than 30 days are purged (by `fetched_at`, not `expires_at`).
- Runs after each `refresh-all` call and once daily on the always-on server.
- 30-day window is a constant `CACHE_MAX_AGE_DAYS` in `server/index.js` — tunable if needed.

---

## 2. Live Refresh Pipeline (SSE)

### New endpoint: `GET /api/homepage/stream?mode=social|nsfw`

Server-Sent Events stream that pushes category updates as refills complete.

**Event types:**
| Event | Payload | Meaning |
|---|---|---|
| `category-update` | `{ "key": "nsfw_trending", "videos": [...], "stale": false }` | A category has been refreshed with fresh content |
| `done` | `{ "refreshed": 38, "failed": 6, "duration_ms": 45000 }` | All categories processed |
| `error` | `{ "message": "..." }` | Global error (not per-category) |

**Behavior:**
- On connection, kicks off parallel refills for all categories with stale or insufficient content.
- Concurrency limit: `HOMEPAGE_REFILL_CONCURRENCY` constant, defaults to 4. Shared across SSE, hard-refresh, and refresh-all — a single semaphore prevents overloading adapters.
- As each category completes, emits `category-update` with the fresh video list.
- Emits `done` when all categories finish or fail.
- Connection closes on `done`, client disconnect, or 5-minute absolute timeout.

**Concurrency model:**
- A global `refillSemaphore` (counting semaphore, limit = `HOMEPAGE_REFILL_CONCURRENCY`) governs all refill operations.
- Per-category lock map (`refillInProgress: Map<categoryKey, Promise>`) prevents duplicate refills for the same category. If a hard-refresh requests a category that SSE is already refilling, it awaits the existing promise instead of launching a duplicate.
- Multiple SSE connections (e.g., two browser tabs) share the same semaphore and per-category locks — no wasted work.

### Frontend load flow
1. `GET /api/homepage?mode=X` → returns immediately with stale+fresh content.
2. Opens SSE connection to `/api/homepage/stream?mode=X`.
3. As `category-update` events arrive, stale cards in that row are replaced with fresh ones (animated — see Section 5).
4. On `done` event, SSE connection closes.
5. On navigation away or component unmount, SSE connection closes.

---

## 3. Hard Refresh

### Trigger
- "Hard Refresh" button in the failure toast.
- Small refresh icon in the homepage header (always visible).

### New endpoint: `POST /api/homepage/hard-refresh?mode=social|nsfw`

Returns `202 Accepted` immediately. Results stream through the SSE connection (if open) or can be retrieved via a follow-up `GET /api/homepage`.

**Response (immediate):**
```json
{ "status": "accepted", "categories": 6 }
```

**SFW mode — single wave:**
- Picks top 6 social categories (by `MAX(fetched_at)` from `homepage_cache` for that category, fallback: first 6 by `sort_order`).
- Fires 6 yt-dlp searches in parallel, each requesting 10 results.
- Typical completion: 5-10 seconds.

**NSFW mode — two waves (launched simultaneously):**

| Wave | Adapter | Categories | Typical time |
|---|---|---|---|
| Wave 1 | yt-dlp | PornHub, XVideos, SpankBang categories | ~5 seconds |
| Wave 2 | Puppeteer scraper | RedGifs, FikFap categories | ~10-15 seconds |

Both waves start at the same time. Wave 1 results arrive first because yt-dlp is faster. Wave 2 results arrive shortly after.

**SSE integration:** Results flow through the open SSE stream as `category-update` events — the frontend treats them identically to normal refill updates. If no SSE stream is open (e.g., hard refresh triggered from a toast after SSE died), the endpoint opens a new one automatically by redirecting the frontend to re-connect SSE after the 202.

**Concurrency:** Hard refresh shares the global `refillSemaphore` and per-category lock map. If SSE is already refilling a category that hard refresh wants, it piggybacks on the existing refill.

**Puppeteer optimization:** Reuses the warm browser instance from `_getBrowser()` — no cold launch overhead for wave 2.

---

## 4. Scheduled Cache Warming

### Environment switch
Controlled by `FEEDDECK_ENV` environment variable:
- `FEEDDECK_ENV=server` → node-cron cache warming starts on boot.
- Unset or any other value → no automatic cache warming (Claude Code scheduled task handles it).

```js
if (process.env.FEEDDECK_ENV === 'server') {
  startCacheWarmingCron(); // every 6 hours
}
```

### New endpoint: `POST /api/homepage/refresh-all` (new — does not exist yet)
- Iterates all 44 categories, refills any with < 8 fresh (non-expired) videos.
- Uses the shared `refillSemaphore` and per-category lock map (see Section 2).
- Mutex lock: if a refresh-all is already running, returns `409 Conflict`.
- After refill completes, purges rows with `fetched_at < datetime('now', '-30 days')`.
- Response: `{ "refreshed": 38, "skipped": 0, "failed": 6, "duration_ms": 45000 }`

### Local dev (current Windows setup)
- Claude Code scheduled remote agent runs daily at 6:00 AM.
- Agent prompt: `curl -X POST http://localhost:3001/api/homepage/refresh-all`
- If server isn't running, agent logs failure and exits.

### Always-on server (Docker on i7)
- `node-cron` job inside server process, every 6 hours.
- Calls `refreshAll()` directly — no HTTP round-trip.
- Logs: `"Cache warming: 38/44 categories refreshed, 6 failed"`.

---

## 5. Frontend Card Refresh Animation

### Per-card crossfade
When a `category-update` SSE event arrives for a row:
1. Identify stale cards in that row (each video object has a `stale: true` flag from the initial API response).
2. Replace stale cards one at a time, left to right, staggered **150ms apart**. Fresh cards are left untouched.
3. Each card: thumbnail fades out (150ms, opacity 1→0), new thumbnail fades in (150ms, opacity 0→1) with subtle scale-up (0.95→1.0).
4. Total per-card: **300ms**. Actual row animation time depends on how many cards are stale (e.g., 3 stale cards in a row of 8 = ~0.6 seconds).

### What animates
- **Thumbnail image:** crossfade.
- **Title text:** instant swap (text transitions look janky).
- **Duration badge:** instant swap.

### Viewport gating
- **Intersection Observer** tracks which category rows are visible.
- Visible rows: animated crossfade.
- Off-screen rows: updated instantly, no animation (no wasted GPU work).

### Loading indicator
- While SSE is active and at least one category is still pending, show a subtle pulsing dot in the header.
- Disappears on `done` event.
- If the 60-second toast fires (Section 6), the loading indicator also disappears — the toast replaces it as the status feedback mechanism.

---

## 6. Failure Handling & Toast

### 60-second timeout toast
- Timer starts when SSE connection opens.
- If zero `category-update` events arrive within 60 seconds, show toast and hide the loading indicator.
- If the first `category-update` arrives before 60 seconds, the timer is cancelled — no toast.
- **Text:** "Couldn't refresh feeds right now"
- **Dismissable** via X button.
- Contains **"Hard Refresh"** button.
- **Auto-dismisses** if a `category-update` event arrives after the toast appeared.

### Partial failure
- Some categories refresh, others don't → **no toast**. Failed categories keep showing stale content. User has something to watch in every row.

### Total failure (hard refresh also fails)
- Toast updates to: **"Refresh failed — check your connection"**
- Hard Refresh button stays available for retry.
- Stale content remains visible — the app is **never blank**.

### SSE connection errors
- If SSE connection drops, frontend falls back silently to stale content.
- No toast unless the 60-second timer fires.

---

## Key Files (Expected Changes)

| File | Change |
|---|---|
| `server/index.js` | Remove expiry filter from homepage query, add SSE endpoint (new), add hard-refresh endpoint (new), add refresh-all endpoint (new), add node-cron warming, update `/api/homepage/viewed` refill check, add refill semaphore + per-category lock map |
| `server/database.js` | Add 30-day cleanup query, add composite index `idx_homepage_cache_category_freshness`, update homepage_cache query |
| `src/components/home/CategoryRow.jsx` | Card crossfade animation, Intersection Observer |
| `src/pages/HomePage.jsx` | SSE connection management, failure toast, hard refresh button, loading indicator |
| `src/stores/homeStore.js` | SSE event handling, stale tracking state |
| `Dockerfile` / `docker-compose.yml` | Add `FEEDDECK_ENV=server` |

---

## Non-Goals
- Changing the feed_cache system (separate from homepage_cache, different UX).
- Changing adapter internals (yt-dlp, scraper, cobalt).
- Adding user-facing staleness indicators per card (stale flag is internal, not shown to user).
- Changing the 24-hour TTL value (it's advisory now, not a gate).
