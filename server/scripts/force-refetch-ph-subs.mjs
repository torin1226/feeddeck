// One-shot: clear ph_subs persistent row state, re-fetch via the
// scraper, and report how many items end up in the DB. Used to verify
// the pagination fix without waiting for the warm-cache cooldown.

import { initDatabase, db } from '../database.js'
import {
  fetchSubscriptionsFeed,
  _closePornhubPersonalBrowser,
} from '../sources/pornhub-personal.js'

initDatabase()

const ROW_KEY = 'ph_subs'

async function main() {
  const before = db.prepare(
    'SELECT COUNT(*) AS n FROM persistent_row_items WHERE row_key = ?'
  ).get(ROW_KEY).n
  console.log(`Before: ${before} items in persistent_row_items for ${ROW_KEY}`)

  db.prepare('UPDATE persistent_rows SET last_fetched = NULL WHERE key = ?').run(ROW_KEY)
  db.prepare('DELETE FROM persistent_row_items WHERE row_key = ?').run(ROW_KEY)
  console.log(`Cleared row state.`)

  const items = await fetchSubscriptionsFeed({ limit: 50 })
  console.log(`fetchSubscriptionsFeed returned ${items.length} items.`)

  const upsert = db.prepare(`
    INSERT OR REPLACE INTO persistent_row_items
      (row_key, video_url, title, thumbnail, duration, uploader,
       view_count, like_count, upload_date, liked_at, tags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  let added = 0
  for (const it of items) {
    if (!it.url) continue
    const tagsJson = Array.isArray(it.tags) ? JSON.stringify(it.tags) : (it.tags || '[]')
    upsert.run(
      ROW_KEY, it.url, it.title || '', it.thumbnail || '',
      it.duration || 0, it.uploader || '',
      it.view_count ?? null, it.like_count ?? null,
      it.upload_date ?? null, it.liked_at ?? null, tagsJson
    )
    added++
  }
  db.prepare("UPDATE persistent_rows SET last_fetched = datetime('now') WHERE key = ?").run(ROW_KEY)

  const after = db.prepare(
    'SELECT COUNT(*) AS n FROM persistent_row_items WHERE row_key = ?'
  ).get(ROW_KEY).n
  console.log(`Inserted ${added}; persistent_row_items now has ${after} rows for ${ROW_KEY}.`)

  const sample = db.prepare(
    `SELECT title, uploader FROM persistent_row_items WHERE row_key = ? LIMIT 5`
  ).all(ROW_KEY)
  console.log(`Sample:`)
  sample.forEach((r, i) => console.log(`  ${i + 1}. ${r.title?.slice(0, 60)} | ${r.uploader}`))
}

main()
  .catch(err => {
    console.error('Force-refetch failed:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await _closePornhubPersonalBrowser()
    process.exit(process.exitCode || 0)
  })
