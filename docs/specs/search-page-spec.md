# SearchPage Spec

## Summary

Create a new `SearchPage` at `/search?q=<query>` that gives search results a dedicated, full-page grid experience using SSE streaming. Below the results, show a simplified library grid as a fallback browsing surface. This page replaces the header search dropdown as the primary search destination.

---

## Routing & Navigation

- **Route:** `/search` with query param `q` (e.g., `/search?q=cute+cats`)
- **Not a nav item.** This is a transient page, not in the persistent nav bar.
- **Entry point:** Reroute the existing `HomeHeader` search bar. When the user submits a search (Enter / form submit), navigate to `/search?q=<query>` instead of showing the inline dropdown results. The header dropdown can remain for quick previews on keystroke, but Enter commits to the full page.
- **Add route to `AppShell.jsx`:** Lazy-load `SearchPage` like the other pages. Wrap in `ErrorBoundary`.

```jsx
const SearchPage = lazy(() => import('../pages/SearchPage'))
// ...
<Route path="/search" element={<ErrorBoundary name="Search"><SearchPage /></ErrorBoundary>} />
```

---

## Page Layout

Top to bottom:

### 1. HomeHeader (existing)
Reuse the shared `HomeHeader` component. The search field should be pre-filled with the current `q` param so the user can edit and re-search. On re-submit, update the URL param (which triggers a new SSE stream).

### 2. Search Results Section
- **Header row:** `Results for "{query}"` with a count badge that increments as results stream in. Show a subtle `fetching...` pulse animation while the stream is open.
- **Grid:** Responsive grid matching the existing pattern: `grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4`
- **Cards:** Use the existing `VideoCard` component.
- **Streaming behavior:** Open an `EventSource` to `GET /api/search?q={query}&count=20` (SSE endpoint). Render each card as it arrives with a staggered fade-slide-in animation (delay capped at 200ms). Show skeleton placeholder cards while loading (8 initially, then 2 while more are expected).
- **Click behavior:** Navigate to `/video/:id` (VideoDetailPage). Do NOT open a modal overlay.
- **Empty/error states:** If the stream completes with 0 results, show an empty state with the `EmptyIllustration` component (variant: `search` or similar). If the stream errors, show a retry-able error message.
- **Mode firewall:** Pass `mode` param to the API call. Filter results client-side as a second guard using `isVideoForMode()`.

### 3. Divider
A subtle `border-b border-surface-border` with vertical spacing to visually separate search results from library content.

### 4. Library Section (simplified)
- **Header row:** `Your Library` with video count, styled as a secondary section.
- **Grid:** Same responsive grid as search results. Show all library videos for the current mode, filtered through `isVideoForMode()`.
- **No tabs, no Continue Watching row, no fancy empty states.** Just a flat grid of `VideoCard` components from `useLibraryStore`.
- **Limit:** Show up to ~20 videos. If the library has more, show a "View full library" link/button that navigates to `/library`.
- **Click behavior:** Same as search results: navigate to `/video/:id`.
- **If library is empty:** Show a minimal message like "No videos in your library yet" with a "Browse Feed" CTA linking to `/feed`.

---

## SSE Stream Implementation

Reference the existing `GET /api/search` endpoint in `server/routes/content.js` (line 114). It already:
- Accepts `q` and `count` query params
- Streams JSON video objects one per SSE event
- Sends `[done]` as the final event
- Handles errors gracefully

Client-side pattern (extract into a reusable hook or keep inline):

```jsx
useEffect(() => {
  setResults([])
  setLoading(true)
  setError(null)

  const es = new EventSource(
    `/api/search?q=${encodeURIComponent(query)}&count=20&mode=${currentMode}`
  )

  es.onmessage = (e) => {
    if (e.data === '[done]') {
      setLoading(false)
      es.close()
      return
    }
    try {
      const video = JSON.parse(e.data)
      if (isVideoForMode(video, currentMode)) {
        setResults((prev) => [...prev, video])
      }
    } catch {}
  }

  es.onerror = () => {
    setLoading(false)
    setError(true)
    es.close()
  }

  return () => es.close()
}, [query, currentMode])
```

**Important:** Close the `EventSource` on unmount and when `query` changes (the cleanup function handles both). Also close if the user navigates away mid-stream.

---

## HomeHeader Changes

In `HomeHeader.jsx`, the search submit handler currently fetches `/api/search/multi` and renders results in a dropdown. Change this:

- **On Enter / form submit:** Call `navigate(`/search?q=${encodeURIComponent(query)}`)` instead of fetching inline results.
- **On keystroke (debounced):** Keep the existing dropdown behavior using `/api/search/multi` for quick previews. This is the "peek" experience; Enter commits to the full page.
- **When on `/search` route:** Pre-fill the search input with the `q` URL param. If the user edits and re-submits, update the URL param via `navigate` (replace, not push, to avoid back-button spam).

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/pages/SearchPage.jsx` | **Create.** New page component. |
| `src/components/AppShell.jsx` | **Modify.** Add lazy import and route for `/search`. |
| `src/components/home/HomeHeader.jsx` | **Modify.** Reroute search submit to navigate to `/search?q=...`. Keep keystroke dropdown. |
| `server/routes/content.js` | **Modify.** Add `POST /api/search/history`, `PATCH /api/search/history/:id/click`, `GET /api/search/history` endpoints. |
| `server/db.js` (or wherever schema lives) | **Modify.** Add `search_history` table creation + indexes. |
| `src/components/VideoGrid.jsx` | **Delete.** After SearchPage ships, this file is fully dead. |

---

## Design Notes

- Match the existing visual language: `font-display` for headings, `text-text-primary` / `text-text-muted` color tokens, `bg-surface` page background, `px-10` horizontal padding matching LibraryPage.
- Skeleton cards should use the same shimmer pattern as `SkeletonLibrary` or the pattern from VideoGrid's `SkeletonCard` (aspect-video thumbnail placeholder + two text line placeholders).
- Staggered card animation: `animate-fade-slide-in` with `animationDelay: Math.min(i * 40, 200)ms` (same as VideoGrid had).
- The page should feel like a natural extension of the homepage, not a separate app.

---

## Search History & Empty State Fallback

### New Table: `search_history`

Add to the existing SQLite database (`server/feeddeck.db`). Follow the same patterns as `video_ratings` and `taste_profile`.

```sql
CREATE TABLE IF NOT EXISTS search_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT NOT NULL,
  query_normalized TEXT NOT NULL,    -- lowercased, trimmed, collapsed whitespace
  mode TEXT NOT NULL DEFAULT 'social', -- 'social' or 'nsfw', scoped like taste_profile
  result_count INTEGER DEFAULT 0,    -- how many results the stream returned
  clicked_count INTEGER DEFAULT 0,   -- how many results the user clicked through to VideoDetailPage
  searched_at TEXT NOT NULL DEFAULT (datetime('now')),
  source TEXT DEFAULT 'manual'       -- 'manual' | 'fallback' | 'suggestion' (for future use)
);

CREATE INDEX idx_search_history_mode ON search_history(mode, searched_at DESC);
CREATE INDEX idx_search_history_normalized ON search_history(query_normalized, mode);
```

**Why this schema:** `query_normalized` lets you deduplicate ("cute cats" vs "Cute Cats"). `result_count` and `clicked_count` together give you signal quality (searched for X, got 15 results, clicked 4 = high-interest query). `mode` scoping prevents cross-mode leakage, matching the pattern in `taste_profile`. The `source` column distinguishes organic searches from fallback-triggered replays for cleaner analytics later.

### API Endpoints

**`POST /api/search/history`** -- Record a search when the SSE stream completes.
```json
{ "query": "cute cats", "mode": "social", "result_count": 12 }
```
Server normalizes the query and inserts a row.

**`PATCH /api/search/history/:id/click`** -- Increment `clicked_count` when the user clicks a result to navigate to VideoDetailPage. The SearchPage should hold the `search_history.id` from the POST response and send this on each card click.

**`GET /api/search/history?mode=social&has_results=true&limit=5`** -- Fetch recent successful searches for fallback. Filter by `result_count > 0` and `mode`. Return newest first.

### Empty State Fallback Behavior

When the SSE stream completes with 0 results:

1. Show the standard empty state (`EmptyIllustration` variant `search`, "No results for '{query}'").
2. Immediately call `GET /api/search/history?mode={currentMode}&has_results=true&limit=1` to get the most recent successful search.
3. If a previous search exists, show below the empty state:
   - Label: `Showing results for "{previous_query}" instead`
   - Auto-trigger a new SSE stream for that query.
   - The URL stays as `/search?q={original_query}` (don't rewrite it). This is a fallback, not a redirect.
   - If the user edits the search bar and re-submits, the fallback clears and a fresh search runs.
4. If no previous successful search exists (first-time user), just show the empty state + library section below. No fallback.

### Recording Flow

1. User submits search -> navigate to `/search?q=...`
2. SSE stream opens, results render progressively
3. When stream sends `[done]`, POST to `/api/search/history` with the query and final result count
4. Store the returned `search_history.id` in component state
5. On each card click (before navigating to `/video/:id`), fire `PATCH /api/search/history/:id/click`

### Future Use (Not in This Spec)

The `search_history` table is designed to feed into the existing taste profile system later. Potential signals: high-click-rate queries suggest strong interest in those terms, repeated queries suggest unmet demand, mode-scoped query patterns reveal category preferences. None of this needs to be built now -- the schema just needs to capture the data.

---

## What This Does NOT Include

- **No search filters/facets** (site, date, duration). Can be added later.
- **No autocorrect / "did you mean."** The upstream platforms (YouTube, etc.) already handle typo correction in their search results. Building client-side spell correction is 2+ sessions of work for marginal gain since yt-dlp passes queries straight to the platform's own search. Revisit if we add a local search index.
- **No persisting search results.** Navigating away and back re-runs the search (but the search IS recorded in history).
- **No infinite scroll.** Fixed count per search (20). Can paginate later if needed.

---

## Acceptance Criteria

1. Typing in HomeHeader and pressing Enter navigates to `/search?q=...`
2. SearchPage streams results via SSE with progressive card rendering and skeleton placeholders
3. Clicking a search result navigates to `/video/:id`
4. Library grid appears below results with up to 20 mode-filtered videos
5. SFW/NSFW mode firewall is enforced on both search results and library grid
6. Back button returns to the previous page (not search with a different query)
7. Every completed search is recorded in `search_history` with query, mode, and result count
8. Clicking a result card increments `clicked_count` on the search history row
9. When a search returns 0 results, the most recent successful search auto-triggers as a fallback below the empty state
10. `VideoGrid.jsx` is deleted
11. No regressions in HomeHeader keystroke dropdown behavior
