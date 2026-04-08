# Real Homepage Content — Design Spec

**Date:** 2026-03-24
**Status:** Draft

## Problem

Both SFW and NSFW homepages fall back to placeholder data (dog-themed random content from `homeStore.js`). The infrastructure for real content exists (yt-dlp, categories table, homepage_cache, refill logic) but the category seeds are too generic ("trending videos", "most viewed this week") and produce poor results. The scheduled trending refresh only targets NSFW sites.

## Solution

Replace the 4 generic SFW + 4 generic NSFW category seeds with curated categories, each backed by a large pool of specific YouTube search queries (SFW) and site-specific queries (NSFW). Add query rotation so each refill cycle picks a different query from the pool, producing diverse content over time. Trigger an initial population on first boot so users don't see placeholders.

## Architecture

### Schema Change: `query` column → pipe-delimited query pool

The `categories.query` column currently holds a single search string. Change it to hold **multiple queries separated by `|`** (pipe). Example:

```
"SNL best sketches|SNL weekend update|Saturday Night Live cold open"
```

`refillCategory()` picks one at random each time it runs. No schema migration needed — the column is already TEXT.

### Category Definitions

#### SFW Categories (mode: `social`)

| key | label | sort_order | queries |
|-----|-------|------------|---------|
| `social-trending` | Trending Now | 0 | `trending youtube\|viral videos this week\|most watched youtube today\|youtube trending music\|trending shorts\|viral moments caught on camera\|best of youtube this week\|most popular videos right now` |
| `social-comedy` | Comedy & Entertainment | 1 | `SNL best sketches\|SNL weekend update\|Saturday Night Live cold open\|MrBeast newest video\|MrBeast challenge\|pop the balloon dating show\|comedy sketches funny\|stand up comedy clips\|funny moments compilation\|impractical jokers best moments\|Key and Peele sketches\|Trevor Noah comedy\|John Mulaney clips\|Conan O'Brien remotes` |
| `social-music` | Music & DJ Sets | 2 | `music videos official\|new music releases this week\|DJ set live festival\|Boiler Room DJ set\|house music mix\|techno DJ set live\|hip hop music videos new\|pop music videos trending\|live concert footage\|NPR Tiny Desk concert\|Colors show music\|acoustic sessions live` |
| `social-analysis` | Deep Dives & Analysis | 3 | `Lex Fridman clips\|Lex Fridman best moments\|Survivor analysis breakdown\|Survivor strategy explained\|political analysis\|geopolitical analysis\|deep dive documentary\|video essay\|explained documentary\|Joe Rogan best clips\|Jordan Peterson lectures\|Naval Ravikant wisdom` |
| `social-news` | News & Journalism | 4 | `Channel 5 with Andrew Callaghan\|Channel 5 news new\|VICE News documentary\|VICE news\|Tommy G documentary\|Tommy G new video\|Insider documentary\|Insider investigative\|60 Minutes segments\|real stories documentary\|independent journalism\|frontline documentary\|WIRED videos` |
| `social-tech` | Tech & Science | 5 | `tech reviews\|military technology explained\|war tech documentary\|new technology gadgets\|MKBHD review\|Linus Tech Tips\|Veritasium science\|Kurzgesagt new\|Mark Rober invention\|engineering explained\|AI technology\|space technology news\|Smarter Every Day\|Tom Scott` |
| `social-creators` | Creator Spotlight | 6 | `Chris James music\|Chris James newest\|MrBeast latest\|Insider youtube documentary\|Yes Theory adventure\|Casey Neistat vlog\|Peter McKinnon\|Johnny Harris explained\|Wendover Productions\|Real Engineering\|Bald and Bankrupt\|GeoWizard\|JiDion\|IShowSpeed highlights\|Kai Cenat stream highlights` |
| `social-picks` | Staff Picks | 7 | `best youtube videos\|most satisfying videos\|hidden gem youtube channels\|underrated youtube videos\|youtube recommendations\|best short films youtube\|incredible footage caught on camera\|mind blowing videos\|best of internet\|award winning short film` |

#### NSFW Categories (mode: `nsfw`)

| key | label | sort_order | queries |
|-----|-------|------------|---------|
| `nsfw-trending` | Trending Now | 0 | `trending\|most viewed today\|hot videos today\|popular right now\|top rated today\|best videos today\|featured today` |
| `nsfw-popular` | Most Popular | 1 | `most viewed\|most viewed this week\|most viewed this month\|top rated\|best rated all time\|highest rated\|all time best` |
| `nsfw-amateur` | Amateur & Homemade | 2 | `amateur\|homemade\|real couple\|amateur verified\|home video\|amateur compilation\|verified amateur\|real amateur` |
| `nsfw-milf` | MILF | 3 | `milf\|mature\|milf pov\|step mom\|cougar\|milf compilation\|hot milf\|milf hd` |
| `nsfw-teen` | Young Adults (18+) | 4 | `18+ teen\|college\|young adult\|barely legal\|petite\|college girls\|18 year old\|university` |
| `nsfw-pov` | POV | 5 | `pov\|pov blowjob\|pov sex\|first person\|pov compilation\|pov hd\|amateur pov\|pov 4k` |
| `nsfw-lesbian` | Lesbian | 6 | `lesbian\|girl on girl\|lesbian hd\|lesbian scissoring\|lesbian compilation\|lesbian massage\|lesbian strap on\|lesbian first time` |
| `nsfw-threesome` | Threesome & Group | 7 | `threesome\|group\|ffm\|mmf\|orgy\|gangbang\|double\|three way` |
| `nsfw-bigass` | Big Ass & Curves | 8 | `big ass\|thick\|big booty\|pawg\|curvy\|bubble butt\|twerk\|ass worship` |
| `nsfw-blowjob` | Blowjob | 9 | `blowjob\|deepthroat\|oral\|blowjob compilation\|sloppy blowjob\|throat\|blowjob pov\|cum in mouth` |
| `nsfw-anal` | Anal | 10 | `anal\|anal sex\|first anal\|anal creampie\|anal compilation\|ass fuck\|anal hd\|anal pov` |
| `nsfw-picks` | Editor's Picks | 11 | `best rated\|award winning\|top rated all time\|most favorited\|highest quality\|premium\|best ever` |

#### Feed Sources (mode-specific)

| domain | mode | label | query | weight |
|--------|------|-------|-------|--------|
| `youtube.com` | social | YouTube | `ytsearch20:viral shorts\|ytsearch20:trending youtube shorts\|ytsearch20:best short videos\|ytsearch20:funny shorts compilation` | 1.0 |
| `tiktok.com` | social | TikTok | `ytsearch20:tiktok compilation funny\|ytsearch20:best tiktoks this week\|ytsearch20:viral tiktok` | 0.8 |
| `pornhub.com` | nsfw | PornHub | `trending` | 1.0 |
| `xvideos.com` | nsfw | XVideos | `best` | 0.8 |
| `spankbang.com` | nsfw | SpankBang | `trending_videos` | 0.6 |

**Note:** Feed source queries do NOT use pipe-delimited rotation. Only the `categories` table uses query rotation. Feed sources keep single queries since `startScheduledFeedRefill()` has its own refill path.

### Code Changes

#### 1. `server/database.js` — New category and source seeds + migration

Replace the existing 8 category seeds and 3 source seeds with the tables above.

**Migration for existing databases:** Detect by checking for the presence of new category keys rather than matching old query strings (more robust):

```js
// Detect old/missing seeds and replace with curated ones
const hasNewSeeds = db.prepare(
  "SELECT COUNT(*) as n FROM categories WHERE key = 'social-comedy'"
).get()
if (hasNewSeeds.n === 0) {
  // Clean up orphaned cache rows before deleting categories
  db.exec("DELETE FROM homepage_cache")
  db.exec("DELETE FROM categories")
  // Re-seed with curated categories (same INSERT loop as initial seed)
}

// Migrate sources: add new NSFW sources if missing
const hasXvideos = db.prepare(
  "SELECT COUNT(*) as n FROM sources WHERE domain = 'xvideos.com'"
).get()
if (hasXvideos.n === 0) {
  const insertSrc = db.prepare('INSERT OR IGNORE INTO sources (domain, mode, label, query, weight) VALUES (?, ?, ?, ?, ?)')
  insertSrc.run('xvideos.com', 'nsfw', 'XVideos', 'best', 0.8)
  insertSrc.run('spankbang.com', 'nsfw', 'SpankBang', 'trending_videos', 0.6)
}
```

**Note:** `homepage_cache` has a `FOREIGN KEY (category_key) REFERENCES categories(key)` but SQLite does not enforce FKs by default (`PRAGMA foreign_keys` is not enabled in the codebase). The explicit `DELETE FROM homepage_cache` before `DELETE FROM categories` prevents orphaned rows.

#### 2. `server/index.js` — Query rotation in `refillCategory()`

Modify `refillCategory()` to split the query pool FIRST, pick one at random, THEN append personalization tags. The ordering matters — the existing personalization code at lines 1283-1291 uses `cat.query` directly, which would be the full pipe-delimited string. The implementation must be:

```js
// 1. Split pipe-delimited query pool and pick one at random
const queries = cat.query.split('|')
let query = queries[Math.floor(Math.random() * queries.length)]

// 2. THEN append personalization tags (after picking a single query)
try {
  const likedTags = db.prepare(
    "SELECT tag FROM tag_preferences WHERE preference = 'liked' ORDER BY RANDOM() LIMIT 2"
  ).all().map(r => r.tag)
  if (likedTags.length > 0) {
    query = `${query} ${likedTags.join(' ')}`
  }
} catch {}
```

#### 3. `server/index.js` — SFW scheduled refresh

Update `startScheduledTrendingRefresh()` to also refill one SFW category per interval tick using round-robin (consistent with the existing NSFW site rotation pattern):

```js
// Add SFW category rotation alongside existing NSFW site rotation
const sfwCategories = db.prepare("SELECT key FROM categories WHERE mode = 'social'").all()
let sfwCatIndex = 0

// Inside the existing setInterval callback, after NSFW refresh:
const sfwCat = sfwCategories[sfwCatIndex % sfwCategories.length]
sfwCatIndex++
refillCategory(sfwCat.key).catch(err =>
  logger.error(`SFW refresh error (${sfwCat.key}):`, err.message)
)
```

#### 4. `server/index.js` — First-boot population (throttled)

After `app.listen()`, add a one-time check. Process categories **sequentially** (not concurrently) to avoid overwhelming yt-dlp and triggering YouTube rate limits. With 20 categories, sequential execution at ~30s each = ~10 minutes for full population, which is acceptable for a one-time boot event.

```js
// One-time first-boot population (sequential to avoid rate limiting)
const cacheCount = db.prepare('SELECT COUNT(*) as n FROM homepage_cache').get()
if (cacheCount.n === 0) {
  logger.info('First boot: populating homepage cache...')
  const allCats = db.prepare('SELECT key FROM categories').all()
  ;(async () => {
    for (const cat of allCats) {
      try {
        await refillCategory(cat.key)
      } catch (err) {
        logger.error(`First boot refill error (${cat.key}):`, { error: err.message })
      }
    }
    logger.info('First boot: homepage cache population complete')
  })()
}
```

#### 5. `server/index.js` — NSFW refill site rotation

Currently `refillCategory()` hardcodes `site: 'pornhub.com'` for NSFW queries. Change to rotate through all supported NSFW sites using round-robin (not random, for even distribution):

```js
const nsfwSites = ['pornhub.com', 'xvideos.com', 'spankbang.com']
let _nsfwSiteIdx = 0
// Inside refillCategory():
const site = cat.mode === 'nsfw'
  ? nsfwSites[_nsfwSiteIdx++ % nsfwSites.length]
  : undefined
```

### What Does NOT Change

- All existing homepage UI components (hero, featured, category rows)
- The `/api/homepage` endpoint response shape
- The `homeStore.js` fallback logic (still works if cache is empty)
- Feed page content flow
- Database schema (no new columns/tables)
- The refill threshold (< 8 videos triggers refill)
- Feed source refill path (no query rotation for sources table)

### Testing

1. Delete existing `data/library.db` to test fresh boot population
2. Verify server startup triggers sequential refill for all categories (check logs)
3. Confirm `/api/homepage?mode=social` returns real YouTube content within ~2 min
4. Confirm `/api/homepage?mode=nsfw` returns real content from multiple sites
5. Verify query rotation: multiple refill cycles produce different content
6. ESLint pass, build pass, no new warnings
7. **Error paths:** verify graceful fallback to placeholders when yt-dlp is unavailable
8. **Migration:** with an existing DB containing old seeds, verify categories are replaced and homepage_cache is cleaned
