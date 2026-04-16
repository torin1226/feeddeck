# Personalized Discovery — Eliminating Generic Trending Content

**Date:** 2026-04-11
**Status:** Approved (pending implementation)
**Review:** Passed spec review (rev 2, all critical/important issues addressed)

## Problem

Every surface in FeedDeck is contaminated with generic trending content:
- Top 10 row sorts by view count → trending videos dominate
- "Up Next" hero carousel shows whatever the first 3 categories return
- Subscription row label mismatch prevented it from ever rendering (fixed: `Your Subscriptions` → `My Subscriptions`)
- Feed sources include `youtube.com` with query `"trending videos"`
- Subscription fallback falls back to `ytsearch:trending videos today` when cache is empty
- `_socialFeedToSearch()` has four separate trending fallbacks (YouTube feed, YouTube trending, TikTok, and generic)

The user sees SEO spam and viral clickbait instead of content relevant to their interests.

## Solution

Replace all generic trending content with personalized discovery driven by 5 weighted interest signals. Never fall back to trending. When personalized data is unavailable, fall back to creator-name searches (`"CreatorName new videos"`) from any cached creator data. Only show nothing if literally zero creators are cached anywhere.

## Interest Signals (Weighted)

| Signal | Weight | Source Table | Has Metadata? |
|---|---|---|---|
| Library additions | 5.0 | `videos` (where saved to library) | Yes |
| Liked tags | 4.0 | `tag_preferences` (preference = 'liked') | Yes (tags directly) |
| YouTube watch history | 3.0 | `watch_history_cache` (new) | Yes (cached from yt-dlp) |
| TikTok watch history | 2.0 | `videos` joined via `tiktok_imports` (status='done') | Yes (enriched by processor) |
| Subscription backups | 1.0 | `subscription_backups`, `sub_channels` | Partial (creator names only) |

Weights compound: a topic appearing in both library (5.0) and watch history (3.0) scores 8.0.

**Note on TikTok watch history:** The `tiktok_watch_history` table has bare URLs only (no title, tags, or channel data). However, `tiktok_imports` rows with `status='done'` have been enriched via yt-dlp and inserted into the `videos` table with full metadata. We use those enriched records. Raw `tiktok_watch_history` URLs that haven't been processed are not usable for topic extraction without expensive yt-dlp calls — those are skipped.

## Data Layer

### New Table: `interest_profile`

```sql
CREATE TABLE IF NOT EXISTS interest_profile (
  topic       TEXT PRIMARY KEY,
  weight      REAL NOT NULL DEFAULT 0,
  frequency   INTEGER NOT NULL DEFAULT 1,
  last_seen   DATETIME NOT NULL DEFAULT (datetime('now'))
);
```

### New Table: `interest_sources` (junction table)

Tracks which signals contributed to each topic. Replaces the problematic comma-separated `source` column.

```sql
CREATE TABLE IF NOT EXISTS interest_sources (
  topic       TEXT NOT NULL,
  source      TEXT NOT NULL,           -- 'library', 'tags', 'watch_yt', 'watch_tt', 'subscriptions'
  weight      REAL NOT NULL DEFAULT 0, -- this source's weight contribution
  last_seen   DATETIME NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (topic, source),
  FOREIGN KEY (topic) REFERENCES interest_profile(topic) ON DELETE CASCADE
);
```

**Upsert logic for `updateInterestProfile(video, signalSource)`:**
1. For each extracted topic, upsert into `interest_sources` with the signal's weight multiplier
2. Then update `interest_profile` by summing across all sources:
```sql
INSERT INTO interest_sources (topic, source, weight, last_seen)
  VALUES (?, ?, ?, datetime('now'))
  ON CONFLICT(topic, source) DO UPDATE SET
    weight = MAX(excluded.weight, interest_sources.weight),
    last_seen = datetime('now');

INSERT INTO interest_profile (topic, weight, frequency, last_seen)
  VALUES (?, ?, 1, datetime('now'))
  ON CONFLICT(topic) DO UPDATE SET
    weight = (SELECT SUM(weight) FROM interest_sources WHERE topic = ?),
    frequency = frequency + 1,
    last_seen = datetime('now');
```

### New Table: `watch_history_cache`

```sql
CREATE TABLE IF NOT EXISTS watch_history_cache (
  video_id     TEXT PRIMARY KEY,
  title        TEXT,
  channel_id   TEXT,
  channel_name TEXT,
  tags         TEXT DEFAULT '[]',     -- JSON array
  cached_at    DATETIME NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_whc_channel ON watch_history_cache(channel_name);
```

### Modified Tables

- `homepage_cache` — add `relevance_score REAL DEFAULT 0`
- `feed_cache` — add `relevance_score REAL DEFAULT 0`

## New Files

### `server/watch-history-cache.js`

Three exported functions, same pattern as `sub-channel-cache.js`:

- **`cacheWatchHistory(rawEntries)`** — upserts yt-dlp raw entries into `watch_history_cache`. Extracts channel names and tags. Calls `updateInterestProfile()` for each entry with signal source `'watch_yt'`. Called after successful yt-dlp fetch from `youtube.com/feed/history`.
- **`hasCachedWatchHistory()`** — boolean check.
- **`getWatchHistoryChannels(limit)`** — returns unique channel names ordered by frequency.

Wired into `ytdlp.js` search method: detect `/feed/history` URL, try with cookies, cache on success, fall back to cached data on cookie failure.

Cache refresh: when subscription feed fetch succeeds (cookies confirmed working), also fetch watch history in background.

### `server/interest-profile.js`

- **`updateInterestProfile(video, signalSource)`** — called when a video enters any signal table. Extracts topics from title + tags, upserts into `interest_sources` and `interest_profile` with the signal's weight multiplier.
- **`buildDiscoveryQueries(limit)`** — pulls top N topics by weight from `interest_profile`, builds `ytsearch3:topic latest` queries. Returns `{ queries, topics }`. Executed with concurrency cap of 4 (max 4 yt-dlp processes in parallel). Results cached for 6 hours in `homepage_cache` to avoid re-fetching.
- **`scoreVideo(video)`** — scores a video against the interest profile + creator signals. Returns a `relevance_score` combining creator match + topic match. Called inline during INSERT loops for `homepage_cache` and `feed_cache`. Uses a single prepared statement that joins `interest_profile` against the video's tags, so it's a fast DB lookup, not expensive computation.
- **`getAllKnownCreators(limit)`** — aggregates creator names from all signal tables (library videos, watch_history_cache, sub_channels, subscription_backups). Returns deduplicated list ordered by signal weight. Used for the fallback path.

**Topic extraction (no ML):**

Given a video titled "Building a Modern React Dashboard with Tailwind CSS" and tags `["react", "tailwind", "web dev", "tutorial"]`:
1. Strip stopwords → "Building Modern React Dashboard Tailwind CSS"
2. Extract phrases: "React Dashboard", "Tailwind CSS", "Modern React"
3. Cross-reference tags: "react", "tailwind", "web dev" match → boost those
4. Final topics: `react` (boosted), `tailwind` (boosted), `web dev` (boosted), `react dashboard`, `tailwind css`
5. Each upserted with the signal's weight multiplier

Incremental — each new video triggers a lightweight upsert, no batch rebuild.

## Fallback Chain

**The universal fallback — never trending, never empty if creators are cached:**

1. **Primary:** Personalized content from interest profile (topic-based discovery, scored results)
2. **Fallback:** Creator-name search from any cached creator data — `ytsearch3:CreatorName new videos`. Sources: `watch_history_cache`, `sub_channels`, `subscription_backups`, library video uploaders.
3. **Last resort:** If literally zero creators cached anywhere (brand new install, no data imported), row does not render.

This applies to every surface: homepage rows, feed, subscription fallback. The word "trending" never appears in any query string or fallback path.

## Homepage Layout

**Hero/Carousel:** New From Your Channels (replaces "Up Next")
**Row 1:** Top 10 This Week (relevance-scored, not view-count-sorted)
**Row 2:** My Subscriptions
**Row 3:** Recommended For You (replaces Trending/Viral)

### Hero Carousel — "New From Your Channels"

Sources creators from watch history + sub_channels + subscription_backups. Weighted by signal (library creators > watch history > subscription-only). Picks top 15 creators, fetches latest 2 videos each.

Sits in the existing hero/carousel position only. Not repeated as a TheatreRow below the fold.

**API/Frontend wiring:** The `/api/homepage` response includes `social_new_channels` as a category. `homeStore.js` uses it exclusively for the hero carousel (`carouselItems`). `BrowseSection.jsx` filters it OUT of the TheatreRow display to prevent duplication.

### Top 10 This Week

**Current:** `allVideos.sort((a, b) => parseViews(b.views) - parseViews(a.views))` (client-side, view-count-based)

**New:** Sort by `relevance_score`. View count as tiebreaker only.

**Required changes:**
1. **API** (`content.js` SELECT): include `relevance_score` in the homepage_cache query response
2. **Frontend** (`homeStore.js`): change Top 10 sort from `parseViews(b.views) - parseViews(a.views)` to `(b.relevance_score || 0) - (a.relevance_score || 0)`, with `parseViews` as tiebreaker
3. **Exclusion**: when building the Top 10 pool, exclude videos from `social_trending` and `social_viral` categories (during migration these are deleted, but belt-and-suspenders)

### "Recommended For You"

New category `social_discovery`. When `refillCategory('social_discovery')` runs:
1. Call `buildDiscoveryQueries(12)` from interest profile
2. Execute queries with concurrency cap of 4 parallel yt-dlp processes
3. Score each result with `scoreVideo()` before inserting into `homepage_cache`
4. If interest profile is empty, fall back to creator-name searches via `getAllKnownCreators(12)`

### BrowseSection.jsx Changes

`TARGET_LABELS` changes from:
```javascript
['Live Music', 'My Subscriptions', 'Trending']
```
to:
```javascript
['My Subscriptions', 'Recommended For You']
```

`social_music` (Live Music) category remains in the database for feed use but is no longer a homepage row.

(Top 10 and hero carousel are separate components, not matched via TARGET_LABELS.)

### "New From Your Channels" — `refillCategory` Handler

When `refillCategory('social_new_channels')` encounters the `__channels__` sentinel query:
1. Call `getAllKnownCreators(15)` to get top creators by signal weight
2. For each creator, build query: channel URL if available, otherwise `ytsearch2:CreatorName new videos`
3. Execute with concurrency cap of 5
4. Score and insert results into `homepage_cache`

This is a new code path in `refillCategory`, guarded by `if (query === '__channels__')`.

## Feed Personalization

### Scoring

Every video gets `relevance_score` at insert time via `scoreVideo()`:
1. **Creator match** — check video uploader against all signal tables. Apply highest matching signal weight (library = 5.0, liked = 4.0, watch_yt = 3.0, watch_tt = 2.0, subs = 1.0).
2. **Topic match** — check video title/tags against `interest_profile`. Sum matching topic weights.
3. **Combined** = creator_score + topic_score
4. **Floor** = 0.1 (minimum weight for any video, prevents division-by-zero in weighted shuffle)

Called inline during the INSERT loop in both `refillCategory` (content.js) and `_refillFeedCacheImpl` (index.js). The `scoreVideo()` function uses a single prepared statement joining against `interest_profile`, so it's a fast DB read per video, not a full table scan.

### Feed Query Changes (`server/routes/feed.js`)

Replace:
```sql
COALESCE(s.weight, 1.0) * CASE WHEN sb.id IS NOT NULL THEN 5.0 ELSE 1.0 END AS weight
```
With:
```sql
MAX(COALESCE(fc.relevance_score, 0.1), 0.1) AS weight
```

Order by `weight * (0.8 + ABS(RANDOM() % 100) / 250.0)` for slight randomization so feed isn't perfectly deterministic.

Both feed tabs (social and nsfw) use the same scoring system, filtered by mode.

### Feed Refill Changes

- Remove `youtube.com` / `"trending videos"` as default source
- Replace with interest-profile-driven queries (sentinel `__discovery__`)
- Keep creator-based sources (`__creators__` for TikTok/Reddit)
- When `__discovery__` sentinel is encountered during feed refill, call `buildDiscoveryQueries()` and `getAllKnownCreators()` same as homepage

## Trending Elimination Checklist

All places where generic trending content leaks in, and what replaces each:

| Location | Current Behavior | Replacement |
|---|---|---|
| `database.js` — `social_trending` category seed | Generic YouTube trending | **Delete category** |
| `database.js` — `social_viral` category seed | Generic viral search | **Delete category** |
| `database.js` — YouTube source query `"trending videos"` | Trending as default | `"__discovery__"` sentinel |
| `ytdlp.js` — `_subscriptionFallback()` empty cache path | `ytsearch:trending videos today` | Creator-name search via `getAllKnownCreators()`, empty array only if zero creators |
| `ytdlp.js` — `_socialFeedToSearch()` YouTube trending | Returns trending playlist URL | **Delete this branch** |
| `ytdlp.js` — `_socialFeedToSearch()` YouTube feed fallback | `ytsearch:trending videos today` | Creator-name search or empty |
| `ytdlp.js` — `_socialFeedToSearch()` TikTok fallback | `ytsearch:tiktok viral trending` | Creator-name search from TikTok subscription_backups |
| `ytdlp.js` — `_socialFeedToSearch()` generic fallback | `ytsearch:trending videos` | Creator-name search or empty |

### Database Migration

```sql
-- Remove trending/viral categories
DELETE FROM categories WHERE key IN ('social_trending', 'social_viral');
DELETE FROM homepage_cache WHERE category_key IN ('social_trending', 'social_viral');

-- Replace ALL youtube.com social sources with discovery sentinel (broad match)
UPDATE sources SET query = '__discovery__' WHERE domain = 'youtube.com' AND mode = 'social';

-- Add new categories
INSERT OR IGNORE INTO categories (key, label, query, mode, sort_order) VALUES
  ('social_new_channels', 'New From Your Channels', '__channels__', 'social', 0),
  ('social_discovery', 'Recommended For You', '__discovery__', 'social', 20);
```

## Rule

The word "trending" must not appear in any query string, source configuration, or fallback path. When personalized data is unavailable, fall back to creator-name searches. Only show nothing if zero creators are cached.
