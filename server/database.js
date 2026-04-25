import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { logger } from './logger.js'

// ============================================================
// Database Setup
// SQLite via Node.js built-in node:sqlite (DatabaseSync).
// Single file, no server needed, easy to backup.
// Stores: videos, preferences, watch history
// ============================================================

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH = join(__dirname, '..', 'data', 'library.db')

export let db = null

// Category seeds from CONTENT_QUERIES.md — real URLs and search queries
function _seedCategories(database) {
  const insert = database.prepare('INSERT INTO categories (key, label, query, mode, sort_order) VALUES (?, ?, ?, ?, ?)')
  const categories = [
    // NSFW categories (25)
    ['nsfw_trending',       'Trending',             'https://www.pornhub.com/video?o=tr',                                          'nsfw', 0],
    ['nsfw_recommended',    'Recommended',          'https://www.pornhub.com/recommended',                                         'nsfw', 1],
    ['nsfw_hot',            'Hottest',              'https://www.pornhub.com/video?o=ht',                                          'nsfw', 2],
    ['nsfw_mostviewed',     'Most Viewed',          'https://www.pornhub.com/video?o=mv&t=w',                                      'nsfw', 3],
    ['nsfw_amateur',        'Amateur',              'https://www.pornhub.com/video/search?search=amateur+homemade&hd=1&o=tr',      'nsfw', 4],
    ['nsfw_pov',            'POV',                  'https://www.pornhub.com/video/search?search=pov&hd=1&o=tr',                   'nsfw', 5],
    ['nsfw_solo',           'Solo',                 'https://www.pornhub.com/video/search?search=solo&hd=1&o=tr',                  'nsfw', 6],
    ['nsfw_realcouples',    'Real Couples',         'https://www.pornhub.com/video/search?search=real+couple&hd=1&o=tr',           'nsfw', 7],
    ['nsfw_sensual',        'Sensual',              'https://www.pornhub.com/video/search?search=sensual+romantic&hd=1',           'nsfw', 8],
    ['nsfw_compilation',    'Compilations',         'https://www.pornhub.com/video/search?search=compilation&hd=1&o=mv',           'nsfw', 9],
    ['nsfw_verified',       'Verified Amateurs',    'https://www.pornhub.com/categories/verified-amateurs',                        'nsfw', 10],
    ['nsfw_popular_women',  'Popular With Women',   'https://www.pornhub.com/categories/popular-with-women',                       'nsfw', 11],
    ['nsfw_new',            'Newest',               'https://www.pornhub.com/video?o=cm',                                          'nsfw', 12],
    ['nsfw_xvideos_best',   'Best of XVideos',      'https://www.xvideos.com/best',                                                'nsfw', 13],
    ['nsfw_spankbang',      'SpankBang Trending',   'https://spankbang.com/trending_videos/',                                       'nsfw', 14],
    ['nsfw_casting',        'Casting',              'https://www.pornhub.com/video/search?search=casting&hd=1&o=tr',               'nsfw', 15],
    ['nsfw_massage',        'Massage',              'https://www.pornhub.com/video/search?search=massage&hd=1&o=tr',               'nsfw', 16],
    ['nsfw_cosplay',        'Cosplay',              'https://www.pornhub.com/video/search?search=cosplay&hd=1&o=tr',               'nsfw', 17],
    ['nsfw_fitness',        'Fitness',              'https://www.pornhub.com/video/search?search=fit+yoga&hd=1&o=tr',              'nsfw', 18],
    ['nsfw_asmr',           'ASMR',                 'https://www.pornhub.com/video/search?search=asmr&hd=1&o=tr',                  'nsfw', 19],
    ['nsfw_redgifs_trend',  'RedGifs Trending',     'https://www.redgifs.com/trending',                                            'nsfw', 20],
    ['nsfw_redgifs_clips',  'RedGifs Clips',        'https://www.redgifs.com/trending?type=g',                                     'nsfw', 21],
    ['nsfw_redgifs_amatr',  'RedGifs Amateur',      'https://www.redgifs.com/search?query=amateur&order=trending',                 'nsfw', 22],
    ['nsfw_redgifs_couple', 'RedGifs Couples',      'https://www.redgifs.com/search?query=couple&order=trending',                  'nsfw', 23],
    ['nsfw_fikfap_trend',   'FikFap Trending',      'https://fikfap.com/trending',                                                 'nsfw', 24],
    // Social categories (19)
    ['social_trending',      'Trending',            'ytsearch10:trending videos today',                                            'social', 0],
    ['social_subscriptions', 'My Subscriptions',    'https://www.youtube.com/feed/subscriptions',                                  'social', 1],
    ['social_shorts',        'Shorts',              'ytsearch10:youtube shorts trending today',                                    'social', 2],
    ['social_viral',         'Viral This Week',     'ytsearch10:viral videos this week',                                           'social', 3],
    ['social_tech',          'Tech & Gadgets',      'ytsearch10:best new tech gadgets',                                            'social', 4],
    ['social_design',        'Design',              'ytsearch10:UI UX design tips',                                                'social', 5],
    ['social_satisfying',    'Satisfying',          'ytsearch10:satisfying videos compilation',                                    'social', 6],
    ['social_fails',         'Fails & Funny',       'ytsearch10:best fails compilation this month',                                'social', 7],
    ['social_nature',        'Nature & Science',    'ytsearch10:nature documentary short amazing',                                 'social', 8],
    ['social_music',         'Live Music',          'ytsearch10:tiny desk concert',                                                'social', 9],
    ['social_sports',        'Sports Highlights',   'ytsearch10:best sports highlights this week',                                 'social', 10],
    ['social_cooking',       'Cooking',             'ytsearch10:cooking recipe viral short',                                       'social', 11],
    ['social_reddit_unexp',  'Reddit Unexpected',   'https://www.reddit.com/r/Unexpected/hot',                                    'social', 12],
    ['social_reddit_nfl',    'Reddit NextLevel',    'https://www.reddit.com/r/nextfuckinglevel/hot',                              'social', 13],
    ['social_reddit_satis',  'Reddit Satisfying',   'https://www.reddit.com/r/oddlysatisfying/hot',                               'social', 14],
    ['social_fireship',      'Fireship',            'https://www.youtube.com/@Fireship/shorts',                                   'social', 15],
    ['social_city_walks',    'City Walks',          'ytsearch10:city walking tour 4K',                                             'social', 16],
    ['social_explainers',    'Explainers',          'ytsearch10:explained in 5 minutes',                                           'social', 17],
    ['social_tiktok_fyp',    'TikTok For You',      'https://www.tiktok.com/foryou',                                               'social', 18],
  ]
  for (const row of categories) {
    insert.run(...row)
  }
}

// System searches from CONTENT_QUERIES.md — saved searches that boost feed scoring.
// Matched videos get +SYSTEM_SEARCH points (see scoring.js). They do not add homepage rows on their own.
function _seedSystemSearches(database) {
  const insert = database.prepare(
    'INSERT OR IGNORE INTO system_searches (name, query, mode, weight) VALUES (?, ?, ?, ?)'
  )
  const rows = [
    // NSFW: Personalized Feeds (1.5)
    ['Recommended For You',    'https://www.pornhub.com/recommended',                                    'nsfw', 1.5],
    ['My Subscriptions',       'https://www.pornhub.com/subscriptions',                                  'nsfw', 1.5],
    ['RedGifs Feed',           'https://www.redgifs.com/trending',                                       'nsfw', 1.5],
    ['FikFap Feed',            'https://fikfap.com/trending',                                            'nsfw', 1.5],
    // NSFW: Taste-Specific (1.2)
    ['Amateur HD',             'https://www.pornhub.com/video/search?search=amateur+homemade&hd=1&o=tr', 'nsfw', 1.2],
    ['POV Trending',           'https://www.pornhub.com/video/search?search=pov&hd=1&o=tr',              'nsfw', 1.2],
    ['Real Couples',           'https://www.pornhub.com/video/search?search=real+couple&hd=1&o=tr',      'nsfw', 1.2],
    ['Solo',                   'https://www.pornhub.com/video/search?search=solo&hd=1&o=tr',             'nsfw', 1.2],
    ['Sensual / Romantic',     'https://www.pornhub.com/video/search?search=sensual+romantic&hd=1',      'nsfw', 1.2],
    ['Massage',                'https://www.pornhub.com/video/search?search=massage&hd=1&o=tr',          'nsfw', 1.2],
    ['Casting',                'https://www.pornhub.com/video/search?search=casting&hd=1&o=tr',          'nsfw', 1.2],
    ['Fit / Yoga',             'https://www.pornhub.com/video/search?search=fit+yoga&hd=1&o=tr',         'nsfw', 1.2],
    ['Cosplay',                'https://www.pornhub.com/video/search?search=cosplay&hd=1&o=tr',          'nsfw', 1.2],
    // NSFW: Discovery (1.0)
    ['Trending Today',         'https://www.pornhub.com/video?o=tr',                                     'nsfw', 1.0],
    ['Hottest Rated',          'https://www.pornhub.com/video?o=ht',                                     'nsfw', 1.0],
    ['Most Viewed This Week',  'https://www.pornhub.com/video?o=mv&t=w',                                 'nsfw', 1.0],
    ['New This Week',          'https://www.pornhub.com/video?o=cm&t=w',                                 'nsfw', 1.0],
    ['Verified Amateurs',      'https://www.pornhub.com/categories/verified-amateurs',                   'nsfw', 1.0],
    ['XVideos Best',           'https://www.xvideos.com/best',                                           'nsfw', 1.0],
    ['SpankBang Trending',     'https://spankbang.com/trending',                                         'nsfw', 1.0],
    // NSFW: Short-Form (1.3)
    ['RedGifs Clips Only',     'https://www.redgifs.com/trending?type=g',                                'nsfw', 1.3],
    ['PH Shorts',              'https://www.pornhub.com/video/search?search=amateur&max_duration=5&o=tr','nsfw', 1.3],
    // Social: Cookies-Powered Feeds (1.5)
    ['My Subscriptions',       'https://www.youtube.com/feed/subscriptions',                             'social', 1.5],
    ['YouTube Trending',       'https://www.youtube.com/feed/trending',                                  'social', 1.5],
    ['YouTube Shorts',         'https://www.youtube.com/shorts',                                         'social', 1.5],
    ['TikTok For You',         'https://www.tiktok.com/foryou',                                          'social', 1.5],
    ['TikTok Trending',        'https://www.tiktok.com/trending',                                        'social', 1.5],
    ['Reddit Front Page',      'https://www.reddit.com/r/videos/hot',                                    'social', 1.5],
    // Social: Music (1.3)
    ['R&B Music Videos',       'ytsearch10:R&B music video new',                                         'social', 1.3],
    ['Tiny Desk Concerts',     'ytsearch10:tiny desk concert',                                           'social', 1.3],
    ['DJ Sets Sunday Clean',   'ytsearch10:DJ set house music cleaning vibes',                           'social', 1.3],
    ['Live Looping',           'ytsearch10:live looping performance',                                    'social', 1.3],
    ['Jazz Cafe Ambience',     'ytsearch10:jazz cafe ambience',                                          'social', 1.3],
    ['Chill Beats',            'ytsearch10:lofi hip hop chill beats study',                              'social', 1.3],
    ['Album Reactions',        'ytsearch10:album reaction first listen R&B',                             'social', 1.3],
    // Social: Tech & Design (1.2)
    ['Future of UX Design',    'ytsearch10:future of UX design',                                         'social', 1.2],
    ['Vibe Coding',            'ytsearch10:vibe coding new skills AI',                                   'social', 1.2],
    ['Fireship',               'https://www.youtube.com/@Fireship/shorts',                               'social', 1.2],
    ['UI Design Tips',         'ytsearch10:UI design tips',                                              'social', 1.2],
    ['AI Tools for Designers', 'ytsearch10:AI tools for designers',                                      'social', 1.2],
    // Social: Funny / Viral (1.2)
    ['Funny Sketches New',     'ytsearch10:funny sketch comedy new',                                     'social', 1.2],
    ['Vine Compilations',      'ytsearch10:vine compilation funny best',                                 'social', 1.2],
    ['Reddit Unexpected',      'https://www.reddit.com/r/Unexpected/hot',                                'social', 1.2],
    ['Reddit NextLevel',       'https://www.reddit.com/r/nextfuckinglevel/hot',                          'social', 1.2],
    ['Try Not to Laugh',       'ytsearch10:try not to laugh challenge',                                  'social', 1.2],
    // Social: Lifestyle & Culture (1.0)
    ['City Walks 4K',          'ytsearch10:city walking tour 4K',                                        'social', 1.0],
    ['Street Food',            'ytsearch10:street food tour',                                            'social', 1.0],
    ['Home Office Setups',     'ytsearch10:home office setup tour',                                      'social', 1.0],
    // Social: News & Current (1.0)
    ['Critical News Today',    'ytsearch10:breaking news today important',                               'social', 1.0],
    ['US Politics Update',     'ytsearch10:US politics update this week',                                'social', 1.0],
  ]
  for (const row of rows) {
    insert.run(...row)
  }
  logger.info('Seeded system_searches', { count: rows.length })
}

export function initDatabase() {
  // Ensure data directory exists
  const dataDir = dirname(DB_PATH)
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true })
  }

  db = new DatabaseSync(DB_PATH)

  // Enable WAL mode for better concurrent performance
  db.exec('PRAGMA journal_mode = WAL')

  // Create tables
  db.exec(`
    -- Video library
    CREATE TABLE IF NOT EXISTS videos (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      title TEXT,
      thumbnail TEXT,
      duration INTEGER DEFAULT 0,
      tags TEXT DEFAULT '[]',
      source TEXT,
      mode TEXT NOT NULL DEFAULT 'social' CHECK(mode IN ('social', 'nsfw')),
      added_at DATETIME DEFAULT (datetime('now')),
      last_watched DATETIME,
      watch_count INTEGER DEFAULT 0,
      rating INTEGER,
      favorite INTEGER DEFAULT 0
    );

    -- User preferences (key-value)
    CREATE TABLE IF NOT EXISTS preferences (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    -- Watch history (for future AI recommendations)
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id TEXT,
      watched_at DATETIME DEFAULT (datetime('now')),
      watch_duration INTEGER DEFAULT 0,
      completed INTEGER DEFAULT 0,
      FOREIGN KEY (video_id) REFERENCES videos(id)
    );

    -- Homepage categories (social and nsfw modes have separate categories)
    CREATE TABLE IF NOT EXISTS categories (
      key TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      query TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'social' CHECK(mode IN ('social', 'nsfw')),
      sort_order INTEGER DEFAULT 0
    );

    -- Homepage video cache (videos fetched for homepage display)
    CREATE TABLE IF NOT EXISTS homepage_cache (
      id TEXT PRIMARY KEY,
      category_key TEXT NOT NULL,
      url TEXT NOT NULL,
      title TEXT,
      thumbnail TEXT,
      duration INTEGER DEFAULT 0,
      source TEXT,
      uploader TEXT,
      view_count INTEGER DEFAULT 0,
      like_count INTEGER,
      subscriber_count INTEGER,
      upload_date TEXT,
      tags TEXT DEFAULT '[]',
      fetched_at DATETIME DEFAULT (datetime('now')),
      expires_at DATETIME DEFAULT (datetime('now', '+7 days')),
      viewed INTEGER DEFAULT 0,
      FOREIGN KEY (category_key) REFERENCES categories(key)
    );

    -- Feed sources (domains that the feed pulls from)
    CREATE TABLE IF NOT EXISTS sources (
      domain TEXT PRIMARY KEY,
      mode TEXT NOT NULL DEFAULT 'social' CHECK(mode IN ('social', 'nsfw')),
      label TEXT,
      query TEXT,
      weight REAL DEFAULT 1.0,
      active INTEGER DEFAULT 1,
      fetch_interval INTEGER DEFAULT 1800,
      last_fetched DATETIME,
      added_at DATETIME DEFAULT (datetime('now'))
    );

    -- Feed video cache (short-form videos for the swipe feed)
    CREATE TABLE IF NOT EXISTS feed_cache (
      id TEXT PRIMARY KEY,
      source_domain TEXT,
      mode TEXT NOT NULL DEFAULT 'social',
      url TEXT NOT NULL UNIQUE,
      stream_url TEXT,
      title TEXT,
      creator TEXT,
      thumbnail TEXT,
      duration INTEGER DEFAULT 0,
      orientation TEXT DEFAULT 'horizontal',
      view_count INTEGER,
      like_count INTEGER,
      subscriber_count INTEGER,
      upload_date TEXT,
      fetched_at DATETIME DEFAULT (datetime('now')),
      expires_at DATETIME DEFAULT (datetime('now', '+6 hours')),
      watched INTEGER DEFAULT 0,
      FOREIGN KEY (source_domain) REFERENCES sources(domain)
    );

    -- System searches (saved search presets that mix into homepage rotation)
    CREATE TABLE IF NOT EXISTS system_searches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      query TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'nsfw',
      weight REAL DEFAULT 1.0,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT (datetime('now')),
      last_fetched DATETIME
    );

    -- Tag preferences (liked/disliked tags for recommendations)
    CREATE TABLE IF NOT EXISTS tag_preferences (
      tag TEXT PRIMARY KEY,
      preference TEXT NOT NULL CHECK(preference IN ('liked', 'disliked')),
      updated_at DATETIME DEFAULT (datetime('now'))
    );

    -- Playlists
    CREATE TABLE IF NOT EXISTS playlists (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      name TEXT NOT NULL,
      created_at DATETIME DEFAULT (datetime('now')),
      updated_at DATETIME DEFAULT (datetime('now'))
    );

    -- Playlist items (ordered)
    CREATE TABLE IF NOT EXISTS playlist_items (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      playlist_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      added_at DATETIME DEFAULT (datetime('now')),
      FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
      FOREIGN KEY (video_id) REFERENCES videos(id)
    );
    CREATE INDEX IF NOT EXISTS idx_playlist_items_playlist ON playlist_items(playlist_id, position);

    -- Queue (synced across devices via API)
    CREATE TABLE IF NOT EXISTS queue (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      position INTEGER NOT NULL,
      video_url TEXT NOT NULL,
      title TEXT,
      thumbnail TEXT,
      duration INTEGER DEFAULT 0,
      duration_formatted TEXT DEFAULT '0:00',
      added_at DATETIME DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_queue_position ON queue(position);

    -- Indexes for common queries
    CREATE INDEX IF NOT EXISTS idx_videos_added ON videos(added_at DESC);
    CREATE INDEX IF NOT EXISTS idx_videos_source ON videos(source);
    CREATE INDEX IF NOT EXISTS idx_history_video ON history(video_id);
    CREATE INDEX IF NOT EXISTS idx_history_date ON history(watched_at DESC);
    CREATE INDEX IF NOT EXISTS idx_homepage_cache_cat_viewed ON homepage_cache(category_key, viewed);
    CREATE INDEX IF NOT EXISTS idx_homepage_cache_expires ON homepage_cache(expires_at);
    CREATE INDEX IF NOT EXISTS idx_homepage_cache_url ON homepage_cache(url);
    CREATE INDEX IF NOT EXISTS idx_categories_mode ON categories(mode, sort_order);
    CREATE INDEX IF NOT EXISTS idx_feed_cache_mode ON feed_cache(mode, watched, expires_at);
    CREATE INDEX IF NOT EXISTS idx_feed_cache_url ON feed_cache(url);
    CREATE INDEX IF NOT EXISTS idx_feed_cache_source ON feed_cache(source_domain);
    CREATE INDEX IF NOT EXISTS idx_sources_mode ON sources(mode, active);

    -- Creator lists for multi-platform feed (Reddit subs, TikTok/Insta/Twitter creators)
    CREATE TABLE IF NOT EXISTS creators (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      handle TEXT NOT NULL,
      url TEXT NOT NULL,
      label TEXT,
      active INTEGER DEFAULT 1,
      last_fetched DATETIME,
      fetch_failures INTEGER DEFAULT 0,
      added_at DATETIME DEFAULT (datetime('now')),
      UNIQUE(platform, handle)
    );
    CREATE INDEX IF NOT EXISTS idx_creators_platform ON creators(platform, active);

    -- Subscription channel cache (channels seen from authenticated feed loads)
    -- Used as fallback when YouTube cookies expire: search for recent uploads
    -- from these channels instead of returning nothing.
    CREATE TABLE IF NOT EXISTS sub_channels (
      channel_id TEXT PRIMARY KEY,
      channel_name TEXT NOT NULL,
      channel_url TEXT NOT NULL,
      last_seen DATETIME DEFAULT (datetime('now')),
      video_count INTEGER DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_sub_channels_seen ON sub_channels(last_seen DESC);

    -- Subscription backups: archive of "who I follow" across all platforms
    -- Separate from creators (which drives content fetching) — this is a read-only backup
    CREATE TABLE IF NOT EXISTS subscription_backups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      handle TEXT NOT NULL,
      display_name TEXT,
      profile_url TEXT,
      platform_id TEXT,
      backed_up_at DATETIME DEFAULT (datetime('now')),
      source TEXT DEFAULT 'api',
      UNIQUE(platform, handle)
    );
    CREATE INDEX IF NOT EXISTS idx_sub_backups_platform ON subscription_backups(platform);
    CREATE INDEX IF NOT EXISTS idx_sub_backups_handle ON subscription_backups(handle);
    CREATE INDEX IF NOT EXISTS idx_sub_backups_display_name ON subscription_backups(display_name);

    -- 3.12 Taste Feedback: individual video ratings (thumbs up/down)
    CREATE TABLE IF NOT EXISTS video_ratings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_url TEXT NOT NULL,
      surface_type TEXT NOT NULL DEFAULT 'home_row',
      surface_key TEXT,
      rating TEXT NOT NULL CHECK(rating IN ('up', 'down')),
      tags TEXT DEFAULT '[]',
      creator TEXT,
      title TEXT,
      thumbnail TEXT,
      rated_at DATETIME DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_video_ratings_url ON video_ratings(video_url);
    CREATE INDEX IF NOT EXISTS idx_video_ratings_rating ON video_ratings(rating, rated_at);

    -- 3.12 Taste Feedback: creator-level affinity from thumbs-up
    CREATE TABLE IF NOT EXISTS creator_boosts (
      creator TEXT PRIMARY KEY,
      boost_score REAL DEFAULT 0.0,
      surface_boosts TEXT DEFAULT '{}',
      last_updated DATETIME DEFAULT (datetime('now'))
    );

    -- 3.12 Taste Feedback: multi-signal taste profile (replaces tag_preferences as primary scoring input)
    CREATE TABLE IF NOT EXISTS taste_profile (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      signal_type TEXT NOT NULL,
      signal_value TEXT NOT NULL,
      weight REAL DEFAULT 0.0,
      surface_key TEXT,
      updated_at DATETIME DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_taste_profile_type ON taste_profile(signal_type, signal_value);
    CREATE INDEX IF NOT EXISTS idx_taste_profile_surface ON taste_profile(surface_key);

    -- Persistent rows: sticky homepage shelves whose content never auto-purges.
    -- Used for "My PornHub Likes", "From Your Subscriptions", and per-model rows.
    CREATE TABLE IF NOT EXISTS persistent_rows (
      key TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'nsfw',
      source TEXT NOT NULL,
      fetcher TEXT NOT NULL,
      fetcher_arg TEXT,
      sort_order INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      last_fetched DATETIME,
      fetch_interval INTEGER DEFAULT 3600
    );

    CREATE TABLE IF NOT EXISTS persistent_row_items (
      row_key TEXT NOT NULL,
      video_url TEXT NOT NULL,
      title TEXT,
      thumbnail TEXT,
      duration INTEGER DEFAULT 0,
      uploader TEXT,
      view_count INTEGER,
      like_count INTEGER,
      upload_date TEXT,
      liked_at DATETIME,
      added_at DATETIME DEFAULT (datetime('now')),
      tags TEXT DEFAULT '[]',
      PRIMARY KEY (row_key, video_url),
      FOREIGN KEY (row_key) REFERENCES persistent_rows(key) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_persistent_items_row ON persistent_row_items(row_key, liked_at DESC, added_at DESC);
  `)

  // Seed default categories if empty
  const catCount = db.prepare('SELECT COUNT(*) as n FROM categories').get()
  if (catCount.n === 0) {
    _seedCategories(db)
  }

  // Migrate: replace old/generic category seeds with curated ones from CONTENT_QUERIES.md
  try {
    const hasNewSeeds = db.prepare("SELECT COUNT(*) as n FROM categories WHERE key = 'nsfw_trending'").get()
    if (hasNewSeeds.n === 0) {
      db.exec("DELETE FROM homepage_cache")
      db.exec("DELETE FROM categories")
      _seedCategories(db)
    }
  } catch (err) {
    logger.error('Category migration failed -- DB may have stale seeds:', { error: err.message })
  }

  // Seed default feed sources if empty
  const srcCount = db.prepare('SELECT COUNT(*) as n FROM sources').get()
  if (srcCount.n === 0) {
    const insertSrc = db.prepare('INSERT INTO sources (domain, mode, label, query, weight) VALUES (?, ?, ?, ?, ?)')
    const defaultSources = [
      ['youtube.com',   'social', 'YouTube',   'trending videos',    1.0],
      ['tiktok.com',    'social', 'TikTok',    '__creators__',       1.0],
      ['reddit.com',    'social', 'Reddit',    '__creators__',       0.9],
      ['pornhub.com',   'nsfw',   'PornHub',   'https://www.pornhub.com/video?o=tr',       1.0],
      ['xvideos.com',   'nsfw',   'XVideos',   'https://www.xvideos.com/best',             0.8],
      ['spankbang.com', 'nsfw',   'SpankBang', 'https://spankbang.com/trending',           0.7],
      ['redgifs.com',   'nsfw',   'RedGifs',   'https://www.redgifs.com/trending',         0.9],
      ['fikfap.com',    'nsfw',   'FikFap',    'https://fikfap.com/trending',              0.7],
    ]
    for (const row of defaultSources) {
      insertSrc.run(...row)
    }
  }

  // Migrate: add new sources if missing
  try {
    const insertSrc = db.prepare('INSERT OR IGNORE INTO sources (domain, mode, label, query, weight) VALUES (?, ?, ?, ?, ?)')
    const newSources = [
      ['reddit.com',     'social', 'Reddit',            'reddit videos best of',                0.7],
      ['subscriptions',  'social', 'My Subscriptions',   'https://www.youtube.com/feed/subscriptions', 2.0],
      ['xvideos.com',    'nsfw',   'XVideos',           'https://www.xvideos.com/best',         0.8],
      ['spankbang.com',  'nsfw',   'SpankBang',         'https://spankbang.com/trending',       0.7],
      ['redgifs.com',    'nsfw',   'RedGifs',           'https://www.redgifs.com/trending',     0.9],
      ['fikfap.com',     'nsfw',   'FikFap',            'https://fikfap.com/trending',          0.7],
      // RedTube/YouPorn/xHamster: scraper configs exist (sources/scraper.js), wire them up.
      ['redtube.com',    'nsfw',   'RedTube',           'https://www.redtube.com/mostviewed?period=today', 0.7],
      ['youporn.com',    'nsfw',   'YouPorn',           'https://www.youporn.com/most_viewed/?t=t',        0.7],
      ['xhamster.com',   'nsfw',   'xHamster',          'https://xhamster.com/trending',                   0.7],
    ]
    for (const row of newSources) {
      insertSrc.run(...row)
    }
  } catch {}

  // Migrate: add diversifying NSFW categories if missing (Phase 1.4)
  try {
    const insertCat = db.prepare('INSERT OR IGNORE INTO categories (key, label, query, mode, sort_order) VALUES (?, ?, ?, ?, ?)')
    const extraCategories = [
      ['nsfw_redgifs_pov',   'POV Clips',     'https://www.redgifs.com/search?query=pov&order=trending',  'nsfw', 25],
      ['nsfw_redgifs_solo',  'RedGifs Solo',  'https://www.redgifs.com/search?query=solo&order=trending', 'nsfw', 26],
      ['nsfw_xvideos_new',   'XVideos New',   'https://www.xvideos.com/new',                              'nsfw', 27],
      ['nsfw_xvideos_hits',  'XVideos Hits',  'https://www.xvideos.com/hits',                             'nsfw', 28],
      ['nsfw_spankbang_new', 'SpankBang New', 'https://spankbang.com/new_videos',                         'nsfw', 29],
      ['nsfw_fikfap_new',    'FikFap New',    'https://fikfap.com/new',                                   'nsfw', 30],
    ]
    for (const row of extraCategories) {
      insertCat.run(...row)
    }
  } catch (err) {
    logger.error('Diversifying NSFW category seed failed:', { error: err.message })
  }

  // Seed system_searches if empty (Phase 1.3): saved searches that boost feed scoring (+10 pts via scoring.js).
  // 22 NSFW + 28 social entries from CONTENT_QUERIES.md.
  try {
    const ssCount = db.prepare('SELECT COUNT(*) as n FROM system_searches').get()
    if (ssCount.n === 0) {
      _seedSystemSearches(db)
    }
  } catch (err) {
    logger.error('system_searches seed failed:', { error: err.message })
  }

  // Seed persistent_rows: PH likes + PH subscriptions feed lead the NSFW homepage.
  // Top-3 model rows are added dynamically by selectTopPHModels() during warm-cache.
  try {
    const insertPR = db.prepare(
      'INSERT OR IGNORE INTO persistent_rows (key, label, mode, source, fetcher, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
    )
    insertPR.run('ph_likes', 'My PornHub Likes',        'nsfw', 'pornhub.com', 'ph_likes',         0)
    insertPR.run('ph_subs',  'From Your Subscriptions', 'nsfw', 'pornhub.com', 'ph_subscriptions', 1)
  } catch (err) {
    logger.error('persistent_rows seed failed:', { error: err.message })
  }

  // Migrate: fix social source queries from feed URLs (need auth) to search queries
  try {
    db.prepare("UPDATE sources SET query = 'trending videos' WHERE domain = 'youtube.com' AND query LIKE '%youtube.com/feed/%'").run()
  } catch {}

  // Migrate: switch TikTok/Reddit to __creators__ mode and add Instagram/Twitter sources
  try {
    db.prepare("UPDATE sources SET query = '__creators__', weight = 1.0 WHERE domain = 'tiktok.com' AND query != '__creators__'").run()
    db.prepare("UPDATE sources SET query = '__creators__', weight = 0.9 WHERE domain = 'reddit.com' AND query != '__creators__'").run()
    const insertSrc = db.prepare('INSERT OR IGNORE INTO sources (domain, mode, label, query, weight, active) VALUES (?, ?, ?, ?, ?, ?)')
    insertSrc.run('instagram.com', 'social', 'Instagram', '__creators__', 0.8, 0)
    insertSrc.run('twitter.com', 'social', 'Twitter/X', '__creators__', 0.7, 0)
  } catch {}

  // Migrate: add fetch_interval and last_fetched to sources if missing
  try {
    const cols = db.prepare("PRAGMA table_info(sources)").all()
    const colNames = cols.map(c => c.name)
    if (!colNames.includes('fetch_interval')) {
      db.exec("ALTER TABLE sources ADD COLUMN fetch_interval INTEGER DEFAULT 1800")
    }
    if (!colNames.includes('last_fetched')) {
      db.exec("ALTER TABLE sources ADD COLUMN last_fetched DATETIME")
    }
  } catch {}

  // Migrate: add watch_later column to videos if missing
  try {
    const cols = db.prepare("PRAGMA table_info(videos)").all()
    if (!cols.some(c => c.name === 'watch_later')) {
      db.exec("ALTER TABLE videos ADD COLUMN watch_later INTEGER DEFAULT 0")
    }
  } catch {}

  // Migrate: add mode column to videos if missing, infer from source domain
  try {
    const cols = db.prepare("PRAGMA table_info(videos)").all()
    if (!cols.some(c => c.name === 'mode')) {
      db.exec("ALTER TABLE videos ADD COLUMN mode TEXT NOT NULL DEFAULT 'social'")
      // Infer mode from source domain for existing rows
      const nsfwDomains = ['pornhub.com', 'xvideos.com', 'spankbang.com', 'redtube.com',
        'youporn.com', 'xhamster.com', 'redgifs.com', 'fikfap.com', 'xnxx.com']
      for (const domain of nsfwDomains) {
        db.prepare("UPDATE videos SET mode = 'nsfw' WHERE source LIKE ?").run(`%${domain}%`)
      }
      logger.info('Migrated videos table: added mode column, inferred mode from source domain')
    }
  } catch {}

  // Migrate: add tags column to feed_cache if missing
  try {
    const cols = db.prepare("PRAGMA table_info(feed_cache)").all()
    if (!cols.some(c => c.name === 'tags')) {
      db.exec("ALTER TABLE feed_cache ADD COLUMN tags TEXT DEFAULT '[]'")
    }
  } catch {}

  // Migrate: add upload_date / like_count / subscriber_count to feed_cache and homepage_cache
  for (const table of ['feed_cache', 'homepage_cache']) {
    try {
      const cols = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name))
      const additions = [
        ['upload_date', 'TEXT'],
        ['like_count', 'INTEGER'],
        ['subscriber_count', 'INTEGER'],
      ]
      if (table === 'feed_cache') additions.push(['view_count', 'INTEGER'])
      for (const [name, type] of additions) {
        if (!cols.has(name)) {
          db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`)
        }
      }
    } catch (err) {
      logger.warn(`Migration failed for ${table}:`, { error: err.message })
    }
  }

  // Migrate: fix 'Your Subscriptions' label to 'My Subscriptions' to match BrowseSection TARGET_LABELS
  try {
    db.exec("UPDATE categories SET label = 'My Subscriptions' WHERE key = 'social_subscriptions' AND label = 'Your Subscriptions'")
    db.exec("UPDATE sources SET label = 'My Subscriptions' WHERE domain = 'subscriptions' AND label = 'Your Subscriptions'")
  } catch {}

  // Migrate: fix social_trending + social_shorts to ytsearch queries -- SPA pages can't be extracted by yt-dlp
  try {
    db.prepare("UPDATE categories SET query = 'ytsearch10:trending videos today' WHERE key = 'social_trending' AND query = 'https://www.youtube.com/feed/trending'").run()
    db.prepare("UPDATE categories SET query = 'ytsearch10:youtube shorts trending today' WHERE key = 'social_shorts' AND query = 'https://www.youtube.com/shorts'").run()
    db.prepare("DELETE FROM homepage_cache WHERE category_key IN ('social_trending', 'social_shorts') AND viewed = 0").run()
  } catch {}

  // Migrate: add title + thumbnail columns to video_ratings if missing
  try {
    const cols = db.prepare("PRAGMA table_info(video_ratings)").all()
    if (cols.length > 0 && !cols.some(c => c.name === 'title')) {
      db.exec("ALTER TABLE video_ratings ADD COLUMN title TEXT")
      db.exec("ALTER TABLE video_ratings ADD COLUMN thumbnail TEXT")
    }
  } catch {}

  // Migrate: seed taste_profile from existing tag_preferences (one-time)
  try {
    const tasteCount = db.prepare('SELECT COUNT(*) as n FROM taste_profile').get()
    if (tasteCount.n === 0) {
      const tagPrefs = db.prepare('SELECT tag, preference, updated_at FROM tag_preferences').all()
      if (tagPrefs.length > 0) {
        const insertTaste = db.prepare(
          'INSERT INTO taste_profile (signal_type, signal_value, weight, surface_key, updated_at) VALUES (?, ?, ?, NULL, ?)'
        )
        for (const tp of tagPrefs) {
          const weight = tp.preference === 'liked' ? 0.5 : -0.5
          insertTaste.run('tag', tp.tag, weight, tp.updated_at || new Date().toISOString())
        }
        logger.info('Migrated tag_preferences into taste_profile', { count: tagPrefs.length })
      }
    }
  } catch (err) {
    logger.error('taste_profile migration failed:', { error: err.message })
  }

  logger.info('Database initialized', { path: DB_PATH })
  return db
}
