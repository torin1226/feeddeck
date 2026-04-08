# Stale-While-Revalidate Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the homepage always show content (even stale), refresh in background via SSE, and animate fresh content into place — so the app never shows an empty page.

**Architecture:** Remove the expiry filter from homepage queries (stale-while-revalidate). Add SSE endpoint for live category updates. Add hard-refresh and refresh-all endpoints. Frontend animates card crossfades as fresh data arrives. Scheduled cache warming via Claude Code (dev) and node-cron (server).

**Tech Stack:** Node.js/Express (backend), SQLite (database), Server-Sent Events (live updates), React/Zustand (frontend), Intersection Observer (viewport-gated animation), node-cron (server scheduling)

**Spec:** `docs/superpowers/specs/2026-04-06-stale-while-revalidate-cache-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `server/refill.js` | **Create** | Refill semaphore, per-category lock map, `refillCategory()` (extracted from index.js), `refreshAll()` |
| `server/index.js` | **Modify** | Update homepage query, add 3 new endpoints (SSE stream, hard-refresh, refresh-all), update `/viewed` check, wire node-cron |
| `server/database.js` | **Modify** | Add composite index, add 30-day cleanup query |
| `src/hooks/useHomepageSSE.js` | **Create** | SSE connection management, event parsing, timeout/toast state |
| `src/components/home/CategoryRow.jsx` | **Modify** | Card crossfade animation when stale cards are replaced |
| `src/components/home/RefreshToast.jsx` | **Create** | Dismissable failure toast with Hard Refresh button |
| `src/pages/HomePage.jsx` | **Modify** | Wire SSE hook, loading indicator, refresh button in header |
| `src/stores/homeStore.js` | **Modify** | Add per-video `stale` flag, SSE category update merging |
| `Dockerfile` | **Modify** | Add `FEEDDECK_ENV=server` |
| `docker-compose.yml` | **Modify** | Add `FEEDDECK_ENV=server` env var |
| `package.json` | **Modify** | Add `node-cron` dependency |

---

## Task 1: Database — Composite Index & Cleanup Query

**Files:**
- Modify: `server/database.js:237-238` (existing indexes section)

- [ ] **Step 1: Add the composite index for the new query pattern**

In `server/database.js`, after line 238 (the existing `idx_homepage_cache_expires` index), add:

```js
db.exec(`CREATE INDEX IF NOT EXISTS idx_homepage_cache_category_freshness
  ON homepage_cache (category_key, expires_at, fetched_at DESC)`);
```

- [ ] **Step 2: Add a 30-day cleanup function**

Export a new function from `server/database.js` after the `initDatabase` function:

```js
export function purgeOldHomepageCache() {
  const CACHE_MAX_AGE_DAYS = 30;
  const result = db.prepare(
    `DELETE FROM homepage_cache WHERE fetched_at < datetime('now', '-' || ? || ' days')`
  ).run(CACHE_MAX_AGE_DAYS);
  return result.changes;
}
```

- [ ] **Step 3: Verify the server starts without errors**

Run: `cd feeddeck && node -e "const { initDatabase } = require('./server/database.js'); initDatabase(); console.log('OK')"`
Expected: `OK` with no errors.

- [ ] **Step 4: Commit**

```bash
git add server/database.js
git commit -m "feat(db): add composite index and 30-day cache purge for stale-while-revalidate"
```

---

## Task 2: Backend — Extract Refill Logic to `server/refill.js`

**Files:**
- Create: `server/refill.js`
- Modify: `server/index.js:1357-1412` (move `refillCategory` out)

The current `refillCategory()` at index.js:1357 is embedded in a 2000+ line file. Extract it to a focused module that also houses the semaphore and lock map.

- [ ] **Step 1: Create `server/refill.js` with semaphore and lock map**

```js
import { db } from './database.js';
import { registry, ytdlpAdapter, scraperAdapter } from './sources/index.js';
import { logger } from './logger.js';

const HOMEPAGE_REFILL_CONCURRENCY = 4;

// Counting semaphore — limits total concurrent refill operations
let _active = 0;
const _queue = [];

function acquireSemaphore() {
  if (_active < HOMEPAGE_REFILL_CONCURRENCY) {
    _active++;
    return Promise.resolve();
  }
  return new Promise(resolve => _queue.push(resolve));
}

function releaseSemaphore() {
  if (_queue.length > 0) {
    const next = _queue.shift();
    next();
  } else {
    _active--;
  }
}

// Per-category lock map — prevents duplicate refills for the same category
const _refillInProgress = new Map();

/**
 * Refill a single category. If already in progress, piggybacks on the existing promise.
 * Returns the array of inserted videos.
 */
export async function refillCategory(categoryKey) {
  // Deduplicate: if this category is already being refilled, await it
  if (_refillInProgress.has(categoryKey)) {
    return _refillInProgress.get(categoryKey);
  }

  const promise = _refillCategoryImpl(categoryKey);
  _refillInProgress.set(categoryKey, promise);
  try {
    return await promise;
  } finally {
    _refillInProgress.delete(categoryKey);
  }
}
```

- [ ] **Step 2: Move the refill implementation into `_refillCategoryImpl`**

Copy the body of the current `refillCategory()` from `server/index.js:1357-1412` into `_refillCategoryImpl` in `server/refill.js`, wrapping it with semaphore acquire/release:

```js
async function _refillCategoryImpl(categoryKey) {
  await acquireSemaphore();
  try {
    const cat = db.prepare('SELECT * FROM categories WHERE key = ?').get(categoryKey);
    if (!cat) {
      logger.warn(`Category not found: ${categoryKey}`);
      return [];
    }

    const query = cat.query;
    let videos = [];

    try {
      // Route to correct adapter based on category
      if (cat.mode === 'nsfw' && query.startsWith('http')) {
        const url = new URL(query);
        const domain = url.hostname.replace('www.', '');
        videos = await registry.search(query, { site: domain, limit: 12 });
      } else {
        videos = await registry.search(query, { adapter: 'yt-dlp', limit: 12 });
      }
    } catch (err) {
      logger.error(`Refill search failed for ${categoryKey}`, { error: err.message });
      return [];
    }

    if (!videos || videos.length === 0) return [];

    const insert = db.prepare(`
      INSERT OR IGNORE INTO homepage_cache
      (id, category_key, url, title, thumbnail, duration, source, uploader, view_count, tags, fetched_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now', '+24 hours'))
    `);

    let count = 0;
    for (const v of videos) {
      if (!v.id || !v.url) continue;
      try {
        insert.run(v.id, categoryKey, v.url, v.title || '', v.thumbnail || '',
          v.duration || 0, v.source || '', v.uploader || '', v.view_count || 0,
          JSON.stringify(v.tags || []));
        count++;
      } catch (e) { /* duplicate, skip */ }
    }

    logger.info(`Refilled ${categoryKey}: ${count} new videos`);
    return videos.slice(0, count);
  } finally {
    releaseSemaphore();
  }
}
```

Note: Check the exact body at `server/index.js:1357-1412` when implementing — the code above is the pattern, but match the actual logic (e.g., tag preference scoring at lines 1361-1374 if present).

- [ ] **Step 3: Add `refreshAll()` function**

```js
import { purgeOldHomepageCache } from './database.js';

let _refreshAllRunning = false;

/**
 * Refresh all 44 categories. Returns summary stats.
 * Rejects with 409 if already running.
 */
export async function refreshAll() {
  if (_refreshAllRunning) {
    const err = new Error('Refresh already in progress');
    err.status = 409;
    throw err;
  }

  _refreshAllRunning = true;
  const start = Date.now();

  try {
    const categories = db.prepare('SELECT key FROM categories').all();
    let refreshed = 0, failed = 0, skipped = 0;

    // Process in batches respecting the semaphore
    const promises = categories.map(async (cat) => {
      // Check if category already has enough fresh videos
      const freshCount = db.prepare(
        `SELECT COUNT(*) as n FROM homepage_cache
         WHERE category_key = ? AND expires_at > datetime('now')`
      ).get(cat.key).n;

      if (freshCount >= 8) {
        skipped++;
        return;
      }

      try {
        await refillCategory(cat.key);
        refreshed++;
      } catch (err) {
        logger.error(`refresh-all: failed ${cat.key}`, { error: err.message });
        failed++;
      }
    });

    await Promise.all(promises);

    // Purge old entries
    const purged = purgeOldHomepageCache();
    if (purged > 0) logger.info(`Purged ${purged} old homepage_cache rows`);

    const duration_ms = Date.now() - start;
    logger.info(`Cache warming: ${refreshed}/${categories.length} categories refreshed, ${failed} failed`, { duration_ms });

    return { refreshed, skipped, failed, duration_ms };
  } finally {
    _refreshAllRunning = false;
  }
}
```

- [ ] **Step 4: Add `getFreshCount()` helper export**

```js
/**
 * Count fresh (non-expired) videos for a category.
 */
export function getFreshCount(categoryKey) {
  return db.prepare(
    `SELECT COUNT(*) as n FROM homepage_cache
     WHERE category_key = ? AND expires_at > datetime('now')`
  ).get(categoryKey).n;
}
```

- [ ] **Step 5: Update `server/index.js` to import from `server/refill.js`**

Replace the inline `refillCategory()` at lines 1357-1412 with an import:

```js
import { refillCategory, refreshAll, getFreshCount } from './refill.js';
```

Delete the old `refillCategory` function body from index.js. Update all call sites (lines 1294-1306, 1335-1340, and in `startScheduledTrendingRefresh`) to use the imported version.

- [ ] **Step 6: Verify server starts and existing refill logic still works**

Run: `npm run dev` — confirm server starts, hit `GET /api/homepage?mode=social`, check logs for refill activity.

- [ ] **Step 7: Commit**

```bash
git add server/refill.js server/index.js
git commit -m "refactor: extract refill logic to server/refill.js with semaphore and lock map"
```

---

## Task 3: Backend — Stale-While-Revalidate Homepage Query

**Files:**
- Modify: `server/index.js:1264-1313` (GET /api/homepage handler)
- Modify: `server/index.js:1320-1348` (POST /api/homepage/viewed handler)

- [ ] **Step 1: Update the homepage query to include stale content**

In the GET `/api/homepage` handler (around line 1269-1281), change the SQL query from:

```js
// OLD: filters out expired rows
`SELECT * FROM homepage_cache WHERE category_key = ? AND expires_at > datetime('now') ORDER BY fetched_at DESC LIMIT 20`
```

To:

```js
// NEW: includes all rows, adds stale flag, sorts fresh-first
`SELECT *, (expires_at < datetime('now')) AS stale FROM homepage_cache WHERE category_key = ? ORDER BY stale ASC, fetched_at DESC LIMIT 20`
```

- [ ] **Step 2: Include stale flag in API response**

In the `mapVideo()` or video-mapping logic within the handler, ensure the `stale` field is passed through to the response JSON. Add `stale: !!row.stale` to each video object.

- [ ] **Step 3: Update `needsRefill` to count fresh-only**

Change the refill trigger logic (around lines 1294-1306) to use a fresh-only count:

```js
// Count only fresh videos for refill decision
const freshCount = getFreshCount(cat.key);
if (freshCount < 8) {
  categoriesToRefill.push(cat.key);
}
```

The `needsRefill` flag in the response should be based on whether any category has < 8 fresh videos.

- [ ] **Step 4: Update the `/api/homepage/viewed` refill check**

In the POST `/api/homepage/viewed` handler (around lines 1330-1340), update the refill threshold check to use `getFreshCount()`:

```js
const freshCount = getFreshCount(categoryKey);
if (freshCount < 8) {
  refillCategory(categoryKey).catch(err => logger.error('Viewed refill failed', { error: err.message }));
}
```

- [ ] **Step 5: Test the stale-while-revalidate behavior**

Run: `curl -s http://localhost:3001/api/homepage?mode=social | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); const j=JSON.parse(d); j.categories.forEach(c => { const stale=c.videos.filter(v=>v.stale).length; const fresh=c.videos.filter(v=>!v.stale).length; console.log(c.key, 'fresh:', fresh, 'stale:', stale) })"`

Expected: Categories now show both stale and fresh videos. Previously empty categories should now have stale content visible.

- [ ] **Step 6: Commit**

```bash
git add server/index.js
git commit -m "feat: stale-while-revalidate homepage query — never hide expired content"
```

---

## Task 4: Backend — SSE Stream Endpoint

**Files:**
- Modify: `server/index.js` (add new route after the existing homepage routes)

Reference the existing SSE pattern at `server/index.js:628-634`.

- [ ] **Step 1: Add `GET /api/homepage/stream` SSE endpoint**

Add after the existing homepage routes (after line ~1348):

```js
app.get('/api/homepage/stream', async (req, res) => {
  const mode = req.query.mode || 'social';

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  // 5-minute absolute timeout
  const timeout = setTimeout(() => {
    res.write(`event: done\ndata: ${JSON.stringify({ refreshed: 0, failed: 0, duration_ms: 300000, timeout: true })}\n\n`);
    res.end();
  }, 5 * 60_000);

  // Clean up on client disconnect
  req.on('close', () => {
    clearTimeout(timeout);
  });

  const start = Date.now();
  const categories = db.prepare('SELECT key FROM categories WHERE mode = ?').all(mode);
  let refreshed = 0, failed = 0;

  // Find categories needing refill (< 8 fresh videos)
  const toRefill = categories.filter(cat => getFreshCount(cat.key) < 8);

  if (toRefill.length === 0) {
    res.write(`event: done\ndata: ${JSON.stringify({ refreshed: 0, failed: 0, duration_ms: 0 })}\n\n`);
    clearTimeout(timeout);
    res.end();
    return;
  }

  // Refill in parallel (semaphore handles concurrency)
  const promises = toRefill.map(async (cat) => {
    try {
      await refillCategory(cat.key);
      refreshed++;

      // Fetch the updated video list for this category
      const videos = db.prepare(
        `SELECT *, (expires_at < datetime('now')) AS stale FROM homepage_cache
         WHERE category_key = ? ORDER BY stale ASC, fetched_at DESC LIMIT 20`
      ).all(cat.key);

      const mapped = videos.map(v => ({
        id: v.id, url: v.url, title: v.title, thumbnail: v.thumbnail,
        duration: v.duration, source: v.source, uploader: v.uploader,
        view_count: v.view_count, tags: JSON.parse(v.tags || '[]'),
        stale: !!v.stale,
      }));

      res.write(`event: category-update\ndata: ${JSON.stringify({ key: cat.key, videos: mapped })}\n\n`);
    } catch (err) {
      failed++;
      logger.error(`SSE refill failed for ${cat.key}`, { error: err.message });
    }
  });

  await Promise.all(promises);

  const duration_ms = Date.now() - start;
  res.write(`event: done\ndata: ${JSON.stringify({ refreshed, failed, duration_ms })}\n\n`);
  clearTimeout(timeout);
  res.end();
});
```

- [ ] **Step 2: Test SSE stream manually**

Run: `curl -N http://localhost:3001/api/homepage/stream?mode=social`

Expected: See `event: category-update` lines arriving one at a time as categories refill, followed by `event: done`.

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "feat: SSE /api/homepage/stream endpoint for live category refresh"
```

---

## Task 5: Backend — Hard Refresh Endpoint

**Files:**
- Modify: `server/index.js` (add new route)

- [ ] **Step 1: Add `POST /api/homepage/hard-refresh` endpoint**

```js
app.post('/api/homepage/hard-refresh', (req, res) => {
  const mode = req.query.mode || 'social';

  const categories = db.prepare('SELECT key, query FROM categories WHERE mode = ?').all(mode);

  // Pick top 6 by most recent activity in cache
  const ranked = categories.map(cat => {
    const latest = db.prepare(
      'SELECT MAX(fetched_at) as latest FROM homepage_cache WHERE category_key = ?'
    ).get(cat.key);
    return { ...cat, latest: latest?.latest || '1970-01-01' };
  }).sort((a, b) => a.latest.localeCompare(b.latest)); // stalest first = highest priority

  const top6 = ranked.slice(0, 6);

  // Return 202 immediately
  res.status(202).json({ status: 'accepted', categories: top6.length });

  // Fire refills in background — results flow through any open SSE stream
  // For NSFW: both yt-dlp and scraper categories run simultaneously (two-wave)
  top6.forEach(cat => {
    refillCategory(cat.key).catch(err =>
      logger.error(`Hard refresh failed for ${cat.key}`, { error: err.message })
    );
  });
});
```

- [ ] **Step 2: Test hard refresh**

Run: `curl -X POST "http://localhost:3001/api/homepage/hard-refresh?mode=social"`

Expected: Immediate `{"status":"accepted","categories":6}` response. Check server logs for refill activity.

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "feat: POST /api/homepage/hard-refresh — fast two-wave content refresh"
```

---

## Task 6: Backend — Refresh-All Endpoint & Scheduled Warming

**Files:**
- Modify: `server/index.js` (add route, add cron)
- Modify: `package.json` (add node-cron)
- Modify: `Dockerfile` (add FEEDDECK_ENV)
- Modify: `docker-compose.yml` (add FEEDDECK_ENV)

- [ ] **Step 1: Install node-cron**

Run: `cd feeddeck && npm install node-cron`

- [ ] **Step 2: Add the refresh-all endpoint**

```js
app.post('/api/homepage/refresh-all', async (req, res) => {
  try {
    const result = await refreshAll();
    res.json(result);
  } catch (err) {
    if (err.status === 409) {
      res.status(409).json({ error: 'Refresh already in progress' });
    } else {
      logger.error('refresh-all failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  }
});
```

- [ ] **Step 3: Add node-cron cache warming for server mode**

At the bottom of `server/index.js`, in the `app.listen()` callback (around line 2041), add:

```js
if (process.env.FEEDDECK_ENV === 'server') {
  const cron = await import('node-cron');
  // Every 6 hours: 0 */6 * * *
  cron.default.schedule('0 */6 * * *', async () => {
    logger.info('Scheduled cache warming starting...');
    try {
      const result = await refreshAll();
      logger.info('Scheduled cache warming complete', result);
    } catch (err) {
      logger.error('Scheduled cache warming failed', { error: err.message });
    }
  });
  logger.info('Cache warming cron scheduled (every 6 hours)');
}
```

- [ ] **Step 4: Add FEEDDECK_ENV to Docker config**

In `Dockerfile`, after line 49 (`ENV PORT=3001`), add:
```dockerfile
ENV FEEDDECK_ENV=server
```

In `docker-compose.yml`, add under the service's environment section:
```yaml
environment:
  - FEEDDECK_ENV=server
```

- [ ] **Step 5: Test the refresh-all endpoint**

Run: `curl -X POST http://localhost:3001/api/homepage/refresh-all`

Expected: JSON response with `{ "refreshed": N, "skipped": N, "failed": N, "duration_ms": N }`. May take 30-60 seconds.

- [ ] **Step 6: Test the 409 conflict guard**

Run two concurrent requests:
```bash
curl -X POST http://localhost:3001/api/homepage/refresh-all &
sleep 1 && curl -X POST http://localhost:3001/api/homepage/refresh-all
```

Expected: First returns success, second returns `{"error":"Refresh already in progress"}` with status 409.

- [ ] **Step 7: Commit**

```bash
git add server/index.js package.json package-lock.json Dockerfile docker-compose.yml
git commit -m "feat: refresh-all endpoint with node-cron warming for always-on server"
```

---

## Task 7: Frontend — SSE Hook (`useHomepageSSE`)

**Files:**
- Create: `src/hooks/useHomepageSSE.js`

- [ ] **Step 1: Create the SSE connection hook**

```js
import { useEffect, useRef, useCallback, useState } from 'react';
import { useHomeStore } from '../stores/homeStore';

/**
 * Manages SSE connection to /api/homepage/stream.
 * Returns { isRefreshing, showToast, toastMessage, dismissToast, hardRefresh }
 */
export function useHomepageSSE(mode) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const eventSourceRef = useRef(null);
  const timeoutRef = useRef(null);
  const receivedUpdateRef = useRef(false);
  const updateCategory = useHomeStore(s => s.updateCategory);

  const connect = useCallback(() => {
    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    clearTimeout(timeoutRef.current);
    receivedUpdateRef.current = false;
    setIsRefreshing(true);
    setShowToast(false);

    const es = new EventSource(`/api/homepage/stream?mode=${mode}`);
    eventSourceRef.current = es;

    // 60-second timeout — show toast if no updates received
    timeoutRef.current = setTimeout(() => {
      if (!receivedUpdateRef.current) {
        setShowToast(true);
        setToastMessage("Couldn't refresh feeds right now");
        setIsRefreshing(false);
      }
    }, 60_000);

    es.addEventListener('category-update', (e) => {
      const data = JSON.parse(e.data);
      receivedUpdateRef.current = true;

      // Cancel the 60s timeout on first update
      clearTimeout(timeoutRef.current);

      // Auto-dismiss toast if it was showing
      setShowToast(false);

      // Push fresh videos into the store
      updateCategory(data.key, data.videos);
    });

    es.addEventListener('done', (e) => {
      setIsRefreshing(false);
      clearTimeout(timeoutRef.current);
      es.close();
      eventSourceRef.current = null;
    });

    es.addEventListener('error', () => {
      // SSE connection error — fall back silently
      // The 60s timeout will handle showing the toast if needed
    });
  }, [mode, updateCategory]);

  // Connect on mount / mode change
  useEffect(() => {
    connect();
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      clearTimeout(timeoutRef.current);
    };
  }, [connect]);

  const dismissToast = useCallback(() => setShowToast(false), []);

  const hardRefresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/homepage/hard-refresh?mode=${mode}`, { method: 'POST' });
      if (!res.ok) throw new Error('Hard refresh failed');

      // Reconnect SSE to receive the hard-refresh results
      connect();
    } catch (err) {
      setToastMessage('Refresh failed — check your connection');
      setShowToast(true);
    }
  }, [mode, connect]);

  return { isRefreshing, showToast, toastMessage, dismissToast, hardRefresh };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useHomepageSSE.js
git commit -m "feat: useHomepageSSE hook for live category refresh via SSE"
```

---

## Task 8: Frontend — Store Updates for Stale Tracking

**Files:**
- Modify: `src/stores/homeStore.js:140-236` (fetchHomepage and state)

- [ ] **Step 1: Pass through the `stale` flag in `mapVideo()`**

In the `mapVideo()` helper within `fetchHomepage()` (around line 152), add `stale` to the mapped object:

```js
const mapVideo = (v) => ({
  id: v.id,
  url: v.url,
  title: v.title,
  thumb: v.thumbnail,
  duration: v.duration,
  source: v.source,
  uploader: v.uploader,
  views: v.view_count,
  tags: v.tags || [],
  stale: !!v.stale,  // <-- add this
});
```

- [ ] **Step 2: Add `updateCategory` action to the store**

Add a new action to the store (inside the `create` call):

```js
updateCategory: (categoryKey, freshVideos) => {
  set(state => {
    const categories = state.categories.map(cat => {
      if (cat.key !== categoryKey) return cat;
      // Replace stale items with fresh ones, keep any fresh items that aren't being replaced
      const freshIds = new Set(freshVideos.map(v => v.id));
      const keptItems = cat.items.filter(item => !item.stale && !freshIds.has(item.id));
      const mapped = freshVideos.map(v => ({
        id: v.id, url: v.url, title: v.title, thumb: v.thumbnail,
        duration: v.duration, source: v.source, uploader: v.uploader,
        views: v.view_count, tags: v.tags || [], stale: false,
      }));
      return { ...cat, items: [...mapped, ...keptItems].slice(0, 20) };
    });
    return { categories };
  });
},
```

- [ ] **Step 3: Verify the store compiles**

Run: `cd feeddeck && npx vite build 2>&1 | tail -5`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/stores/homeStore.js
git commit -m "feat(store): add stale flag tracking and updateCategory action for SSE"
```

---

## Task 9: Frontend — RefreshToast Component

**Files:**
- Create: `src/components/home/RefreshToast.jsx`

- [ ] **Step 1: Create the toast component**

```jsx
export default function RefreshToast({ message, onDismiss, onHardRefresh }) {
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3
                    bg-surface-800/95 backdrop-blur-sm border border-white/10 rounded-xl
                    px-5 py-3 shadow-lg text-sm text-white/90 animate-fade-in">
      <span>{message}</span>
      <button
        onClick={onHardRefresh}
        className="px-3 py-1.5 bg-white/15 hover:bg-white/25 rounded-lg text-xs font-medium
                   transition-colors whitespace-nowrap"
      >
        Hard Refresh
      </button>
      <button
        onClick={onDismiss}
        className="ml-1 p-1 hover:bg-white/10 rounded-full transition-colors"
        aria-label="Dismiss"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Add the `animate-fade-in` keyframe if not already in CSS**

Check `src/index.css` for an existing `animate-fade-in`. If missing, add to the Tailwind `@layer utilities` or directly:

```css
@keyframes fade-in {
  from { opacity: 0; transform: translateX(-50%) translateY(10px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}
.animate-fade-in {
  animation: fade-in 0.3s ease-out;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/home/RefreshToast.jsx src/index.css
git commit -m "feat: RefreshToast component with hard refresh button"
```

---

## Task 10: Frontend — CategoryRow Card Crossfade Animation

**Files:**
- Modify: `src/components/home/CategoryRow.jsx:79-132` (card rendering)

- [ ] **Step 1: Add crossfade animation state per card**

The existing IntersectionObserver at lines 19-44 handles initial fade-up. Add a second animation layer for stale→fresh transitions.

Each card needs to track whether it just transitioned from stale to fresh. Use a `prevItemsRef` to detect when a stale card has been replaced:

```jsx
const prevItemsRef = useRef([]);
const [refreshingIds, setRefreshingIds] = useState(new Set());

useEffect(() => {
  const prevItems = prevItemsRef.current;
  const newRefreshing = new Set();

  category.items.forEach((item, i) => {
    const prev = prevItems[i];
    // Card was stale before and now it's fresh (or replaced entirely)
    if (prev && prev.stale && (!item.stale || item.id !== prev.id)) {
      newRefreshing.add(item.id);
    }
  });

  if (newRefreshing.size > 0) {
    setRefreshingIds(newRefreshing);
    // Clear the animation class after all transitions complete
    const maxDelay = newRefreshing.size * 150 + 300;
    setTimeout(() => setRefreshingIds(new Set()), maxDelay);
  }

  prevItemsRef.current = [...category.items];
}, [category.items]);
```

- [ ] **Step 2: Apply crossfade CSS classes to cards**

In the card rendering loop (around line 79), add a stagger delay and crossfade class:

```jsx
{category.items.map((item, i) => {
  const isRefreshing = refreshingIds.has(item.id);
  const staleIdx = [...refreshingIds].indexOf(item.id);
  const staggerDelay = staleIdx >= 0 ? staleIdx * 150 : 0;

  return (
    <div
      key={item.id}
      className={`cat-card flex-none w-card rounded-[10px] ... ${isRefreshing ? 'animate-card-refresh' : ''}`}
      style={isRefreshing ? { animationDelay: `${staggerDelay}ms` } : undefined}
    >
      {/* existing card content */}
    </div>
  );
})}
```

- [ ] **Step 3: Add `animate-card-refresh` CSS keyframe**

In `src/index.css`:

```css
@keyframes card-refresh {
  0% { opacity: 0; transform: scale(0.95); }
  100% { opacity: 1; transform: scale(1); }
}
.animate-card-refresh {
  animation: card-refresh 0.3s ease-out both;
}
```

- [ ] **Step 4: Add Intersection Observer for viewport gating**

The existing IntersectionObserver at lines 19-44 already tracks visibility. Add a `isVisible` ref that the `updateCategory` logic can check. If the row is off-screen when an SSE update arrives, skip the animation (items update instantly without the `refreshingIds` mechanism):

```jsx
const isVisibleRef = useRef(false);

// In the existing IntersectionObserver callback:
if (entry.isIntersecting) {
  isVisibleRef.current = true;
  // ... existing fade-up logic
}
```

Then gate the animation effect:

```jsx
useEffect(() => {
  if (!isVisibleRef.current) return; // Skip animation for off-screen rows
  // ... existing refreshingIds logic
}, [category.items]);
```

- [ ] **Step 5: Verify build succeeds**

Run: `cd feeddeck && npx vite build 2>&1 | tail -5`
Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/components/home/CategoryRow.jsx src/index.css
git commit -m "feat: card crossfade animation for stale→fresh transitions in CategoryRow"
```

---

## Task 11: Frontend — Wire SSE into HomePage

**Files:**
- Modify: `src/pages/HomePage.jsx:20-82`

- [ ] **Step 1: Import and connect the SSE hook and toast**

At the top of `HomePage.jsx`, add imports:

```jsx
import { useHomepageSSE } from '../hooks/useHomepageSSE';
import RefreshToast from '../components/home/RefreshToast';
```

- [ ] **Step 2: Wire the SSE hook into the component**

Inside the HomePage component (after the existing store destructuring around line 21):

```jsx
const mode = isSFW ? 'social' : 'nsfw';
const { isRefreshing, showToast, toastMessage, dismissToast, hardRefresh } = useHomepageSSE(mode);
```

- [ ] **Step 3: Add the loading indicator (pulsing dot) to the header area**

After the `<HomeHeader />` component (around line 45), or pass it as a prop:

```jsx
{isRefreshing && (
  <div className="fixed top-4 right-4 z-40 flex items-center gap-2 text-xs text-white/50">
    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
    Refreshing...
  </div>
)}
```

- [ ] **Step 4: Add a refresh button to the header**

Add a small refresh icon button near the mode toggle or in the header bar:

```jsx
<button
  onClick={hardRefresh}
  className="p-2 hover:bg-white/10 rounded-lg transition-colors"
  title="Refresh content"
>
  <svg className="w-4 h-4 text-white/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
  </svg>
</button>
```

- [ ] **Step 5: Render the toast**

At the bottom of the component return, before the closing `</div>`:

```jsx
{showToast && (
  <RefreshToast
    message={toastMessage}
    onDismiss={dismissToast}
    onHardRefresh={hardRefresh}
  />
)}
```

- [ ] **Step 6: Verify full integration**

Run: `npm run dev` — open `http://localhost:3000`.

Expected behavior:
1. Homepage loads with stale+fresh content immediately
2. Pulsing "Refreshing..." indicator appears
3. Cards in category rows crossfade as fresh content arrives
4. Indicator disappears when done
5. If you disconnect the network, toast appears after 60 seconds

- [ ] **Step 7: Commit**

```bash
git add src/pages/HomePage.jsx
git commit -m "feat: wire SSE refresh, loading indicator, and toast into HomePage"
```

---

## Task 12: Docker & Scheduled Task Setup

**Files:**
- Modify: `Dockerfile`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Verify Docker changes from Task 6**

The `FEEDDECK_ENV=server` env var was already added in Task 6. Verify the Dockerfile and docker-compose.yml have the changes.

- [ ] **Step 2: Test Docker build**

Run: `cd feeddeck && docker build -t feeddeck . 2>&1 | tail -10`
Expected: Build succeeds.

- [ ] **Step 3: Set up Claude Code scheduled task for local dev**

Create a scheduled task using Claude Code's scheduling feature. The task should:
- Run daily at 6:00 AM
- Execute: `curl -X POST http://localhost:3001/api/homepage/refresh-all`
- If server isn't running, fail gracefully

- [ ] **Step 4: Commit any remaining changes**

```bash
git add -A
git commit -m "chore: Docker env and scheduled cache warming setup"
```

---

## Task 13: Integration Test & Final Verification

- [ ] **Step 1: Full cold-start test**

1. Stop the dev server
2. Expire all cache entries manually:
   ```bash
   node -e "const db = require('node:sqlite'); const d = new db.DatabaseSync('data/library.db'); d.prepare(\"UPDATE homepage_cache SET expires_at = datetime('now', '-1 hour')\").run(); console.log('All entries expired');"
   ```
3. Start the dev server: `npm run dev`
4. Open `http://localhost:3000`

Expected:
- Homepage shows stale content immediately (not blank)
- Pulsing refresh indicator appears
- Cards crossfade to fresh content as SSE delivers updates
- Indicator disappears on completion

- [ ] **Step 2: Test hard refresh flow**

1. Click the refresh icon in the header
2. Expected: 202 accepted, SSE reconnects, fresh content streams in

- [ ] **Step 3: Test failure toast**

1. Stop the server while the frontend is open
2. Navigate away and back to homepage (triggers SSE reconnect)
3. Expected: After 60 seconds, toast appears with "Couldn't refresh feeds right now" and Hard Refresh button

- [ ] **Step 4: Test refresh-all endpoint**

Run: `curl -X POST http://localhost:3001/api/homepage/refresh-all`
Expected: Returns summary after 30-60 seconds. Check that stale rows > 30 days old are purged.

- [ ] **Step 5: Build verification**

Run: `cd feeddeck && npx vite build && npx eslint src/ --quiet`
Expected: Both pass with no errors.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: stale-while-revalidate homepage cache — complete implementation"
```
