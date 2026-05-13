#!/usr/bin/env node
// One-shot evidence capture for the idx_feed_cache_mode migration.
// Runs against a copy of the production DB, never modifies the live file.
// Usage: node server/scripts/probe-feed-cache-index.mjs <path-to-db>

import { DatabaseSync } from 'node:sqlite'
import { migrateFeedCacheModeIndex } from '../database.js'

const dbPath = process.argv[2]
if (!dbPath) {
  console.error('Usage: probe-feed-cache-index.mjs <path-to-db>')
  process.exit(1)
}

const db = new DatabaseSync(dbPath)

const HOT_QUERY = `
  SELECT id FROM feed_cache
  WHERE mode = ? AND watched = 0
  ORDER BY fetched_at DESC
  LIMIT 500
`

const COUNT_QUERY = 'SELECT COUNT(*) AS n FROM feed_cache WHERE mode = ? AND watched = 0'

function explain(sql, ...params) {
  return db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params).map(r => r.detail).join('\n')
}

function timeQuery(sql, params, runs = 5) {
  const times = []
  for (let i = 0; i < runs; i++) {
    const start = process.hrtime.bigint()
    db.prepare(sql).all(...params)
    const end = process.hrtime.bigint()
    times.push(Number(end - start) / 1e6)
  }
  times.sort((a, b) => a - b)
  return times[Math.floor(times.length / 2)]
}

function indexInfo(name) {
  const info = db.prepare(`PRAGMA index_info('${name}')`).all()
  return info.map(c => c.name).join(', ')
}

console.log('=== idx_feed_cache_mode migration probe ===')
console.log(`DB: ${dbPath}\n`)

// Force-reset to the OLD shape so we can capture an apples-to-apples
// BEFORE/AFTER. Safe on a clone; never run against the live DB.
const currentInfo = db.prepare("PRAGMA index_info('idx_feed_cache_mode')").all()
if (currentInfo[2]?.name === 'fetched_at') {
  console.log('Index is already on new shape; reverting to (mode, watched, expires_at) for the BEFORE measurement.\n')
  db.exec('DROP INDEX idx_feed_cache_mode')
  db.exec('CREATE INDEX idx_feed_cache_mode ON feed_cache(mode, watched, expires_at)')
}

const countNsfw = db.prepare(COUNT_QUERY).get('nsfw').n
const countSocial = db.prepare(COUNT_QUERY).get('social').n
console.log('Row counts (mode=?, watched=0):')
console.log(`  nsfw   = ${countNsfw}`)
console.log(`  social = ${countSocial}\n`)

console.log('--- BEFORE migration ---')
console.log(`Index columns: ${indexInfo('idx_feed_cache_mode') || '(missing)'}`)
console.log('\nEXPLAIN candidate-pool nsfw:')
console.log(explain(HOT_QUERY, 'nsfw'))
console.log(`\np50 nsfw  candidate-pool: ${timeQuery(HOT_QUERY, ['nsfw']).toFixed(2)} ms`)
console.log(`p50 social candidate-pool: ${timeQuery(HOT_QUERY, ['social']).toFixed(2)} ms`)
console.log(`p50 nsfw  unwatched-count: ${timeQuery(COUNT_QUERY, ['nsfw']).toFixed(2)} ms\n`)

console.log('--- Running migrateFeedCacheModeIndex ---')
const startMig = process.hrtime.bigint()
const changed = migrateFeedCacheModeIndex(db)
const elapsedMs = Number(process.hrtime.bigint() - startMig) / 1e6
console.log(`Result: ${changed ? 'migrated' : 'no-op'} (${elapsedMs.toFixed(0)} ms)\n`)

console.log('--- AFTER migration ---')
console.log(`Index columns: ${indexInfo('idx_feed_cache_mode')}`)
console.log('\nEXPLAIN candidate-pool nsfw:')
console.log(explain(HOT_QUERY, 'nsfw'))
console.log(`\np50 nsfw  candidate-pool: ${timeQuery(HOT_QUERY, ['nsfw']).toFixed(2)} ms`)
console.log(`p50 social candidate-pool: ${timeQuery(HOT_QUERY, ['social']).toFixed(2)} ms`)
console.log(`p50 nsfw  unwatched-count: ${timeQuery(COUNT_QUERY, ['nsfw']).toFixed(2)} ms\n`)

const countNsfwAfter = db.prepare(COUNT_QUERY).get('nsfw').n
const countSocialAfter = db.prepare(COUNT_QUERY).get('social').n
console.log('Row counts unchanged (data integrity):')
console.log(`  nsfw   = ${countNsfwAfter} (was ${countNsfw}) ${countNsfwAfter === countNsfw ? 'OK' : 'MISMATCH'}`)
console.log(`  social = ${countSocialAfter} (was ${countSocial}) ${countSocialAfter === countSocial ? 'OK' : 'MISMATCH'}`)

db.close()
