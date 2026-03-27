#!/usr/bin/env node
// process-tiktok-imports.js — Process pending TikTok imports using yt-dlp
//
// Usage:
//   node server/scripts/process-tiktok-imports.js --batch 50
//
// Fetches metadata for pending tiktok_imports rows via yt-dlp,
// inserts into the videos table, and marks imports as done/failed.

import { DatabaseSync } from 'node:sqlite'
import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { resolve, join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Parse CLI args
const args = process.argv.slice(2)
function getArg(name, fallback) {
  const idx = args.indexOf(name)
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback
}

const batchSize = parseInt(getArg('--batch', '50'), 10)
const dbPath = resolve(getArg('--db', join(__dirname, '..', '..', 'data', 'library.db')))
const cookiesPath = resolve(getArg('--cookies', join(__dirname, '..', '..', 'data', 'cookies.txt')))

if (!existsSync(dbPath)) {
  console.error(`Database not found: ${dbPath}`)
  process.exit(1)
}

console.log(`Process TikTok Imports`)
console.log(`  Database:   ${dbPath}`)
console.log(`  Batch size: ${batchSize}`)
console.log(`  Cookies:    ${existsSync(cookiesPath) ? cookiesPath : 'not found (proceeding without)'}`)
console.log()

const db = new DatabaseSync(dbPath)
db.exec('PRAGMA journal_mode = WAL')

// Ensure videos table has mode column (should already exist)
try {
  const cols = db.prepare("PRAGMA table_info(videos)").all()
  if (!cols.some(c => c.name === 'mode')) {
    db.exec("ALTER TABLE videos ADD COLUMN mode TEXT NOT NULL DEFAULT 'social'")
  }
} catch {}

const getPending = db.prepare(
  'SELECT id, url, source, tiktok_date, mode FROM tiktok_imports WHERE status = ? ORDER BY id LIMIT ?'
)
const markDone = db.prepare(
  "UPDATE tiktok_imports SET status = 'done', processed_at = datetime('now') WHERE id = ?"
)
const markFailed = db.prepare(
  "UPDATE tiktok_imports SET status = 'failed', processed_at = datetime('now'), error = ? WHERE id = ?"
)
const insertVideo = db.prepare(`
  INSERT OR IGNORE INTO videos (id, url, title, thumbnail, duration, tags, source, mode, added_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
`)

function extractMetadata(url) {
  const args = ['--dump-json', '--no-download', '--no-warnings']
  if (existsSync(cookiesPath)) args.push('--cookies', cookiesPath)
  args.push(url)

  try {
    const output = execFileSync('yt-dlp', args, {
      timeout: 30000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    return JSON.parse(output)
  } catch (err) {
    throw new Error(err.stderr?.split('\n')[0] || err.message)
  }
}

function generateId(url) {
  // Extract video ID from TikTok URL or generate hash
  const match = url.match(/\/video\/(\d+)/)
  if (match) return `tiktok_${match[1]}`
  // Fallback: hash the URL
  let hash = 0
  for (let i = 0; i < url.length; i++) {
    hash = ((hash << 5) - hash + url.charCodeAt(i)) | 0
  }
  return `tiktok_${Math.abs(hash)}`
}

// Process loop
let totalDone = 0
let totalFailed = 0
let batchNum = 0

while (true) {
  const pending = getPending.all('pending', batchSize)
  if (pending.length === 0) {
    console.log('No pending imports. Done!')
    break
  }

  batchNum++
  console.log(`\n--- Batch ${batchNum}: ${pending.length} imports ---`)

  for (let i = 0; i < pending.length; i++) {
    const row = pending[i]
    const progress = `[${i + 1}/${pending.length}]`

    try {
      const meta = extractMetadata(row.url)

      const id = meta.id ? `tiktok_${meta.id}` : generateId(row.url)
      const title = meta.title || meta.fulltitle || ''
      const thumbnail = meta.thumbnail || ''
      const duration = meta.duration || 0
      const tags = JSON.stringify(meta.tags || [])
      const source = 'tiktok.com'

      insertVideo.run(id, row.url, title, thumbnail, duration, tags, source, row.mode)
      markDone.run(row.id)
      totalDone++
      console.log(`  ${progress} OK: ${title?.slice(0, 60) || row.url}`)
    } catch (err) {
      markFailed.run(err.message?.slice(0, 500), row.id)
      totalFailed++
      console.log(`  ${progress} FAIL: ${row.url} — ${err.message?.slice(0, 80)}`)
    }
  }

  console.log(`Batch ${batchNum} complete: ${totalDone} done, ${totalFailed} failed so far`)
}

// Final summary
const stats = {
  pending: db.prepare("SELECT COUNT(*) as n FROM tiktok_imports WHERE status = 'pending'").get().n,
  done: db.prepare("SELECT COUNT(*) as n FROM tiktok_imports WHERE status = 'done'").get().n,
  failed: db.prepare("SELECT COUNT(*) as n FROM tiktok_imports WHERE status = 'failed'").get().n,
}
console.log(`\nFinal: ${stats.done} done, ${stats.failed} failed, ${stats.pending} pending`)

db.close()
