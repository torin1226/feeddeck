# FeedDeck Content Pipeline: Query Reference

> Single source of truth for all content source URLs and search queries.
> Cookie files stored at: `feeddeck/cookies/`
>
> | File | Mode | Sites |
> |------|------|-------|
> | `youtube.txt` | Social | youtube.com, youtu.be |
> | `tiktok.txt` | Social | tiktok.com |
> | `fikfap.txt` | NSFW | fikfap.com (Cloudflare clearance only) |
> | `redgifs.txt` | NSFW | redgifs.com (logged in as tonjone92) |
> | `--cookies-from-browser arc` | NSFW | pornhub.com, xvideos.com, spankbang.com, redtube.com |

---

## How This Works

yt-dlp can pull from three types of URLs:

1. **Search queries** — `ytsearch10:funny cats` or site-specific search URLs
2. **Feed/page URLs** — trending pages, category indexes, recommendation feeds
3. **Channel/user URLs** — specific creators' upload pages

Authenticated (cookie) requests unlock personalized feeds, subscriptions, and age-restricted content. Without cookies you only get public/generic results.

---

## NSFW Mode (Arc Cookies)

### Tier 1: Authenticated Feed URLs (Best Quality)

These require cookies. They're pre-curated by the platform's algorithm based on your watch history.

```
# Pornhub — Personalized
https://www.pornhub.com/recommended
https://www.pornhub.com/subscriptions
https://www.pornhub.com/video?o=tr                    # Trending (today)
https://www.pornhub.com/video?o=tr&t=w                # Trending (this week)
https://www.pornhub.com/video?o=mv                    # Most viewed (today)
https://www.pornhub.com/video?o=mv&t=w                # Most viewed (this week)
https://www.pornhub.com/video?o=ht                    # Hottest (rating)
https://www.pornhub.com/categories                     # Category index (for discovery)

# Pornhub — Premium (if subscribed)
https://www.pornhub.com/premium
https://www.pornhub.com/premium/recommended

# XVideos — Personalized (if logged in on Arc)
https://www.xvideos.com/best
https://www.xvideos.com/new
https://www.xvideos.com/hits
https://www.xvideos.com/profiles
https://www.xvideos.com/?quality=hd

# SpankBang
https://spankbang.com/trending
https://spankbang.com/new_videos
https://spankbang.com/most_popular
https://spankbang.com/upcoming

# RedTube
https://www.redtube.com/?order=newest
https://www.redtube.com/?order=mostviewed
https://www.redtube.com/?order=rating

# XNXX
https://www.xnxx.com/best
https://www.xnxx.com/hits
https://www.xnxx.com/todays-selection

# RedGifs — Logged in (cookie: redgifs.txt)
# Primary short-form NSFW source. Most Reddit NSFW content hosts here.
https://www.redgifs.com/trending
https://www.redgifs.com/trending?type=g             # GIFs/clips only
https://www.redgifs.com/creators                    # Top creators
https://www.redgifs.com/search?query=amateur        # Search (authenticated = better results)
https://www.redgifs.com/search?query=homemade
https://www.redgifs.com/search?query=couple
https://www.redgifs.com/search?query=solo
https://www.redgifs.com/search?query=pov

# FikFap — Aggregator (cookie: fikfap.txt, CF clearance only)
# Pulls from RedGifs + other sources. TikTok-style vertical feed.
https://fikfap.com/trending
https://fikfap.com/new
https://fikfap.com/top
```

### Tier 2: Category/Tag Search Queries

These work with or without cookies. Use as `category` entries in the categories table.

**Format:** Each entry = a URL or yt-dlp search string that returns a list of videos.

```
# Pornhub — Categories (append to https://www.pornhub.com/categories/)
amateur
pov
solo
compilation
hd-porn
popular-with-women
verified-amateurs
verified-models
exclusive
behind-the-scenes
60fps

# Pornhub — Search URLs (more specific than categories)
https://www.pornhub.com/video/search?search=amateur+homemade
https://www.pornhub.com/video/search?search=pov
https://www.pornhub.com/video/search?search=solo
https://www.pornhub.com/video/search?search=compilation
https://www.pornhub.com/video/search?search=massage
https://www.pornhub.com/video/search?search=romantic
https://www.pornhub.com/video/search?search=sensual
https://www.pornhub.com/video/search?search=passionate
https://www.pornhub.com/video/search?search=caught
https://www.pornhub.com/video/search?search=real+couple
https://www.pornhub.com/video/search?search=first+time
https://www.pornhub.com/video/search?search=candid
https://www.pornhub.com/video/search?search=casting
https://www.pornhub.com/video/search?search=gf
https://www.pornhub.com/video/search?search=college
https://www.pornhub.com/video/search?search=shower
https://www.pornhub.com/video/search?search=cosplay
https://www.pornhub.com/video/search?search=fit
https://www.pornhub.com/video/search?search=yoga
https://www.pornhub.com/video/search?search=asmr
https://www.pornhub.com/video/search?search=close+up

# Pornhub — Search with filters (quality + duration)
# Append &hd=1 for HD only, &min_duration=10&max_duration=30 for 10-30min
https://www.pornhub.com/video/search?search=amateur&hd=1&o=tr
https://www.pornhub.com/video/search?search=pov&hd=1&o=mv
https://www.pornhub.com/video/search?search=homemade&hd=1&min_duration=5&max_duration=20
```

### Tier 3: Creator/Channel Pages

Bookmark specific uploaders whose content you like. These are gold for consistent quality.

```
# Pornhub model/channel pages (replace USERNAME)
https://www.pornhub.com/model/USERNAME/videos
https://www.pornhub.com/channels/CHANNELNAME/videos
https://www.pornhub.com/pornstar/NAME/videos?o=mv

# XVideos profiles
https://www.xvideos.com/profiles/USERNAME

# SpankBang profiles  
https://spankbang.com/profile/USERNAME/videos
```

### Tier 3b: Short-Form NSFW (for Feed/Swipe mode)

```
# RedGifs — THE primary short-form source (cookie: redgifs.txt)
# Most clips are 10-60 seconds, perfect for swipe feed
https://www.redgifs.com/trending
https://www.redgifs.com/trending?type=g
https://www.redgifs.com/search?query=amateur&order=trending
https://www.redgifs.com/search?query=homemade&order=trending
https://www.redgifs.com/search?query=pov&order=trending
https://www.redgifs.com/search?query=couple&order=trending

# FikFap — Aggregator with TikTok-style UI (cookie: fikfap.txt)
https://fikfap.com/trending
https://fikfap.com/new
https://fikfap.com/top

# Pornhub — short videos only
https://www.pornhub.com/video/search?search=amateur&max_duration=5&o=tr
https://www.pornhub.com/video/search?search=compilation&max_duration=5&o=mv
https://www.pornhub.com/video/search?search=tiktok&max_duration=5
https://www.pornhub.com/video/search?search=vertical&max_duration=5
https://www.pornhub.com/video/search?search=shorts&max_duration=5
```

---

## Social Mode (Chrome Cookies)

### Tier 1: Authenticated Feed URLs (Best Quality)

These pull from your logged-in YouTube/social accounts via Chrome cookies.

```
# YouTube — Personalized
https://www.youtube.com/feed/subscriptions           # Your subscriptions
https://www.youtube.com/feed/trending                # Trending
https://www.youtube.com/feed/trending?bp=6gQJRkVleHBsb3Jl  # Trending Explore
https://www.youtube.com/shorts                       # Shorts feed
https://www.youtube.com/feed/history                 # Watch history (for seeding recs)
https://www.youtube.com/playlist?list=WL             # Watch Later
https://www.youtube.com/playlist?list=LL             # Liked videos

# YouTube — Trending by category
https://www.youtube.com/feed/trending?bp=4gINGgt2aWRlb3M%3D    # Trending Music
https://www.youtube.com/feed/trending?bp=4gIcGhpnYW1pbmc%3D    # Trending Gaming
https://www.youtube.com/feed/trending?bp=4gIKGgh0cmVuZGluZw%3D # Trending Now

# Reddit — video-heavy subreddits (yt-dlp supports reddit)
https://www.reddit.com/r/videos/hot
https://www.reddit.com/r/Unexpected/hot
https://www.reddit.com/r/interestingasfuck/hot
https://www.reddit.com/r/nextfuckinglevel/hot
https://www.reddit.com/r/oddlysatisfying/hot
https://www.reddit.com/r/PublicFreakout/hot
https://www.reddit.com/r/TikTokCringe/hot
https://www.reddit.com/r/ContagiousLaughter/hot
https://www.reddit.com/r/MadeMeSmile/hot
https://www.reddit.com/r/Damnthatsinteresting/hot
https://www.reddit.com/r/BeAmazed/hot
https://www.reddit.com/r/ThatsInsane/hot

# TikTok (requires Chrome cookies, often finicky)
https://www.tiktok.com/foryou
https://www.tiktok.com/trending
```

### Tier 2: YouTube Search Queries

Use yt-dlp's built-in YouTube search: `ytsearch10:QUERY` returns 10 results.

**Entertainment & Viral**
```
ytsearch10:viral videos this week
ytsearch10:best fails compilation 2026
ytsearch10:instant karma caught on camera
ytsearch10:people are awesome compilation
ytsearch10:satisfying videos to watch
ytsearch10:unexpected plot twist short
ytsearch10:street performer amazing talent
ytsearch10:caught on security camera
ytsearch10:one in a million moments
ytsearch10:try not to laugh challenge
```

**Tech & Design**
```
ytsearch10:best new gadgets 2026
ytsearch10:UI design tips
ytsearch10:figma tutorial advanced
ytsearch10:web design trends 2026
ytsearch10:AI tools for designers
ytsearch10:product design process
ytsearch10:design system breakdown
ytsearch10:coding project walkthrough
ytsearch10:home office setup tour
ytsearch10:mechanical keyboard build
```

**Lifestyle & Culture**
```
ytsearch10:day in the life designer
ytsearch10:studio apartment tour
ytsearch10:city walking tour 4K
ytsearch10:street food tour
ytsearch10:best coffee shops world
ytsearch10:minimalist home tour
ytsearch10:cooking ASMR
ytsearch10:thrift flip transformation
ytsearch10:sneaker collection tour
ytsearch10:vinyl record collection
```

**Music & Audio**
```
ytsearch10:tiny desk concert 2026
ytsearch10:live looping performance
ytsearch10:street musician incredible
ytsearch10:guitar cover trending
ytsearch10:chill beats study
ytsearch10:jazz cafe ambience
ytsearch10:album reaction first listen
```

**Science & Nature**
```
ytsearch10:nature documentary short
ytsearch10:space news this week
ytsearch10:ocean exploration footage
ytsearch10:slow motion nature
ytsearch10:timelapse city
ytsearch10:wildlife caught on camera
ytsearch10:how it's made 2026
```

**Sports & Fitness**
```
ytsearch10:best highlights this week NBA
ytsearch10:gym transformation
ytsearch10:calisthenics progression
ytsearch10:parkour POV
ytsearch10:extreme sports compilation
ytsearch10:skateboarding tricks
```

### Tier 3: YouTube Channel Pages

High-quality channels worth auto-pulling from:

```
# Tech & Design
https://www.youtube.com/@Fireship/videos              # Short dev videos
https://www.youtube.com/@DesignCourse/videos           # UI/UX
https://www.youtube.com/@juaboret/videos               # Product design
https://www.youtube.com/@MKBHDshorts/shorts            # Tech shorts
https://www.youtube.com/@NetworkChuck/shorts           # Tech shorts
https://www.youtube.com/@ThePrimeTimeagen/videos       # Dev entertainment

# Entertainment
https://www.youtube.com/@veritasium/videos             # Science explainers
https://www.youtube.com/@MarkRober/videos              # Engineering
https://www.youtube.com/@TomScottGo/videos             # Interesting things
https://www.youtube.com/@JohnnyHarris/videos           # Explainers
https://www.youtube.com/@Wendover/videos               # Logistics/systems
https://www.youtube.com/@RealEngineering/videos        # Engineering

# Short-form focused
https://www.youtube.com/@MrBeast/shorts
https://www.youtube.com/@Fireship/shorts
https://www.youtube.com/@NatGeo/shorts
```

### Tier 3b: Short-Form Social (for Feed/Swipe mode)

```
# YouTube Shorts — search-based
ytsearch10:shorts viral today
ytsearch10:shorts satisfying
ytsearch10:shorts funny animals
ytsearch10:shorts life hack
ytsearch10:shorts design tip
ytsearch10:shorts cooking hack

# Instagram Reels (requires Chrome login, fragile)
https://www.instagram.com/reels/trending/

# Reddit short videos
https://www.reddit.com/r/TikTokCringe/top/?t=day
https://www.reddit.com/r/Unexpected/top/?t=day
https://www.reddit.com/r/oddlysatisfying/top/?t=day
```

---

## Cookie Strategy

### Current Setup (Confirmed Working)

| Cookie File | Mode | Site | Auth Level |
|-------------|------|------|------------|
| `youtube.txt` | Social | YouTube | Full login (Google account) |
| `tiktok.txt` | Social | TikTok | Full login (QR code auth) |
| `redgifs.txt` | NSFW | RedGifs | Full login (tonjone92) |
| `fikfap.txt` | NSFW | FikFap | CF clearance only (no account) |
| Arc browser | NSFW | Pornhub | Full login via `--cookies-from-browser arc` |
| Arc browser | NSFW | XVideos, SpankBang, RedTube | Fallback via `--cookies-from-browser arc` |

### Still Recommended: Expand

**Arc (NSFW):**
- **XVideos** — log in for personalized recs (currently just public)
- **SpankBang** — log in for trending feed quality boost

**Chrome (Social):**
- **Reddit** — unlocks personalized home feed, subscribed subreddits
- **Instagram** — Reels suggestions based on activity

### Cookie Freshness

Cookies expire. Re-export when content stops loading.

| File | Expected Lifespan | Notes |
|------|-------------------|-------|
| `youtube.txt` | ~6 months | Google sessions are long-lived |
| `tiktok.txt` | ~1-2 months | TikTok is aggressive about session rotation |
| `redgifs.txt` | ~3-6 months | Stable, lightweight auth |
| `fikfap.txt` | ~1 month | Just CF clearance, easy to re-export |
| Pornhub (Arc) | ~1-3 months | Re-export if recs stop being personalized |

---

## Category Seed Data for `categories` Table

These are the initial rows to INSERT. Each maps a user-facing label to a yt-dlp query.

### NSFW Categories
```sql
INSERT INTO categories (key, label, query, mode) VALUES
('nsfw_trending',      'Trending',              'https://www.pornhub.com/video?o=tr',                        'nsfw'),
('nsfw_recommended',   'Recommended',           'https://www.pornhub.com/recommended',                       'nsfw'),
('nsfw_hot',           'Hottest',               'https://www.pornhub.com/video?o=ht',                        'nsfw'),
('nsfw_mostviewed',    'Most Viewed',           'https://www.pornhub.com/video?o=mv&t=w',                    'nsfw'),
('nsfw_amateur',       'Amateur',               'https://www.pornhub.com/video/search?search=amateur+homemade&hd=1&o=tr', 'nsfw'),
('nsfw_pov',           'POV',                   'https://www.pornhub.com/video/search?search=pov&hd=1&o=tr', 'nsfw'),
('nsfw_solo',          'Solo',                  'https://www.pornhub.com/video/search?search=solo&hd=1&o=tr', 'nsfw'),
('nsfw_realcouples',   'Real Couples',          'https://www.pornhub.com/video/search?search=real+couple&hd=1&o=tr', 'nsfw'),
('nsfw_sensual',       'Sensual',               'https://www.pornhub.com/video/search?search=sensual+romantic&hd=1', 'nsfw'),
('nsfw_compilation',   'Compilations',          'https://www.pornhub.com/video/search?search=compilation&hd=1&o=mv', 'nsfw'),
('nsfw_verified',      'Verified Amateurs',     'https://www.pornhub.com/categories/verified-amateurs',       'nsfw'),
('nsfw_popular_women', 'Popular With Women',    'https://www.pornhub.com/categories/popular-with-women',      'nsfw'),
('nsfw_new',           'Newest',                'https://www.pornhub.com/video?o=cm',                         'nsfw'),
('nsfw_xvideos_best',  'Best of XVideos',       'https://www.xvideos.com/best',                               'nsfw'),
('nsfw_spankbang',     'SpankBang Trending',    'https://spankbang.com/trending',                             'nsfw'),
('nsfw_casting',       'Casting',               'https://www.pornhub.com/video/search?search=casting&hd=1&o=tr', 'nsfw'),
('nsfw_massage',       'Massage',               'https://www.pornhub.com/video/search?search=massage&hd=1&o=tr', 'nsfw'),
('nsfw_cosplay',       'Cosplay',               'https://www.pornhub.com/video/search?search=cosplay&hd=1&o=tr', 'nsfw'),
('nsfw_fitness',       'Fitness',               'https://www.pornhub.com/video/search?search=fit+yoga&hd=1&o=tr', 'nsfw'),
('nsfw_asmr',          'ASMR',                  'https://www.pornhub.com/video/search?search=asmr&hd=1&o=tr', 'nsfw'),
('nsfw_redgifs_trend', 'RedGifs Trending',       'https://www.redgifs.com/trending',                           'nsfw'),
('nsfw_redgifs_clips', 'RedGifs Clips',          'https://www.redgifs.com/trending?type=g',                    'nsfw'),
('nsfw_redgifs_amatr', 'RedGifs Amateur',        'https://www.redgifs.com/search?query=amateur&order=trending','nsfw'),
('nsfw_redgifs_couple','RedGifs Couples',         'https://www.redgifs.com/search?query=couple&order=trending', 'nsfw'),
('nsfw_redgifs_creatrs','RedGifs Creators',       'https://www.redgifs.com/creators',                          'nsfw'),
('nsfw_fikfap_trend',  'FikFap Trending',        'https://fikfap.com/trending',                                'nsfw'),
('nsfw_fikfap_new',    'FikFap New',             'https://fikfap.com/new',                                     'nsfw'),
('nsfw_fikfap_top',    'FikFap Top',             'https://fikfap.com/top',                                     'nsfw');
```

### Social Categories
```sql
INSERT INTO categories (key, label, query, mode) VALUES
('social_trending',     'Trending',             'https://www.youtube.com/feed/trending',                      'social'),
('social_subscriptions','Your Subscriptions',   'https://www.youtube.com/feed/subscriptions',                 'social'),
('social_shorts',       'Shorts',               'https://www.youtube.com/shorts',                             'social'),
('social_viral',        'Viral This Week',      'ytsearch10:viral videos this week 2026',                     'social'),
('social_tech',         'Tech & Gadgets',       'ytsearch10:best new tech gadgets 2026',                      'social'),
('social_design',       'Design',               'ytsearch10:UI UX design tips 2026',                          'social'),
('social_satisfying',   'Satisfying',           'ytsearch10:satisfying videos compilation',                   'social'),
('social_fails',        'Fails & Funny',        'ytsearch10:best fails compilation this month',               'social'),
('social_nature',       'Nature & Science',     'ytsearch10:nature documentary short amazing',                'social'),
('social_music',        'Live Music',           'ytsearch10:tiny desk concert 2026',                          'social'),
('social_sports',       'Sports Highlights',    'ytsearch10:best sports highlights this week',                'social'),
('social_cooking',      'Cooking',              'ytsearch10:cooking recipe viral short',                      'social'),
('social_reddit_unexp', 'Reddit Unexpected',    'https://www.reddit.com/r/Unexpected/hot',                   'social'),
('social_reddit_nfl',   'Reddit NextLevel',     'https://www.reddit.com/r/nextfuckinglevel/hot',             'social'),
('social_reddit_satis', 'Reddit Satisfying',    'https://www.reddit.com/r/oddlysatisfying/hot',              'social'),
('social_fireship',     'Fireship',             'https://www.youtube.com/@Fireship/shorts',                  'social'),
('social_city_walks',   'City Walks',           'ytsearch10:city walking tour 4K',                            'social'),
('social_explainers',   'Explainers',           'ytsearch10:explained in 5 minutes',                          'social'),
('social_tiktok_fyp',   'TikTok For You',       'https://www.tiktok.com/foryou',                              'social'),
('social_tiktok_trend', 'TikTok Trending',      'https://www.tiktok.com/trending',                            'social');
```

---

## System Searches (Saved Search Presets)

These are user-definable saved searches that mix into the homepage rotation. Think of them as "channels" the user curates.

### How It Works
- User creates a "system search" with a name and query string
- Backend periodically runs the query via yt-dlp, caches results
- Results get mixed into the homepage feed alongside category results
- User can weight them (show more/less of this)

### NSFW Saved Searches (22)

**Personalized Feeds (weight: 1.5)**
```
Name: "Recommended For You"    Query: "https://www.pornhub.com/recommended"
Name: "My Subscriptions"       Query: "https://www.pornhub.com/subscriptions"
Name: "RedGifs Feed"           Query: "https://www.redgifs.com/trending"
Name: "FikFap Feed"            Query: "https://fikfap.com/trending"
```

**Taste-Specific (weight: 1.2)**
```
Name: "Amateur HD"             Query: "https://www.pornhub.com/video/search?search=amateur+homemade&hd=1&o=tr"
Name: "POV Trending"           Query: "https://www.pornhub.com/video/search?search=pov&hd=1&o=tr"
Name: "Real Couples"           Query: "https://www.pornhub.com/video/search?search=real+couple&hd=1&o=tr"
Name: "Solo"                   Query: "https://www.pornhub.com/video/search?search=solo&hd=1&o=tr"
Name: "Sensual / Romantic"     Query: "https://www.pornhub.com/video/search?search=sensual+romantic&hd=1"
Name: "Massage"                Query: "https://www.pornhub.com/video/search?search=massage&hd=1&o=tr"
Name: "Casting"                Query: "https://www.pornhub.com/video/search?search=casting&hd=1&o=tr"
Name: "Fit / Yoga"             Query: "https://www.pornhub.com/video/search?search=fit+yoga&hd=1&o=tr"
Name: "Cosplay"                Query: "https://www.pornhub.com/video/search?search=cosplay&hd=1&o=tr"
```

**Discovery / Broad (weight: 1.0)**
```
Name: "Trending Today"         Query: "https://www.pornhub.com/video?o=tr"
Name: "Hottest Rated"          Query: "https://www.pornhub.com/video?o=ht"
Name: "Most Viewed This Week"  Query: "https://www.pornhub.com/video?o=mv&t=w"
Name: "New This Week"          Query: "https://www.pornhub.com/video?o=cm&t=w"
Name: "Verified Amateurs"      Query: "https://www.pornhub.com/categories/verified-amateurs"
Name: "XVideos Best"           Query: "https://www.xvideos.com/best"
Name: "SpankBang Trending"     Query: "https://spankbang.com/trending"
```

**Short-Form NSFW (weight: 1.3)**
```
Name: "RedGifs Clips Only"     Query: "https://www.redgifs.com/trending?type=g"
Name: "PH Shorts"              Query: "https://www.pornhub.com/video/search?search=amateur&max_duration=5&o=tr"
```

### Social Saved Searches (28)

**Your Feeds / Cookies-Powered (weight: 1.5)**
```
Name: "My Subscriptions"       Query: "https://www.youtube.com/feed/subscriptions"
Name: "YouTube Trending"       Query: "https://www.youtube.com/feed/trending"
Name: "YouTube Shorts"         Query: "https://www.youtube.com/shorts"
Name: "TikTok For You"         Query: "https://www.tiktok.com/foryou"
Name: "TikTok Trending"        Query: "https://www.tiktok.com/trending"
Name: "Reddit Front Page"      Query: "https://www.reddit.com/r/videos/hot"
```

**Music (weight: 1.3)**
```
Name: "R&B Music Videos"       Query: "ytsearch10:R&B music video new 2026"
Name: "Tiny Desk Concerts"     Query: "ytsearch10:tiny desk concert 2026"
Name: "DJ Sets Sunday Clean"   Query: "ytsearch10:DJ set house music cleaning vibes"
Name: "Live Looping"           Query: "ytsearch10:live looping performance"
Name: "Jazz Cafe Ambience"     Query: "ytsearch10:jazz cafe ambience"
Name: "Chill Beats"            Query: "ytsearch10:lofi hip hop chill beats study"
Name: "Album Reactions"        Query: "ytsearch10:album reaction first listen R&B"
```

**Tech & Design (weight: 1.2)**
```
Name: "Future of UX Design"    Query: "ytsearch10:future of UX design 2026"
Name: "Vibe Coding"            Query: "ytsearch10:vibe coding new skills AI"
Name: "Fireship"               Query: "https://www.youtube.com/@Fireship/shorts"
Name: "UI Design Tips"         Query: "ytsearch10:UI design tips 2026"
Name: "AI Tools for Designers" Query: "ytsearch10:AI tools for designers 2026"
```

**Funny / Viral (weight: 1.2)**
```
Name: "Funny Sketches New"     Query: "ytsearch10:funny sketch comedy new 2026"
Name: "Vine Compilations"      Query: "ytsearch10:vine compilation funny best"
Name: "Reddit Unexpected"      Query: "https://www.reddit.com/r/Unexpected/hot"
Name: "Reddit NextLevel"       Query: "https://www.reddit.com/r/nextfuckinglevel/hot"
Name: "Try Not to Laugh"       Query: "ytsearch10:try not to laugh challenge"
```

**Lifestyle & Culture (weight: 1.0)**
```
Name: "City Walks 4K"          Query: "ytsearch10:city walking tour 4K"
Name: "Street Food"            Query: "ytsearch10:street food tour"
Name: "Home Office Setups"     Query: "ytsearch10:home office setup tour 2026"
```

**News & Current (weight: 1.0)**
```
Name: "Critical News Today"    Query: "ytsearch10:breaking news today important"
Name: "US Politics Update"     Query: "ytsearch10:US politics update this week 2026"
```

### Schema Addition
```sql
CREATE TABLE IF NOT EXISTS system_searches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  query TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'nsfw',  -- 'social' or 'nsfw'
  weight REAL DEFAULT 1.0,            -- 0.0 = hidden, 2.0 = double frequency
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT (datetime('now')),
  last_fetched DATETIME
);
```

### Seed Data (50 searches)
```sql
INSERT INTO system_searches (name, query, mode, weight) VALUES
-- NSFW: Personalized Feeds (1.5)
('Recommended For You',    'https://www.pornhub.com/recommended',                                    'nsfw', 1.5),
('My Subscriptions',       'https://www.pornhub.com/subscriptions',                                  'nsfw', 1.5),
('RedGifs Feed',           'https://www.redgifs.com/trending',                                       'nsfw', 1.5),
('FikFap Feed',            'https://fikfap.com/trending',                                            'nsfw', 1.5),
-- NSFW: Taste-Specific (1.2)
('Amateur HD',             'https://www.pornhub.com/video/search?search=amateur+homemade&hd=1&o=tr', 'nsfw', 1.2),
('POV Trending',           'https://www.pornhub.com/video/search?search=pov&hd=1&o=tr',             'nsfw', 1.2),
('Real Couples',           'https://www.pornhub.com/video/search?search=real+couple&hd=1&o=tr',     'nsfw', 1.2),
('Solo',                   'https://www.pornhub.com/video/search?search=solo&hd=1&o=tr',            'nsfw', 1.2),
('Sensual / Romantic',     'https://www.pornhub.com/video/search?search=sensual+romantic&hd=1',     'nsfw', 1.2),
('Massage',                'https://www.pornhub.com/video/search?search=massage&hd=1&o=tr',         'nsfw', 1.2),
('Casting',                'https://www.pornhub.com/video/search?search=casting&hd=1&o=tr',         'nsfw', 1.2),
('Fit / Yoga',             'https://www.pornhub.com/video/search?search=fit+yoga&hd=1&o=tr',        'nsfw', 1.2),
('Cosplay',                'https://www.pornhub.com/video/search?search=cosplay&hd=1&o=tr',         'nsfw', 1.2),
-- NSFW: Discovery (1.0)
('Trending Today',         'https://www.pornhub.com/video?o=tr',                                    'nsfw', 1.0),
('Hottest Rated',          'https://www.pornhub.com/video?o=ht',                                    'nsfw', 1.0),
('Most Viewed This Week',  'https://www.pornhub.com/video?o=mv&t=w',                                'nsfw', 1.0),
('New This Week',          'https://www.pornhub.com/video?o=cm&t=w',                                'nsfw', 1.0),
('Verified Amateurs',      'https://www.pornhub.com/categories/verified-amateurs',                   'nsfw', 1.0),
('XVideos Best',           'https://www.xvideos.com/best',                                          'nsfw', 1.0),
('SpankBang Trending',     'https://spankbang.com/trending',                                        'nsfw', 1.0),
-- NSFW: Short-Form (1.3)
('RedGifs Clips Only',     'https://www.redgifs.com/trending?type=g',                               'nsfw', 1.3),
('PH Shorts',              'https://www.pornhub.com/video/search?search=amateur&max_duration=5&o=tr','nsfw', 1.3),
-- Social: Cookies-Powered Feeds (1.5)
('My Subscriptions',       'https://www.youtube.com/feed/subscriptions',                             'social', 1.5),
('YouTube Trending',       'https://www.youtube.com/feed/trending',                                  'social', 1.5),
('YouTube Shorts',         'https://www.youtube.com/shorts',                                         'social', 1.5),
('TikTok For You',         'https://www.tiktok.com/foryou',                                          'social', 1.5),
('TikTok Trending',        'https://www.tiktok.com/trending',                                        'social', 1.5),
('Reddit Front Page',      'https://www.reddit.com/r/videos/hot',                                    'social', 1.5),
-- Social: Music (1.3)
('R&B Music Videos',       'ytsearch10:R&B music video new 2026',                                   'social', 1.3),
('Tiny Desk Concerts',     'ytsearch10:tiny desk concert 2026',                                     'social', 1.3),
('DJ Sets Sunday Clean',   'ytsearch10:DJ set house music cleaning vibes',                          'social', 1.3),
('Live Looping',           'ytsearch10:live looping performance',                                   'social', 1.3),
('Jazz Cafe Ambience',     'ytsearch10:jazz cafe ambience',                                         'social', 1.3),
('Chill Beats',            'ytsearch10:lofi hip hop chill beats study',                              'social', 1.3),
('Album Reactions',        'ytsearch10:album reaction first listen R&B',                            'social', 1.3),
-- Social: Tech & Design (1.2)
('Future of UX Design',    'ytsearch10:future of UX design 2026',                                   'social', 1.2),
('Vibe Coding',            'ytsearch10:vibe coding new skills AI',                                  'social', 1.2),
('Fireship',               'https://www.youtube.com/@Fireship/shorts',                              'social', 1.2),
('UI Design Tips',         'ytsearch10:UI design tips 2026',                                        'social', 1.2),
('AI Tools for Designers', 'ytsearch10:AI tools for designers 2026',                                'social', 1.2),
-- Social: Funny / Viral (1.2)
('Funny Sketches New',     'ytsearch10:funny sketch comedy new 2026',                               'social', 1.2),
('Vine Compilations',      'ytsearch10:vine compilation funny best',                                'social', 1.2),
('Reddit Unexpected',      'https://www.reddit.com/r/Unexpected/hot',                               'social', 1.2),
('Reddit NextLevel',       'https://www.reddit.com/r/nextfuckinglevel/hot',                         'social', 1.2),
('Try Not to Laugh',       'ytsearch10:try not to laugh challenge',                                 'social', 1.2),
-- Social: Lifestyle & Culture (1.0)
('City Walks 4K',          'ytsearch10:city walking tour 4K',                                       'social', 1.0),
('Street Food',            'ytsearch10:street food tour',                                           'social', 1.0),
('Home Office Setups',     'ytsearch10:home office setup tour 2026',                                'social', 1.0),
-- Social: News & Current (1.0)
('Critical News Today',    'ytsearch10:breaking news today important',                              'social', 1.0),
('US Politics Update',     'ytsearch10:US politics update this week 2026',                          'social', 1.0);
```

---

## Expanding Your Cookie Collection: Action Items

### Done
- [x] YouTube cookies exported (Chrome)
- [x] TikTok cookies exported (Chrome, QR code login)
- [x] RedGifs cookies exported (Arc, logged in as tonjone92)
- [x] FikFap cookies exported (Arc, CF clearance)
- [x] Pornhub cookies exported (Arc, explicit file: `pornhub.txt`)

### Still TODO
1. **Chrome → Reddit** — log in, export cookies. Unlocks personalized home feed + subreddit video posts.
2. **Chrome → Instagram** — log in, export cookies. Unlocks Reels algorithmic feed.
3. **Arc → XVideos** — log in for personalized recs (currently public-only via Arc browser cookies)
4. **Arc → SpankBang** — log in for better trending quality
5. Browse each newly logged-in site for 10+ min so their algorithm has signal to work with

### The Meta-Strategy
The more you browse each site while logged in, the better their recommendation feeds get. Even 15 minutes of browsing Pornhub's trending page while logged in will dramatically improve `/recommended` results vs. a fresh account.
