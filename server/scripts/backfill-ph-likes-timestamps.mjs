#!/usr/bin/env node
// ============================================================
// Backfill ph_likes timestamps
//
// One-time pass over existing persistent_row_items WHERE row_key='ph_likes'
// to populate `upload_date` (via yt-dlp) and `liked_at` (re-scrape PH
// favorites and match by URL).
//
// Why: bulk import collapsed every row to the same `added_at` and left
// `upload_date` + `liked_at` null, so the carousel sort fell back to
// score-only and the same video pinned itself to the hero forever.
//
// Run: node server/scripts/backfill-ph-likes-timestamps.mjs
//      node server/scripts/backfill-ph-likes-timestamps.mjs --limit 20
//      node server/scripts/backfill-ph-likes-timestamps.mjs --dry-run
//
// Safe to run multiple times — only writes a row when the new value is
// non-null and the existing value is null.
// ============================================================

import { execFile } from 'child_process'
import { promisify } from 'util'
import { initDatabase, db } from '../database.js'
import { getCookieArgs } from '../cookies.js'
import { fetchLikes, _closePornhubPersonalBrowser } from '../sources/pornhub-personal.js'

const execFileAsync = promisify(execFile)
const MAX_BUFFER = 50 * 1024 * 1024

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const limitArg = args.indexOf('--limit')
const limit = limitArg >= 0 ? parseInt(args[limitArg + 1], 10) || 0 : 0
const concurrency = 3

initDatabase()

async function fetchUploadDate(url) {
  const cookieArgs = getCookieArgs(url)
  const ytArgs = [
    ...cookieArgs,
    '--dump-json',
    '--no-download',
    '--ignore-errors',
    '--no-warnings',
    url,
  ]
  try {
    const { stdout } = await execFileAsync('yt-dlp', ytArgs, {
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
    })
    const line = stdout.split('\n').find(l => l.trim().startsWith('{'))
    if (!line) return null
    const raw = JSON.parse(line)
    const ud = raw.upload_date
    if (typeof ud !== 'string' || !/^\d{8}$/.test(ud)) return null
    return `${ud.slice(0, 4)}-${ud.slice(4, 6)}-${ud.slice(6, 8)}`
  } catch {
    return null
  }
}

async function pool(items, concurrency, worker) {
  const out = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++
      out[idx] = await worker(items[idx], idx)
    }
  })
  await Promise.all(workers)
  return out
}

async function main() {
  const updateUpload = db.prepare(
    `UPDATE persistent_row_items
        SET upload_date = ?
      WHERE row_key = 'ph_likes' AND video_url = ? AND upload_date IS NULL`
  )
  const updateLiked = db.prepare(
    `UPDATE persistent_row_items
        SET liked_at = ?
      WHERE row_key = 'ph_likes' AND video_url = ? AND liked_at IS NULL`
  )

  // ---- 1. Re-scrape PH favorites to capture liked_at ISO timestamps ----
  console.log('=== Step 1: re-scraping PH favorites for liked_at ===')
  let likes = []
  try {
    likes = await fetchLikes({ limit: 500 })
    console.log(`  scraped ${likes.length} cards`)
  } catch (err) {
    console.warn(`  scrape failed (will skip liked_at backfill): ${err.message}`)
  } finally {
    await _closePornhubPersonalBrowser()
  }

  let likedAtBackfilled = 0
  for (const it of likes) {
    if (!it.url || !it.liked_at) continue
    if (dryRun) {
      console.log(`  [dry] would set liked_at=${it.liked_at} for ${it.url}`)
      likedAtBackfilled++
      continue
    }
    const info = updateLiked.run(it.liked_at, it.url)
    if (info.changes > 0) likedAtBackfilled++
  }
  console.log(`  liked_at backfilled: ${likedAtBackfilled}`)

  // ---- 2. yt-dlp pass for upload_date on every row still missing it ----
  console.log('\n=== Step 2: yt-dlp upload_date for rows still missing it ===')
  let rows = db.prepare(
    `SELECT video_url, title FROM persistent_row_items
       WHERE row_key = 'ph_likes' AND upload_date IS NULL
       ORDER BY video_url`
  ).all()
  console.log(`  ${rows.length} rows missing upload_date`)
  if (limit > 0 && rows.length > limit) {
    rows = rows.slice(0, limit)
    console.log(`  capped to ${rows.length} rows by --limit`)
  }

  let uploadOk = 0
  let uploadFail = 0
  let processed = 0
  await pool(rows, concurrency, async (row) => {
    const ud = await fetchUploadDate(row.video_url)
    processed++
    if (!ud) {
      uploadFail++
      return
    }
    if (dryRun) {
      console.log(`  [dry] would set upload_date=${ud} for ${row.video_url}`)
      uploadOk++
      return
    }
    const info = updateUpload.run(ud, row.video_url)
    if (info.changes > 0) uploadOk++
    if (processed % 10 === 0) {
      console.log(`  ${processed}/${rows.length} (upload_date ok=${uploadOk} fail=${uploadFail})`)
    }
  })
  console.log(`  upload_date backfilled: ${uploadOk}; failed/missing: ${uploadFail}`)

  // ---- 3. Summary ----
  const totals = db.prepare(
    `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN upload_date IS NOT NULL THEN 1 ELSE 0 END) AS with_upload,
        SUM(CASE WHEN liked_at IS NOT NULL THEN 1 ELSE 0 END) AS with_liked
       FROM persistent_row_items
      WHERE row_key = 'ph_likes'`
  ).get()
  console.log('\n=== Summary (ph_likes) ===')
  console.log(`  total rows:          ${totals.total}`)
  console.log(`  with upload_date:    ${totals.with_upload}`)
  console.log(`  with liked_at:       ${totals.with_liked}`)
  if (dryRun) console.log('  (dry run — no DB writes)')
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Backfill failed:', err)
    process.exit(1)
  })
