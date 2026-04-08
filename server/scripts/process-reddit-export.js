/**
 * process-reddit-export.js
 *
 * Parses a Reddit GDPR data export and seeds FeedDeck's recommendation engine.
 *
 * What it does:
 * 1. Reads subscribed_subreddits.csv, comment_votes.csv, post_votes.csv, comments.csv
 * 2. Builds a weighted interest graph from engagement signals
 * 3. Maps subreddits to FeedDeck content tags/categories
 * 4. Inserts top tags into tag_preferences as 'liked'
 * 5. Stores seed metadata in preferences table
 *
 * Usage:
 *   node server/scripts/process-reddit-export.js <path-to-export-folder>
 *   node server/scripts/process-reddit-export.js ./reddit-export --dry-run
 *
 * Or via API:
 *   POST /api/recommendations/seed-reddit  (body: { exportPath } or multipart upload)
 */

import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
// Lazy import - only needed when actually writing to DB
let Database;
async function getDatabase() {
  if (!Database) {
    const mod = await import('better-sqlite3');
    Database = mod.default;
  }
  return Database;
}

// ---- Subreddit -> content tag mapping ----
// Maps subreddits to FeedDeck-relevant content tags.
// Unmapped subs are skipped (Reddit has tons of niche subs that don't map to video content).
// Multiple tags per sub are supported for cross-category signal.

const SUBREDDIT_TAG_MAP = {
  // Design & UX (strong signal - user comments here)
  'UXDesign': ['ux-design', 'design', 'product-design'],
  'UI_Design': ['ui-design', 'design'],
  'UIUX': ['ux-design', 'ui-design', 'design'],
  'UX_Design': ['ux-design', 'design'],
  'UXResearch': ['ux-research', 'design'],
  'graphic_design': ['graphic-design', 'design'],
  'FigmaDesign': ['figma', 'design', 'design-tools'],
  'Design': ['design'],
  'DesignNews': ['design', 'design-news'],
  'DesignThinking': ['design', 'strategy'],
  'designthought': ['design', 'strategy'],
  'designmemes': ['design', 'humor'],
  'productdesign': ['product-design', 'design'],
  'UserExperienceDesign': ['ux-design', 'design'],
  'usability': ['ux-design', 'usability'],
  'userexperience': ['ux-design'],
  'Windows_Redesign': ['ui-design', 'design'],
  'visualization': ['data-visualization', 'design'],
  'xrdesign': ['xr-design', 'design', 'emerging-tech'],
  'assholedesign': ['design', 'humor'],

  // Management & Leadership (strongest comment signal)
  'managers': ['management', 'leadership', 'career'],
  'Leadership': ['leadership', 'management'],
  'ProductManagement': ['product-management', 'career'],

  // Tech & AI
  'technology': ['technology', 'tech-news'],
  'technews': ['technology', 'tech-news'],
  'tech': ['technology'],
  'ChatGPT': ['ai', 'technology', 'generative-ai'],
  'Anthropic': ['ai', 'technology', 'generative-ai'],
  'generativeAI': ['ai', 'generative-ai', 'technology'],
  'ArtificialInteligence': ['ai', 'technology'],
  'ProgrammerHumor': ['programming', 'humor'],
  'virtualreality': ['vr', 'emerging-tech'],
  'augmentedreality': ['ar', 'emerging-tech'],
  'nasa': ['space', 'science'],
  'space': ['space', 'science'],

  // Finance & Investing
  'fatFIRE': ['finance', 'fire', 'investing'],
  'ChubbyFIRE': ['finance', 'fire', 'investing'],
  'coastFIRE': ['finance', 'fire'],
  'HENRYfinance': ['finance', 'high-income'],
  'RichPeoplePF': ['finance', 'wealth'],
  'personalfinance': ['finance', 'personal-finance'],
  'MiddleClassFinance': ['finance'],
  'stocks': ['investing', 'stocks'],
  'StockMarket': ['investing', 'stocks'],
  'wallstreetbets': ['investing', 'stocks', 'memes'],
  'investing': ['investing', 'finance'],
  'realestateinvesting': ['real-estate', 'investing'],
  'CommercialRealEstate': ['real-estate', 'investing'],
  'Economics': ['economics', 'finance'],

  // Entertainment & Media
  'television': ['tv', 'entertainment'],
  'entertainment': ['entertainment'],
  'TheHandmaidsTale': ['tv', 'sci-fi'],
  'IASIP': ['tv', 'comedy'],
  'thewalkingdead': ['tv', 'horror'],
  'NetflixBestOf': ['streaming', 'entertainment'],
  'MovieDetails': ['movies', 'entertainment'],
  'Filmmakers': ['filmmaking', 'creative'],
  'animation': ['animation', 'creative'],

  // Sci-Fi & Books
  'startrek': ['sci-fi', 'tv'],
  'startrekgifs': ['sci-fi', 'tv'],
  'DaystromInstitute': ['sci-fi', 'deep-dive'],
  'Starfield': ['gaming', 'sci-fi'],
  'bobiverse': ['sci-fi', 'books'],
  'exfor': ['sci-fi', 'books'],
  'AskScienceFiction': ['sci-fi'],
  'books': ['books', 'reading'],
  'Futurology': ['futurism', 'technology'],

  // Humor & Memes
  'funny': ['humor'],
  'memes': ['humor', 'memes'],
  'dankmemes': ['humor', 'memes'],
  'dankchristianmemes': ['humor', 'memes'],
  'HighQualityGifs': ['humor', 'gifs'],
  'comedyheaven': ['humor'],
  'KenM': ['humor'],
  'FellowKids': ['humor'],
  'BikiniBottomTwitter': ['humor', 'memes'],
  'shittyaskscience': ['humor'],
  'standupshots': ['humor', 'standup-comedy'],
  'ux_memes': ['humor', 'design'],
  'nflmemes': ['humor', 'sports'],

  // Stories & Drama
  'AskReddit': ['stories', 'discussion'],
  'AmItheAsshole': ['stories', 'drama'],
  'AITAH': ['stories', 'drama'],
  'BestofRedditorUpdates': ['stories', 'drama'],
  'confession': ['stories', 'drama'],
  'confessions': ['stories', 'drama'],
  'tifu': ['stories', 'humor'],
  'MaliciousCompliance': ['stories', 'revenge'],
  'pettyrevenge': ['stories', 'revenge'],
  'ProRevenge': ['stories', 'revenge'],
  'NuclearRevenge': ['stories', 'revenge'],
  'relationships': ['stories', 'relationships'],
  'okstorytime': ['stories'],

  // Science & Learning
  'todayilearned': ['educational', 'facts'],
  'askscience': ['science', 'educational'],
  'explainlikeimfive': ['educational'],
  'AskHistorians': ['history', 'educational'],
  'history': ['history', 'educational'],
  'educationalgifs': ['educational', 'gifs'],
  'wikipedia': ['educational'],

  // Interesting/Viral content
  'interestingasfuck': ['interesting', 'viral'],
  'Damnthatsinteresting': ['interesting', 'viral'],
  'ThatsInsane': ['interesting', 'viral'],
  'blackmagicfuckery': ['interesting', 'viral'],
  'woahdude': ['interesting', 'trippy'],
  'nevertellmetheodds': ['interesting', 'viral'],
  'natureismetal': ['nature', 'interesting'],

  // Sports
  'nfl': ['sports', 'football'],
  'panthers': ['sports', 'football'],
  'sports': ['sports'],
  'Madden': ['gaming', 'sports'],

  // Music & Festivals
  'bonnaroo': ['music', 'festivals'],
  'musicfestivals': ['music', 'festivals'],

  // Military
  'Military': ['military'],

  // Culture
  'BlackHair': ['culture', 'hair-care'],
  'BlackPeopleTwitter': ['culture', 'humor'],
  'NPHCdivine9': ['culture', 'greek-life'],
  'blackpeoplegifs': ['culture', 'humor'],
  'wholesomebpt': ['culture', 'wholesome'],

  // Politics (low weight for video recs, but signals engagement)
  'Conservative': ['politics'],
  'Liberal': ['politics'],
  'NeutralPolitics': ['politics'],
  'moderatepolitics': ['politics'],
  'PoliticalDiscussion': ['politics'],
  'democrats': ['politics'],
  'Libertarian': ['politics'],
  'PoliticalHumor': ['politics', 'humor'],

  // Startups & Business
  'startups': ['startups', 'business'],
  'business': ['business'],
  'EntrepreneurRideAlong': ['startups', 'business'],

  // Fashion
  'streetwear': ['fashion', 'streetwear'],
  'malefashionadvice': ['fashion'],
  'frugalmalefashion': ['fashion', 'deals'],
  'midsoledeals': ['sneakers', 'fashion', 'deals'],

  // Dogs
  'Dogowners': ['dogs', 'pets'],
  'Dogtraining': ['dogs', 'pets'],
  'DogTrainingTips': ['dogs', 'pets'],
  'reactivedogs': ['dogs', 'pets'],
  'WhatsWrongWithYourDog': ['dogs', 'pets', 'humor'],

  // Gaming
  'gaming': ['gaming'],
  'GamingLaptops': ['gaming', 'tech'],
  'LineWar': ['gaming'],

  // NSFW (maps to NSFW mode tags)
  'sex': ['nsfw', 'sex-education'],

  // Gadgets & Tech Products
  'gadgets': ['gadgets', 'tech'],

  // Fail/cringe/viral video content (high engagement, maps well to video)
  'mildlyinfuriating': ['interesting', 'cringe'],
  'WTF': ['wtf', 'viral', 'interesting'],
  'PublicFreakout': ['freakout', 'viral'],
  'sadcringe': ['cringe', 'humor'],
  'instant_regret': ['fails', 'humor', 'viral'],
  'therewasanattempt': ['fails', 'humor'],
  'HolUp': ['humor', 'memes'],
  'maybemaybemaybe': ['interesting', 'viral'],
  'Whatcouldgowrong': ['fails', 'humor', 'viral'],
  'UNBGBBIIVCHIDCTIICBG': ['interesting', 'viral'],
  'pics': ['photography', 'interesting'],
  'LifeProTips': ['life-hacks', 'educational'],
  'KidsAreFuckingStupid': ['humor', 'fails'],
  'PeopleFuckingDying': ['humor', 'wholesome'],
  'yesyesyesno': ['fails', 'humor'],
  'nonononoyes': ['interesting', 'viral'],
  'killthecameraman': ['humor', 'viral'],
  'PraiseTheCameraMan': ['filmmaking', 'viral'],
  'gifsthatkeepongiving': ['humor', 'gifs'],
  'chemicalreactiongifs': ['science', 'educational'],
  'ManufacturingPorn': ['manufacturing', 'interesting'],

  // Parenting
  'Autism_Parenting': ['parenting', 'autism'],

  // DC area
  'washingtondc': ['dc-area', 'local'],
  'oakland': ['oakland', 'local'],

  // Psychedelics
  'Psychedelics': ['psychedelics'],
};

// ---- Signal weights ----
// Comment votes are the strongest signal (active engagement).
// Comments are even stronger (you took time to write).
// Post votes are medium. Subscriptions are weak (passive).
const WEIGHTS = {
  comment: 5,       // You wrote something
  comment_vote: 2,  // You upvoted a comment
  post_vote: 1.5,   // You upvoted a post
  subscription: 0.5, // You subscribed (passive)
};

// ---- CSV parser (simple, handles quoted fields with commas) ----
function parseCSV(content) {
  const lines = content.split('\n');
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);
  const rows = [];

  let i = 1;
  while (i < lines.length) {
    let line = lines[i];
    // Handle multi-line quoted fields
    while (line && (line.split('"').length - 1) % 2 !== 0 && i + 1 < lines.length) {
      i++;
      line += '\n' + lines[i];
    }
    if (line.trim()) {
      const values = parseCSVLine(line);
      if (values.length >= headers.length) {
        const row = {};
        headers.forEach((h, idx) => row[h] = values[idx] || '');
        rows.push(row);
      }
    }
    i++;
  }
  return rows;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

// ---- Extract subreddit from Reddit permalink ----
function extractSubreddit(permalink) {
  const match = permalink?.match(/\/r\/([^/]+)/);
  return match ? match[1] : null;
}

// ---- Main processing logic ----
export function processRedditExport(exportPath) {
  const results = {
    subredditsFound: 0,
    subredditsMapped: 0,
    commentVotesProcessed: 0,
    postVotesProcessed: 0,
    commentsProcessed: 0,
    subscriptionsProcessed: 0,
    tagsGenerated: 0,
    topTags: [],
    unmappedSubreddits: [],
    tagScores: {},
  };

  // -- Read all CSV files --
  const files = {
    subscriptions: join(exportPath, 'subscribed_subreddits.csv'),
    commentVotes: join(exportPath, 'comment_votes.csv'),
    postVotes: join(exportPath, 'post_votes.csv'),
    comments: join(exportPath, 'comments.csv'),
  };

  // Accumulate subreddit engagement scores
  const subScores = {};
  const addScore = (sub, weight) => {
    if (!sub) return;
    subScores[sub] = (subScores[sub] || 0) + weight;
  };

  // 1. Comment votes (strongest passive signal)
  if (existsSync(files.commentVotes)) {
    const content = readFileSync(files.commentVotes, 'utf-8');
    const rows = parseCSV(content);
    for (const row of rows) {
      if (row.direction === 'up') {
        const sub = extractSubreddit(row.permalink);
        addScore(sub, WEIGHTS.comment_vote);
        results.commentVotesProcessed++;
      }
    }
  }

  // 2. Post votes
  if (existsSync(files.postVotes)) {
    const content = readFileSync(files.postVotes, 'utf-8');
    const rows = parseCSV(content);
    for (const row of rows) {
      if (row.direction === 'up') {
        const sub = extractSubreddit(row.permalink);
        addScore(sub, WEIGHTS.post_vote);
        results.postVotesProcessed++;
      }
    }
  }

  // 3. Comments (strongest active signal)
  if (existsSync(files.comments)) {
    const content = readFileSync(files.comments, 'utf-8');
    const rows = parseCSV(content);
    for (const row of rows) {
      const sub = row.subreddit || extractSubreddit(row.permalink);
      addScore(sub, WEIGHTS.comment);
      results.commentsProcessed++;
    }
  }

  // 4. Subscriptions (weakest signal)
  if (existsSync(files.subscriptions)) {
    const content = readFileSync(files.subscriptions, 'utf-8');
    const rows = parseCSV(content);
    for (const row of rows) {
      const sub = row.subreddit;
      if (sub) {
        addScore(sub, WEIGHTS.subscription);
        results.subscriptionsProcessed++;
      }
    }
  }

  results.subredditsFound = Object.keys(subScores).length;

  // -- Map subreddits to content tags --
  const tagScores = {};
  const mappedSubs = new Set();
  const unmappedSubs = [];

  for (const [sub, score] of Object.entries(subScores)) {
    const tags = SUBREDDIT_TAG_MAP[sub];
    if (tags) {
      mappedSubs.add(sub);
      for (const tag of tags) {
        tagScores[tag] = (tagScores[tag] || 0) + score;
      }
    } else if (score >= 3) {
      // Only report unmapped subs with meaningful engagement
      unmappedSubs.push({ sub, score });
    }
  }

  results.subredditsMapped = mappedSubs.size;
  results.unmappedSubreddits = unmappedSubs
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  // -- Rank tags by score --
  const rankedTags = Object.entries(tagScores)
    .map(([tag, score]) => ({ tag, score: Math.round(score * 10) / 10 }))
    .sort((a, b) => b.score - a.score);

  results.tagScores = tagScores;
  results.topTags = rankedTags.slice(0, 40);
  results.tagsGenerated = rankedTags.length;

  return { results, rankedTags, subScores };
}

// ---- Database seeding ----
export async function seedTagPreferences(dbPath, rankedTags, options = {}) {
  const { maxTags = 30, minScore = 5, dryRun = false } = options;

  const tagsToInsert = rankedTags
    .filter(t => t.score >= minScore)
    .slice(0, maxTags);

  if (dryRun) {
    return {
      wouldInsert: tagsToInsert,
      count: tagsToInsert.length,
    };
  }

  const DB = await getDatabase();
  const db = new DB(dbPath);

  // Get existing tag preferences to avoid overwriting manual choices
  const existing = new Set(
    db.prepare('SELECT tag FROM tag_preferences').all().map(r => r.tag)
  );

  const insert = db.prepare(
    `INSERT OR IGNORE INTO tag_preferences (tag, preference, updated_at)
     VALUES (?, 'liked', datetime('now'))`
  );

  let inserted = 0;
  const skipped = [];

  const insertMany = db.transaction((tags) => {
    for (const { tag, score } of tags) {
      const normalizedTag = tag.trim().toLowerCase();
      if (existing.has(normalizedTag)) {
        skipped.push({ tag: normalizedTag, reason: 'already exists' });
        continue;
      }
      insert.run(normalizedTag);
      inserted++;
    }
  });

  insertMany(tagsToInsert);

  // Store seed metadata
  const upsertPref = db.prepare(
    `INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)`
  );
  upsertPref.run('reddit_seed_at', new Date().toISOString());
  upsertPref.run('reddit_seed_count', String(inserted));
  upsertPref.run('reddit_username', 'super_calman');

  db.close();

  return { inserted, skipped, total: tagsToInsert.length };
}

// ---- CLI entrypoint ----
if (process.argv[1]?.endsWith('process-reddit-export.js')) {
  const exportPath = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');
  const dbPath = process.argv.find(a => a.startsWith('--db='))?.split('=')[1]
    || join(process.argv[1], '../../..', 'data/library.db');

  if (!exportPath) {
    console.error('Usage: node process-reddit-export.js <export-folder> [--dry-run] [--db=path]');
    process.exit(1);
  }

  const resolvedPath = resolve(exportPath);
  if (!existsSync(resolvedPath)) {
    console.error(`Export folder not found: ${resolvedPath}`);
    process.exit(1);
  }

  console.log(`\nProcessing Reddit export from: ${resolvedPath}`);
  console.log(dryRun ? '(DRY RUN - no database changes)\n' : '\n');

  const { results, rankedTags } = processRedditExport(resolvedPath);

  console.log('=== Reddit Export Analysis ===');
  console.log(`Subreddits found: ${results.subredditsFound}`);
  console.log(`Subreddits mapped: ${results.subredditsMapped}`);
  console.log(`Comment votes processed: ${results.commentVotesProcessed}`);
  console.log(`Post votes processed: ${results.postVotesProcessed}`);
  console.log(`Comments processed: ${results.commentsProcessed}`);
  console.log(`Subscriptions processed: ${results.subscriptionsProcessed}`);
  console.log(`Tags generated: ${results.tagsGenerated}`);

  console.log('\n=== Top 30 Tags by Engagement Score ===');
  for (const { tag, score } of results.topTags.slice(0, 30)) {
    const bar = '█'.repeat(Math.min(Math.round(score / 10), 40));
    console.log(`  ${tag.padEnd(24)} ${String(score).padStart(6)} ${bar}`);
  }

  if (results.unmappedSubreddits.length > 0) {
    console.log('\n=== Unmapped Subreddits (high engagement, need mapping) ===');
    for (const { sub, score } of results.unmappedSubreddits.slice(0, 15)) {
      console.log(`  r/${sub.padEnd(28)} score: ${score}`);
    }
  }

  if (!dryRun && existsSync(resolve(dbPath))) {
    console.log(`\n=== Seeding Database: ${dbPath} ===`);
    const seedResult = await seedTagPreferences(dbPath, rankedTags);
    console.log(`Inserted: ${seedResult.inserted} tags`);
    console.log(`Skipped: ${seedResult.skipped.length} (already existed)`);
  } else if (dryRun) {
    const dryResult = await seedTagPreferences('', rankedTags, { dryRun: true });
    console.log(`\n=== Dry Run: Would insert ${dryResult.count} tags ===`);
    for (const { tag, score } of dryResult.wouldInsert) {
      console.log(`  + ${tag} (score: ${score})`);
    }
  } else {
    console.log(`\nDatabase not found at ${dbPath}, skipping seed.`);
    console.log('Run with --db=<path> to specify database location.');
  }

  console.log('\nDone.');
}
