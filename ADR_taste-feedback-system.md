# ADR: FeedDeck Taste Feedback & Adaptive Ranking System

**Status:** Proposed  
**Date:** 2026-04-15  
**Deciders:** Torin

## Context

FeedDeck currently has basic ranking: tag affinity scoring in `homeStore.js`, weighted random selection in `feed.js`, and a `tag_preferences` table. But there's no way to give direct feedback on individual videos, no creator-level boosting, and no mechanism to retrain a row on the fly when the content is bad. You're stuck watching garbage scroll by with no recourse.

## Decision

Two-step feedback system that feeds a **multi-signal taste profile** stored server-side, with scoring applied at every content surface.

---

## Architecture Overview

### New Database Tables

**`video_ratings`** - Individual thumbs up/down on any video, anywhere in the app.

| Column | Type | Purpose |
|--------|------|---------|
| id | INTEGER PK | Auto |
| video_url | TEXT | The rated video's URL (universal key) |
| surface_type | TEXT | 'home_row', 'feed_tab', 'discover', etc. |
| surface_key | TEXT | Category key or feed name where rating happened |
| rating | TEXT | 'up' or 'down' |
| tags | TEXT (JSON) | Snapshot of the video's tags at time of rating |
| creator | TEXT | Uploader/channel name |
| rated_at | DATETIME | Timestamp (needed for decay) |

**`creator_boosts`** - Tracks creator-level affinity derived from thumbs-up.

| Column | Type | Purpose |
|--------|------|---------|
| creator | TEXT PK | Channel/uploader name |
| boost_score | REAL | Accumulated boost (starts at 0.25 per like, decays) |
| surface_boosts | TEXT (JSON) | Per-surface extra boost map, e.g. `{"trending": 0.5}` |
| last_updated | DATETIME | For decay calculation |

**`taste_profile`** - Aggregated multi-signal preference weights, rebuilt periodically.

| Column | Type | Purpose |
|--------|------|---------|
| signal_type | TEXT | 'tag', 'creator', 'duration_range', 'source_domain' |
| signal_value | TEXT | The specific tag/creator/range/domain |
| weight | REAL | -1.0 to +1.0 normalized score |
| surface_key | TEXT | NULL = global, otherwise surface-specific |
| updated_at | DATETIME | For decay |

This replaces the current `tag_preferences` table's role (we'd migrate existing data into `taste_profile`).

### Decay Model

60-day half-life. Every time scoring runs, each signal's effective weight is:

```
effective = weight * (0.5 ^ (days_since_update / 60))
```

At weekly usage that means a signal retains ~92% of its weight between sessions, and still has ~25% strength after 4 months of no reinforcement.

### Scoring Formula (Unified)

Every video gets scored the same way everywhere. The current scattered scoring (different logic in `feed.js` vs `homeStore.js`) gets consolidated into one server-side function:

```
base_score = natural_score (view_count, recency, source_weight)

tag_score = sum(taste_profile weights for matching tags)
creator_score = creator_boosts.boost_score (0.25 per like, decayed)

// Surface-specific layer
surface_tag_score = sum(taste_profile weights WHERE surface_key = current_surface)
surface_creator_score = creator_boosts.surface_boosts[current_surface] (extra 0.25)

final_score = base_score
  * (1 + tag_score)           // global tag affinity
  * (1 + creator_score)       // global creator boost (25%)
  * (1 + surface_tag_score)   // surface-specific tag boost
  * (1 + surface_creator_score) // surface-specific creator boost (extra 25%)
```

Score clamped to max 5x base_score to prevent runaway inflation and maintain content diversity.

On a thumbs-down, the video's tags get negative weight, the creator gets a negative surface boost, and the video itself gets excluded from that surface.

---

## Step 1: Thumbs Up/Down

### Frontend

**New component: `ThumbsRating.jsx`**
Overlay on hover (desktop) or long-press (mobile) on any card in GalleryRow, feed swipe, etc. Two buttons: thumbs up, thumbs down. Appears on the card itself, not in a modal.

**On thumbs-down:**
1. POST `/api/ratings` with video URL, surface info, rating='down'
2. Card does a 0.3s shrink animation, slides out, replaced by a new video fetched from the backend
3. **Row-level tracker** (client-side, in a new `ratingsStore.js`): tracks consecutive downs per row and downs-within-30s per row

**4+ consecutive downs on same row:**
- Triggers `POST /api/ratings/row-refresh?surface_key=X` which returns a full replacement set
- Row does a staggered fade-swap: old cards fade out left-to-right (50ms stagger), new cards fade in
- Consecutive-down counter resets after row-refresh to give fresh content a fair evaluation window

**On thumbs-up:**
1. POST `/api/ratings` with rating='up'
2. Brief pulse animation on the card (confirm feedback registered)
3. Creator auto-boosted: server adds 0.25 global + 0.25 surface boost to `creator_boosts`
4. Toast: "Saved. More from [creator] coming your way." (auto-dismiss 3s)
5. Video added to "Liked" section if not already in library

### Backend

**New route file: `server/routes/ratings.js`**

- `POST /api/ratings` - Record a rating, update `taste_profile` and `creator_boosts`
- `POST /api/ratings/row-refresh` - Re-score and return fresh videos for a row, excluding all downvoted URLs
- `POST /api/ratings/row-preferences` - Save keyword overrides for a row
- `GET /api/ratings/history` - Optional, for a future "your ratings" view

---

## Step 2: Enhanced Feedback Loop

### Rapid-Dislike Toast (2+ downs in 30s on same row)

**Trigger:** `ratingsStore.js` detects 2+ thumbs-down within 30 seconds on the same row.

**Toast (enhanced):** Current toast system upgraded with:
- Action button support ("Help me fix this row")
- Configurable dismiss timeout (8s for feedback toasts)
- "Pause toasts for 1 hour" option (see Toast Throttling below)

**On CTA click:** Opens a lightweight inline panel anchored to the row. Contains:
- Text input with autocomplete for up to 5 search terms, keywords, or tags
- "Apply" button

**On apply:**
1. POST `/api/ratings/row-preferences` with `surface_key` + the 5 keywords
2. Server runs a targeted search/fetch using those keywords (same pipeline as existing `/api/search/multi`)
3. New videos lazy-load into the row one at a time (staggered 200ms), pushing old unwatched content out from the right
4. Keywords saved to `taste_profile` with `surface_key` for that row, so future loads reflect them

### Liked Section

Videos rated thumbs-up are accessible via a "Liked" virtual shelf in the library, backed by `video_ratings WHERE rating='up'`. No duplicate storage needed.

---

## Toast Throttling

Both thumbs-up and thumbs-down toasts follow the same fatigue rules:

- **1st toast in session:** Shows normally
- **2nd toast in session:** Shows with additional "Pause toasts for 1 hour" dismiss option
- **After pause activated:** All rating-related toasts suppressed for 60 minutes
- Timer stored client-side in `ratingsStore.js`, resets on page reload
- Max 1 enhanced feedback toast (the "help fix this row" CTA) per 60 seconds globally

---

## Migration Path

1. **`tag_preferences` table** stays for now but `taste_profile` becomes the primary scoring input. Migrate existing liked/disliked tags into `taste_profile` with `signal_type='tag'` and `surface_key=NULL` (global).
2. **`homeStore.js` scoring** gets replaced by a server call. Move personalization logic out of the client. The store just receives pre-scored, sorted results.
3. **`feed.js` weighted selection** incorporates `taste_profile` scores into its weight calculation instead of the current simple tag multiplier.
4. **Toast system** gets upgraded to support action buttons and configurable timeouts.

---

## Risks & Mitigations

**Negative feedback spiral:** If you thumbs-down aggressively on a row, the replacement content also scores poorly (because the row's category is inherently misaligned). Mitigation: The keyword override in Step 2 is the escape valve. After a row-refresh, consecutive-down counter resets.

**Score explosion:** Multiplicative boosts can compound. A video matching 5 liked tags + liked creator + surface boost could score 10x a neutral video. Mitigation: Clamp `final_score` to max 5x `base_score` to keep diversity.

**Row refresh latency:** Fetching fresh content means hitting yt-dlp or adapters, which can be slow. Mitigation: Pull from the existing `homepage_cache` overflow (unviewed items) first, backfill async.

**Toast fatigue:** Handled by the throttling system above. User controls when toasts pause, applies to both up and down feedback.

---

## Implementation Order

1. Database tables + migration (taste_profile, video_ratings, creator_boosts)
2. Unified scoring function on the server (consolidate feed.js + homeStore.js scoring)
3. `POST /api/ratings` endpoint + `ratingsStore.js` on client
4. `ThumbsRating.jsx` component + card animations
5. Toast system upgrade (action buttons, configurable timeout, pause option)
6. Row refresh endpoint + lazy-load swap animation
7. Step 2 enhanced feedback panel (keyword input, row-level preferences)
8. Liked section in library
9. Decay calculation in scoring function
10. Score clamping + toast throttling safety rails

Steps 1-4 are the MVP. Steps 5-7 are the "make it smart" layer. Steps 8-10 are polish and guardrails.

---

## Consequences

**What gets easier:** Content quality improves with every session. Bad content gets killed fast. Good creators surface across the app.

**What gets harder:** Debugging "why is this video showing?" becomes non-trivial with multiplicative scoring. Recommendation: add a debug overlay (dev mode only) showing score breakdown on hover.

**What we'll revisit:** The 60-day half-life is a starting guess. After a few weeks of use, may want to tune based on how fast the taste profile drifts vs. stabilizes.
