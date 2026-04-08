# Plan: Subscription-Aware Discovery + Multi-Platform Content Mix

## Context

The homepage social mode has two problems:
1. Discovery content (non-subscription rows) has zero relationship to the user's subscriptions or interests. Categories use generic yt-dlp searches like `ytsearch10:viral videos this week` that return the same content for everyone.
2. Of 19 social categories, 15 are YouTube-only searches. TikTok has 1 category (FYP URL, likely broken without cookies). Reddit has 3 subreddits. Instagram Reels is absent entirely.

## Key Data File

**`data/youtube-subscriptions.json`** contains Torin's 140 YouTube subscriptions + 198 Reddit communities, pre-categorized into 19 interest groups with weighted importance, per-platform discovery queries (YouTube, TikTok, Reddit, Instagram), a cross-platform creator mapping, and a tiered list of Reddit subs ranked by video content density. This file is the primary taste signal for all discovery logic below.

Interest categories (by weight):
- **Weight 5 (core):** Design & UX, Tech/AI/Startups, Comedy & Entertainment, Viral/Visual Content
- **Weight 4 (strong):** History/Education/Science, Internet Culture/Drama/Stories
- **Weight 3 (moderate):** News/Politics/Commentary, Culture/Identity/Social, Leadership/Management
- **Weight 2 (interest):** Finance/FIRE/Real Estate, Geopolitics/Military, Wellness, Food, Music/Festivals, Fashion/Style, Dogs/Pets, Sports/Gaming
- **Weight 1 (low):** Languages/Learning, Personal Vlogs

Key insight from Reddit data: Reddit subscriptions are MUCH heavier than YouTube on finance (18 FIRE/investing/RE subs), internet drama/stories (42 subs!), and viral visual content (29 subs). The platform mix target has been adjusted: YouTube 35%, Reddit 30%, TikTok 20%, Instagram 15%.

The JSON also includes `reddit_video_sources` with 3 tiers of subreddits ranked by video content density. Tier 1 subs (r/nextfuckinglevel, r/oddlysatisfying, etc.) are almost entirely video and should be the primary Reddit content source for the homepage feed.

## Goal

Make the homepage feel like YouTube's homepage: a mix of subscription content and discovery content that's clearly influenced by what you watch. And mix in TikTok, Reels, and Reddit so it feels like a true multi-platform aggregator.

---

## Phase 0: Seed Subscription Data into DB

### 0.1 Load `data/youtube-subscriptions.json` on startup

On server init (after `initDatabase()`), read the subscriptions JSON and populate:

1. **`subscriptions` table (new):** `(channel_name TEXT PRIMARY KEY, interest_category TEXT, weight INTEGER, cross_platform_names TEXT DEFAULT '[]')`
   - Insert all 140 channels with their category and weight
   - For cross-platform creators, store alternate names/handles in `cross_platform_names` JSON array

2. **Auto-seed `tag_preferences`:** For each interest category, insert the `top_interest_tags` entries as `liked` tags (skip if already exists). This bootstraps the existing tag preference system with real signal.

3. **`interest_categories` table (new):** `(key TEXT PRIMARY KEY, label TEXT, weight INTEGER, discovery_queries TEXT)`
   - Store the per-category, per-platform discovery queries from the JSON
   - `discovery_js` module reads from this table, not the JSON file directly (so it's editable at runtime)

Only run this seed once (check a `preferences` row like `subscriptions_seeded_at`). Provide a `?force=1` reseed option.

---

## Phase 1: Subscription-Aware Discovery Categories

### 1.1 Extract subscription signals from existing data

The system now has three tiers of taste signal:
- **Tier 1 (strongest):** `subscriptions` + `interest_categories` tables (explicit "I chose to follow these")
- **Tier 2:** `tag_preferences` table (liked/disliked tags, now pre-seeded from subscriptions)
- **Tier 3:** `videos` table, `history` table, `tiktok_watch_history` (implicit watch behavior)

**New utility: `server/discovery.js`**

Create a module that builds a "taste profile" from all three tiers:

```
function getTasteProfile() → { interestCategories, topTags, topUploaders, crossPlatformCreators, topDomains, likedTags }
```

Sources to query:
- `interest_categories` table (highest weight = strongest signal, includes per-platform queries)
- `subscriptions` table (channel names for "More from creators you watch" rows)
- `tag_preferences` table (liked tags = strong signal)
- `videos` table (most-watched uploaders, most common tags across library)
- `history` table (recent watch history tags/uploaders)
- `tiktok_watch_history` table (if populated from GDPR import)
- `feed_cache` watched videos (tags + source_domain frequency)

Return:
- `topTags: string[]` — top 20 tags by frequency across all sources, boosted by liked status
- `topUploaders: string[]` — top 10 most-watched uploaders/creators
- `topDomains: { domain: string, weight: number }[]` — which platforms user watches most
- `likedTags: string[]` — explicitly liked tags from tag_preferences

### 1.2 Replace generic search categories with taste-driven queries

Modify `refillCategory()` in `server/index.js`:

Currently, non-URL categories use static search strings like `ytsearch10:best new tech gadgets`. Change this:

**For categories flagged as `discovery: true` (new column on categories table):**
1. Call `getTasteProfile()`
2. Build search queries from taste profile instead of static strings
3. Example: if topTags = ['design', 'tech', 'cooking'] and category is "Recommended For You", query becomes `ytsearch12:design tech tips 2026` instead of a static string
4. Rotate through topTags across refill cycles so content stays fresh

**New categories to add (replace some generic ones):**

| Key | Label | Query Strategy |
|-----|-------|---------------|
| `social_foryou` | For You | Build from top 3 liked tags, rotate each refill |
| `social_more_creators` | More From Creators You Watch | Query top uploaders' channels via yt-dlp |
| `social_because_tag` | Because You Like {tag} | Pick a random liked tag, search across platforms |
| `social_trending` | Trending | Keep as-is (YouTube trending) |
| `social_subscriptions` | Your Subscriptions | Keep as-is (requires cookies) |

**DB migration:** Add `discovery INTEGER DEFAULT 0` column to `categories` table. Set `discovery = 1` on taste-driven categories. `refillCategory()` checks this flag to decide between static query vs taste-profile query.

### 1.3 Dynamic category generation

Add a function `regenerateDiscoveryCategories()` that:
1. Reads taste profile
2. Drops and recreates discovery categories with fresh queries based on current taste
3. Called on startup, and every 6 hours
4. Example: if user's top tags shift from ['tech', 'design'] to ['cooking', 'travel'], the "Because You Like..." row updates accordingly

---

## Phase 2: Multi-Platform Content Sources

### 2.1 Add platform-specific category seeds

Replace/augment the social category list. Target mix: ~40% YouTube, ~25% TikTok, ~20% Reddit, ~15% Instagram Reels.

**New TikTok categories:**

| Key | Label | Query |
|-----|-------|-------|
| `social_tiktok_trending` | TikTok Trending | `https://www.tiktok.com/explore` |
| `social_tiktok_tech` | TikTok Tech | `tiktoksearch:tech gadgets` (yt-dlp search prefix, if supported, else URL) |
| `social_tiktok_funny` | TikTok Funny | `https://www.tiktok.com/tag/funny` |
| `social_tiktok_cooking` | TikTok Recipes | `https://www.tiktok.com/tag/recipe` |

Note: yt-dlp TikTok support is flaky. `refillCategory()` should try yt-dlp first, fall back to Cobalt adapter for TikTok URLs. Add TikTok-specific error handling that doesn't spam logs when extraction fails (it will fail often).

**New Reddit categories (use `reddit_video_sources` tiers from JSON):**

| Key | Label | Query |
|-----|-------|-------|
| `social_reddit_viral` | Reddit Viral | `https://www.reddit.com/r/nextfuckinglevel/hot` |
| `social_reddit_satisfying` | Reddit Satisfying | `https://www.reddit.com/r/oddlysatisfying/hot` |
| `social_reddit_unexpected` | Reddit Unexpected | `https://www.reddit.com/r/Unexpected/hot` |
| `social_reddit_nfl` | Reddit NextLevel | `https://www.reddit.com/r/nextfuckinglevel/hot` |
| `social_reddit_funny` | Reddit Funny | `https://www.reddit.com/r/funny/hot` |
| `social_reddit_nature` | Reddit Nature | `https://www.reddit.com/r/natureismetal/hot` |
| `social_reddit_interesting` | Reddit Interesting | `https://www.reddit.com/r/Damnthatsinteresting/hot` |
| `social_reddit_freakout` | Reddit Freakout | `https://www.reddit.com/r/PublicFreakout/hot` |
| `social_reddit_aww` | Reddit Aww | `https://www.reddit.com/r/aww/hot` |
| `social_reddit_sports` | Reddit Sports | `https://www.reddit.com/r/sports/hot` |

Note: yt-dlp can extract video posts from Reddit. Non-video posts will return no results and should be skipped silently. Prioritize Tier 1 subs from `reddit_video_sources` in the JSON since they have the highest video density. Rotate through Tier 2 subs as discovery categories refresh.

**New Instagram Reels categories:**

| Key | Label | Query |
|-----|-------|-------|
| `social_reels_trending` | Reels Trending | `https://www.instagram.com/reels/` |
| `social_reels_explore` | Reels Explore | `https://www.instagram.com/explore/` |

Note: Instagram extraction is the flakiest of all platforms. yt-dlp and Cobalt both struggle. This will likely need cookies AND may still fail. Add these categories but mark them lower priority in sort_order so they don't block the page if they fail. Consider a `reliability` column on categories so the UI can skip empty categories gracefully.

### 2.2 Update refillCategory() for multi-platform routing

Current logic in `refillCategory()` only has two paths: NSFW+URL → scraper, everything else → yt-dlp. Expand:

```javascript
async function refillCategory(categoryKey) {
  const cat = db.prepare('SELECT * FROM categories WHERE key = ?').get(categoryKey)
  if (!cat) return

  let query = cat.query

  // Taste-driven query building for discovery categories
  if (cat.discovery) {
    query = buildDiscoveryQuery(cat, getTasteProfile())
  }

  // Platform-aware routing
  const domain = query.startsWith('http') ? new URL(query).hostname.replace(/^www\./, '') : null

  let videos = []
  try {
    if (domain?.includes('tiktok.com')) {
      // TikTok: try yt-dlp, fall back to cobalt
      videos = await registry.search(query, { adapter: 'yt-dlp', limit: 12 })
      if (videos.length === 0) {
        videos = await registry.search(query, { adapter: 'cobalt', limit: 12 })
      }
    } else if (domain?.includes('instagram.com')) {
      // Instagram: try cobalt first (better success rate), fall back to yt-dlp
      videos = await registry.search(query, { adapter: 'cobalt', limit: 12 })
      if (videos.length === 0) {
        videos = await registry.search(query, { adapter: 'yt-dlp', limit: 12 })
      }
    } else if (domain?.includes('reddit.com')) {
      // Reddit: yt-dlp handles this well
      videos = await registry.search(query, { adapter: 'yt-dlp', limit: 12 })
    } else if (cat.mode === 'nsfw' && query.startsWith('http')) {
      // NSFW: existing logic (scraper → yt-dlp)
      videos = await registry.search(query, { site: domain, limit: 12 })
    } else {
      // YouTube / yt-dlp search strings
      videos = await registry.search(query, { adapter: 'yt-dlp', limit: 12 })
    }
  } catch (err) {
    logger.error(`Refill failed for ${categoryKey}:`, { error: err.message })
  }

  // ... existing insert logic
}
```

### 2.3 Add source_platform to homepage_cache

Add a `source_platform` column to `homepage_cache` (values: 'youtube', 'tiktok', 'reddit', 'instagram', 'unknown'). Derive from URL domain at insert time. This enables:
- Frontend platform badges on video cards (small icon overlay)
- Analytics on platform mix
- Future: user preference for platform weighting on homepage

### 2.4 Frontend: platform badges on VideoCard

Add a small platform icon (YouTube, TikTok, Reddit, Instagram logo) to the bottom-right corner of each `VideoCard` in `CategoryRow`. Use the `source` or `source_platform` field. Simple SVG icons, ~16px, semi-transparent. Helps users understand the content mix at a glance.

---

## Phase 3: Feed Source Diversification

### 3.1 Update feed_cache refill to pull from all platforms

The `_refillFeedCacheImpl()` function (or equivalent background job) currently seeds `feed_cache` from the `sources` table. The sources table already has youtube.com, tiktok.com, reddit.com for social mode, but the actual fetch queries need to be taste-aware.

Modify the feed refill to:
1. For each active source domain, build queries from taste profile (not hardcoded)
2. For TikTok: search for content matching user's top tags
3. For Reddit: pull from subreddits matching user's interests (map tags → subreddit names where possible)
4. For Instagram: try reels search if cookies available

### 3.2 Source weight auto-adjustment

Currently source weights only change via manual "boost" / "hide" actions. Add passive weight adjustment:
- Track watch-through rate per source_domain in feed
- Sources with higher completion rates get slight weight boost (+0.1 per completed video, cap at 2.0)
- Sources user frequently skips get slight weight decrease (-0.05 per skip, floor at 0.3)
- Reset weights daily to prevent runaway drift

---

## Phase 4: Homepage UI Polish

### 4.1 "For You" row prominence

The taste-driven "For You" row should be the FIRST row after the hero, not buried. Update sort_order so `social_foryou` is position 0 (or 1, after subscriptions if cookies are present).

### 4.2 Category row labels with context

For discovery rows, show context: "Because you watch {uploader}" or "Because you like {tag}". Store the reasoning in a `reason` column on homepage_cache or pass it through from the discovery query builder.

### 4.3 Empty category handling

Categories that fail to fetch (especially TikTok/Instagram) should be hidden, not shown as empty rows. Add a check in the `GET /api/homepage` response: skip categories with 0 videos.

---

## Implementation Order (for Claude Code)

1. **Phase 0.1** — DB migrations: `subscriptions`, `interest_categories` tables + `discovery` and `source_platform` columns on `categories` and `homepage_cache`
2. **Phase 0.1** — Load `data/youtube-subscriptions.json` on startup, seed tables
3. **Phase 1.1** — `server/discovery.js` taste profile utility (reads from new tables + existing tag_preferences/history)
4. **Phase 2.1** — Seed new multi-platform categories (replace generic YouTube-only seeds with taste-driven, multi-platform categories)
5. **Phase 2.2** — Update `refillCategory()` with platform-aware routing (TikTok → cobalt fallback, Instagram → cobalt first, Reddit → yt-dlp)
6. **Phase 1.2** — Wire discovery categories to taste profile in refillCategory
7. **Phase 1.3** — `regenerateDiscoveryCategories()` on startup + 6hr interval
8. **Phase 2.3** — Add `source_platform` derivation at insert time in homepage_cache
9. **Phase 3.1** — Feed cache refill taste-awareness
10. **Phase 4.1-4.3** — Frontend polish (platform badges, row ordering, empty state, "Because you like X" labels)
11. **Phase 3.2** — Passive source weight adjustment (lower priority, do last)

## Notes for Claude Code

- The `categories` table is seeded once on first DB creation. You'll need an `ALTER TABLE` migration path for existing databases (add columns, insert new categories without wiping existing data).
- yt-dlp TikTok and Instagram extraction WILL fail frequently. Design for graceful degradation. Log at `warn` level, not `error`.
- The Cobalt adapter (`server/sources/cobalt.js`) exists but check if it actually works for TikTok/Instagram search/discovery (not just single-URL extraction).
- Don't break NSFW mode. All changes should be gated to `mode = 'social'` categories.
- Test with `node -e "import('./server/discovery.js').then(m => m.getTasteProfile().then(console.log))"` to verify taste profile before wiring it into refill.
