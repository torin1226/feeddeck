import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('data/library.db');

// Homepage cache by category_key
const homepage = db.prepare(`SELECT category_key, COUNT(*) as total, SUM(CASE WHEN viewed = 0 THEN 1 ELSE 0 END) as unwatched, MIN(fetched_at) as oldest, MAX(fetched_at) as newest FROM homepage_cache GROUP BY category_key`).all();
console.log("=== HOMEPAGE CACHE ===");
console.log("Categories:", homepage.length);
const lowCats = homepage.filter(r => r.unwatched < 8);
console.log("Low categories (<8 unwatched):", lowCats.length);
if (lowCats.length > 0) lowCats.forEach(c => console.log(`  LOW: ${c.category_key} unwatched=${c.unwatched}`));
const totalUnwatched = homepage.reduce((s, r) => s + r.unwatched, 0);
console.log("Total unwatched:", totalUnwatched);
console.log();

// Feed cache by mode and source
const feed = db.prepare(`SELECT mode, source_domain, COUNT(*) as total, SUM(CASE WHEN watched = 0 THEN 1 ELSE 0 END) as unwatched FROM feed_cache GROUP BY mode, source_domain`).all();
console.log("=== FEED CACHE ===");
const byMode = {};
feed.forEach(r => { if (!byMode[r.mode]) byMode[r.mode] = { total: 0, unwatched: 0, sources: 0 }; byMode[r.mode].total += r.total; byMode[r.mode].unwatched += r.unwatched; byMode[r.mode].sources++; });
Object.entries(byMode).forEach(([mode, data]) => console.log(`  ${mode}: ${data.unwatched} unwatched / ${data.total} total from ${data.sources} sources`));
console.log();

// Sources
const sources = db.prepare('SELECT domain, mode, weight, active FROM sources ORDER BY mode, weight DESC').all();
console.log("=== SOURCES ===");
sources.forEach(s => console.log(`  ${s.mode} ${s.domain} w=${s.weight} ${s.active ? 'ACTIVE' : 'INACTIVE'}`));
console.log();

// Expired stream URLs
const expired = db.prepare(`SELECT COUNT(*) as count FROM feed_cache WHERE watched = 0 AND (stream_url IS NULL OR expires_at < datetime('now'))`).get();
const totalFeedUnwatched = Object.values(byMode).reduce((s, m) => s + m.unwatched, 0);
console.log("=== EXPIRED/NULL STREAM URLS (unwatched) ===");
console.log(`Count: ${expired.count} / ${totalFeedUnwatched} (${(expired.count/totalFeedUnwatched*100).toFixed(1)}%)`);
console.log();

// NSFW source diversity
const nsfwSources = db.prepare(`SELECT source_domain, COUNT(*) as cnt FROM feed_cache WHERE mode = 'nsfw' AND watched = 0 GROUP BY source_domain ORDER BY cnt DESC`).all();
console.log("=== NSFW SOURCE DIVERSITY ===");
const nsfwTotal = nsfwSources.reduce((s, r) => s + r.cnt, 0);
nsfwSources.forEach(s => console.log(`  ${s.source_domain}: ${s.cnt} (${(s.cnt/nsfwTotal*100).toFixed(1)}%)`));
console.log();

// Social subscription coverage
try {
  const subFeeds = db.prepare(`SELECT source_domain, COUNT(*) as cnt FROM feed_cache WHERE mode = 'social' AND watched = 0 GROUP BY source_domain ORDER BY cnt DESC`).all();
  console.log("=== SOCIAL SOURCE BREAKDOWN ===");
  subFeeds.forEach(s => console.log(`  ${s.source_domain}: ${s.cnt}`));

  // Check subscription_backups table
  const subCount = db.prepare("SELECT COUNT(*) as cnt FROM subscription_backups").get();
  console.log(`\n  Subscription backups: ${subCount.cnt} entries`);
} catch(e) { console.log("Social breakdown error:", e.message); }
console.log();

// Stale homepage categories (>48h since last fetch)
const staleHomepage = db.prepare(`SELECT category_key, MAX(fetched_at) as newest FROM homepage_cache GROUP BY category_key HAVING newest < datetime('now', '-48 hours')`).all();
console.log("=== STALE HOMEPAGE CATEGORIES (>48h) ===");
console.log("Count:", staleHomepage.length);
if (staleHomepage.length > 0) staleHomepage.slice(0, 10).forEach(s => console.log(`  ${s.category_key} last=${s.newest}`));
console.log();

// Random samples for quality calibration
const socialSample = db.prepare(`SELECT title, source_domain FROM feed_cache WHERE mode = 'social' AND watched = 0 ORDER BY RANDOM() LIMIT 2`).all();
const nsfwSample = db.prepare(`SELECT title, source_domain FROM feed_cache WHERE mode = 'nsfw' AND watched = 0 ORDER BY RANDOM() LIMIT 2`).all();
console.log("=== QUALITY CALIBRATION SAMPLES ===");
console.log("Social:");
socialSample.forEach(s => console.log(`  - "${s.title}" [${s.source_domain}]`));
console.log("NSFW:");
nsfwSample.forEach(s => console.log(`  - "${s.title}" [${s.source_domain}]`));

db.close();
