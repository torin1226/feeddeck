#!/usr/bin/env node
// import-tiktok.js — Import TikTok GDPR export data into FeedDeck
//
// Usage:
//   node import-tiktok.js "cookies\gdpr sfw data" --db "data\library.db" --mode social
//   node import-tiktok.js "cookies\gdpr nsfw data" --db "data\library.db" --mode nsfw

import { DatabaseSync } from 'node:sqlite'
import { readFileSync, existsSync } from 'fs'
import { join, resolve } from 'path'

// Parse CLI args
const args = process.argv.slice(2)
function getArg(name, fallback) {
  const idx = args.indexOf(name)
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback
}

const exportDir = args.find(a => !a.startsWith('--'))
const dbPath = resolve(getArg('--db', 'data/library.db'))
const mode = getArg('--mode', 'social')

if (!exportDir) {
  console.error('Usage: node import-tiktok.js <export-dir> --db <path> --mode <social|nsfw>')
  process.exit(1)
}

const tiktokDir = join(resolve(exportDir), 'TikTok')
if (!existsSync(tiktokDir)) {
  console.error(`TikTok directory not found: ${tiktokDir}`)
  process.exit(1)
}

if (!existsSync(dbPath)) {
  console.error(`Database not found: ${dbPath}`)
  process.exit(1)
}

console.log(`Import TikTok GDPR data`)
console.log(`  Export dir: ${tiktokDir}`)
console.log(`  Database:   ${dbPath}`)
console.log(`  Mode:       ${mode}`)
console.log()

// Open database
const db = new DatabaseSync(dbPath)
db.exec('PRAGMA journal_mode = WAL')

// Create tables if they don't exist
db.exec(`
  CREATE TABLE IF NOT EXISTS tiktok_imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    source TEXT NOT NULL,
    imported_at DATETIME DEFAULT (datetime('now')),
    tiktok_date TEXT,
    mode TEXT NOT NULL DEFAULT 'social',
    status TEXT NOT NULL DEFAULT 'pending',
    processed_at DATETIME,
    error TEXT,
    UNIQUE(url, source)
  );
  CREATE INDEX IF NOT EXISTS idx_tiktok_imports_status ON tiktok_imports(status);
  CREATE INDEX IF NOT EXISTS idx_tiktok_imports_mode ON tiktok_imports(mode);

  CREATE TABLE IF NOT EXISTS tiktok_watch_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    watched_at TEXT,
    mode TEXT NOT NULL DEFAULT 'social',
    imported_at DATETIME DEFAULT (datetime('now')),
    UNIQUE(url, watched_at)
  );
  CREATE INDEX IF NOT EXISTS idx_tiktok_watch_history_mode ON tiktok_watch_history(mode);
`)

// Parse TikTok export file (Date:/Link: pairs separated by blank lines)
function parseExportFile(filePath) {
  if (!existsSync(filePath)) return []
  const content = readFileSync(filePath, 'utf-8')
  const entries = []
  const blocks = content.split(/\n\s*\n/)

  for (const block of blocks) {
    const dateMatch = block.match(/Date:\s*(.+)/)
    const linkMatch = block.match(/Link:\s*(.+)/)
    if (linkMatch) {
      const url = linkMatch[1].trim()
      if (!/^https:\/\/(www\.)?tiktok\.com\/@[^/]+\/video\/\d+/.test(url)) {
        console.log(`  Skipping malformed URL: ${url}`)
        continue
      }
      entries.push({
        date: dateMatch ? dateMatch[1].trim() : null,
        url
      })
    }
  }
  return entries
}

// Import a file into tiktok_imports
function importFile(filePath, source) {
  const entries = parseExportFile(filePath)
  if (entries.length === 0) {
    console.log(`  ${source}: no entries found`)
    return { added: 0, skipped: 0 }
  }

  const insertImport = db.prepare(
    'INSERT OR IGNORE INTO tiktok_imports (url, source, tiktok_date, mode) VALUES (?, ?, ?, ?)'
  )

  let added = 0
  let skipped = 0
  for (const entry of entries) {
    const result = insertImport.run(entry.url, source, entry.date, mode)
    if (result.changes > 0) added++
    else skipped++
  }

  console.log(`  ${source}: ${added} added, ${skipped} skipped (${entries.length} total)`)
  return { added, skipped }
}

// Import watch history into separate table
function importWatchHistory(filePath) {
  const entries = parseExportFile(filePath)
  if (entries.length === 0) {
    console.log(`  watch_history: no entries found`)
    return { added: 0, skipped: 0 }
  }

  const insertHistory = db.prepare(
    'INSERT OR IGNORE INTO tiktok_watch_history (url, watched_at, mode) VALUES (?, ?, ?)'
  )

  let added = 0
  let skipped = 0
  for (const entry of entries) {
    const result = insertHistory.run(entry.url, entry.date, mode)
    if (result.changes > 0) added++
    else skipped++
  }

  console.log(`  watch_history: ${added} added, ${skipped} skipped (${entries.length} total)`)
  return { added, skipped }
}

// Run imports
const totals = { added: 0, skipped: 0 }

function accumulate(result) {
  totals.added += result.added
  totals.skipped += result.skipped
}

// Favorite Videos
const favPath = join(tiktokDir, 'Likes and Favorites', 'Favorite Videos.txt')
accumulate(importFile(favPath, 'favorite'))

// Liked Videos
const likePath = join(tiktokDir, 'Likes and Favorites', 'Like List.txt')
accumulate(importFile(likePath, 'liked'))

// Watch History — goes into both tiktok_imports (for processing) and tiktok_watch_history
const watchPath = join(tiktokDir, 'Your Activity', 'Watch History.txt')
accumulate(importFile(watchPath, 'watch_history'))
importWatchHistory(watchPath)

console.log()
console.log(`Done! ${totals.added} videos added, ${totals.skipped} skipped`)

// Show summary
const pending = db.prepare('SELECT COUNT(*) as n FROM tiktok_imports WHERE status = ?').get('pending')
console.log(`Pending imports: ${pending.n}`)

db.close()
