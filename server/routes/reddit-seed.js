/**
 * Reddit seed API route
 *
 * POST /api/recommendations/seed-reddit
 *
 * Accepts a Reddit GDPR export (uploaded zip or extracted folder path)
 * and seeds tag_preferences from engagement data.
 *
 * For Claude Code to wire into server/index.js:
 * 1. Import this route
 * 2. Mount at /api/recommendations/seed-reddit
 * 3. Add multer middleware for zip upload support
 */

import { processRedditExport } from '../scripts/process-reddit-export.js';
import { existsSync } from 'fs';

/**
 * SSE endpoint for Reddit seed (matches existing seed pattern)
 *
 * Query params:
 *   ?path=<export-folder>  - path to extracted Reddit export
 *   ?force=1               - bypass 24h re-seed guard
 *
 * Emits SSE events: status, progress, complete, error
 */
export function handleRedditSeed(req, res, db) {
  const exportPath = req.query.path;
  const force = req.query.force === '1';

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (type, data) => {
    res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
  };

  // Check re-seed guard
  if (!force) {
    const lastSeed = db.prepare(
      "SELECT value FROM preferences WHERE key = 'reddit_seed_at'"
    ).get();
    if (lastSeed) {
      const seedTime = new Date(lastSeed.value).getTime();
      const now = Date.now();
      if (now - seedTime < 24 * 60 * 60 * 1000) {
        send('error', { message: 'Already seeded within 24h. Use ?force=1 to override.' });
        res.end();
        return;
      }
    }
  }

  if (!exportPath || !existsSync(exportPath)) {
    send('error', { message: `Export folder not found: ${exportPath}` });
    res.end();
    return;
  }

  try {
    send('status', { message: 'Processing Reddit export...' });
    send('progress', { phase: 'parse', current: 0, total: 4 });

    const { results, rankedTags } = processRedditExport(exportPath);

    send('progress', { phase: 'parse', current: 4, total: 4 });
    send('status', {
      message: `Parsed ${results.subredditsFound} subreddits, mapped ${results.subredditsMapped}, generated ${results.tagsGenerated} tags`
    });

    // Seed the database
    send('progress', { phase: 'seed', current: 0, total: rankedTags.length });

    // Use the db instance passed from server/index.js instead of opening a new one
    const existing = new Set(
      db.prepare('SELECT tag FROM tag_preferences').all().map(r => r.tag)
    );

    const insert = db.prepare(
      `INSERT OR IGNORE INTO tag_preferences (tag, preference, updated_at)
       VALUES (?, 'liked', datetime('now'))`
    );

    const maxTags = 30;
    const minScore = 5;
    const tagsToInsert = rankedTags.filter(t => t.score >= minScore).slice(0, maxTags);
    let inserted = 0;
    const skipped = [];

    const insertMany = db.transaction((tags) => {
      for (const { tag, score: _score } of tags) {
        const normalized = tag.trim().toLowerCase();
        if (existing.has(normalized)) {
          skipped.push(normalized);
          continue;
        }
        insert.run(normalized);
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

    send('complete', {
      subredditsFound: results.subredditsFound,
      subredditsMapped: results.subredditsMapped,
      tagsGenerated: results.tagsGenerated,
      tagsInserted: inserted,
      tagsSkipped: skipped.length,
      topTags: results.topTags.slice(0, 15).map(t => t.tag),
    });
  } catch (err) {
    send('error', { message: err.message });
  }

  res.end();
}
