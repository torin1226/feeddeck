#!/usr/bin/env node
// ============================================================
// import-audio-pdf.js
//
// One-shot backfill script for the "audio videos to scrape.pdf"
// catalog (Cattt's back catalogue from the Airtable export). Walks
// the PDF, extracts Reddit + Soundgasm URLs, resolves each to a
// direct media URL, and inserts into audio_cache.
//
// Skips paywalled URLs (Fansly, SubscribeStar) and the bit.ly
// redirect that points at her general profile. Idempotent on
// audio_cache.url UNIQUE constraint.
//
// Usage:
//   node server/scripts/import-audio-pdf.js
//   node server/scripts/import-audio-pdf.js --pdf cookies/audio\ videos\ to\ scrape.pdf
//   node server/scripts/import-audio-pdf.js --dry-run
//
// Requires: pdftotext (poppler) on PATH. Git for Windows ships
// pdftotext.exe in C:\Program Files\Git\mingw64\bin\.
//
// See plan: generic-exploring-lampson.md.
// ============================================================

import { DatabaseSync } from 'node:sqlite'
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..')

function arg(name, fallback) {
  const i = process.argv.indexOf(name)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const hasFlag = name => process.argv.includes(name)

const pdfPath = resolve(arg('--pdf', join(REPO_ROOT, 'cookies', 'audio videos to scrape.pdf')))
const dbPath = resolve(arg('--db', join(REPO_ROOT, 'data', 'library.db')))
const dryRun = hasFlag('--dry-run')
const limit = parseInt(arg('--limit', '0'), 10) // 0 = no limit
const fixedCreator = arg('--creator', 'badbadkittycattt')

if (!existsSync(pdfPath)) {
  console.error(`PDF not found: ${pdfPath}`)
  process.exit(1)
}
if (!existsSync(dbPath)) {
  console.error(`Database not found: ${dbPath}`)
  process.exit(1)
}

console.log('Audio PDF backfill')
console.log(`  PDF:      ${pdfPath}`)
console.log(`  DB:       ${dbPath}`)
console.log(`  Creator:  ${fixedCreator}`)
console.log(`  Dry run:  ${dryRun ? 'yes' : 'no'}`)
if (limit > 0) console.log(`  Limit:    ${limit}`)
console.log()

// --- 1. Extract PDF text -----------------------------------

let pdfText
try {
  pdfText = execSync(`pdftotext -layout -nopgbrk "${pdfPath}" -`, { maxBuffer: 64 * 1024 * 1024 })
    .toString('utf8')
} catch (err) {
  console.error('pdftotext failed — is poppler installed?')
  console.error(err.message)
  process.exit(1)
}

// --- 2. Glue line-wrapped URLs back together ---------------
// The PDF's Link column is narrow so URLs are split across 2-5 lines.
// Strategy: collect runs of "deeply indented non-space text" between
// row markers (lines starting with whitespace + number + space). Join
// those runs into a single URL string.

const lines = pdfText.split(/\r?\n/)
const fragments = []
let buffer = ''

function flush() {
  const url = buffer.replace(/\s+/g, '')
  if (url.match(/^https?:\/\//)) fragments.push(url)
  buffer = ''
}

for (const raw of lines) {
  // Row marker like "   18 https://www.reddit." starts a new URL.
  const rowStart = raw.match(/^\s*\d+\s+(https?:\/\/\S*)\s*$/)
  if (rowStart) {
    flush()
    buffer = rowStart[1]
    continue
  }
  // Continuation line: deeply indented with no leading row number.
  const cont = raw.match(/^\s{6,}(\S+)\s*$/)
  if (cont && buffer) {
    // Strip trailing page numbers that pdftotext glues to URLs
    const piece = cont[1].replace(/\d+\/\d+$/, '')
    buffer += piece
    continue
  }
  // Empty or unrelated line: flush whatever's buffered.
  if (buffer && raw.trim() === '') flush()
}
flush()

// --- 3. Classify ------------------------------------------

const audioCandidates = []
const skipReasons = { airtable: 0, bitly: 0, fansly: 0, substar: 0, youtube: 0, pornhub: 0, other: 0 }

for (const url of fragments) {
  const u = url.replace(/[)\].,;]+$/, '')
  if (u.includes('airtable.com')) { skipReasons.airtable++; continue }
  if (u.includes('bit.ly/')) { skipReasons.bitly++; continue }
  if (u.includes('fansly.com')) { skipReasons.fansly++; continue }
  if (u.includes('subscribestar.adult')) { skipReasons.substar++; continue }
  if (u.includes('youtube.com') || u.includes('youtu.be')) { skipReasons.youtube++; continue }
  if (u.includes('pornhub.com')) { skipReasons.pornhub++; continue }
  if (u.includes('reddit.com') || u.includes('soundgasm.net')) {
    audioCandidates.push(u)
  } else {
    skipReasons.other++
  }
}

const uniqueCandidates = [...new Set(audioCandidates)]
console.log(`Extracted ${fragments.length} URLs, ${uniqueCandidates.length} usable (Reddit/Soundgasm).`)
console.log(`Skipped: ${JSON.stringify(skipReasons)}`)

const targets = limit > 0 ? uniqueCandidates.slice(0, limit) : uniqueCandidates

if (dryRun) {
  console.log('\nDry run — first 10 targets:')
  for (const u of targets.slice(0, 10)) console.log(`  ${u}`)
  console.log(`... ${targets.length} total`)
  process.exit(0)
}

// --- 4. Resolve each + insert ------------------------------

const db = new DatabaseSync(dbPath)
const insert = db.prepare(`
  INSERT OR IGNORE INTO audio_cache
    (id, source_domain, url, audio_url, title, creator, creator_handle,
     tags, duration_sec, length_label)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

const UA = 'Mozilla/5.0 (FeedDeck-audio/1.0)'
const SOUNDGASM_LINK_RE = /https?:\/\/soundgasm\.net\/u\/[^\s)"<]+/i
const MEDIA_URL_RE = /https:\/\/media\.soundgasm\.net\/sounds\/[a-f0-9]+\.(?:m4a|mp3|wav)/i

async function fetchText(url) {
  const resp = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html,application/json' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  return resp.text()
}

async function resolveSoundgasm(url) {
  const cleanUrl = url.split('?')[0].split('#')[0]
  const html = await fetchText(cleanUrl)
  const m = html.match(MEDIA_URL_RE)
  if (!m) return null
  const titleMatch = html.match(/<div class="jp-title"[^>]*>([\s\S]*?)<\/div>/)
  const title = titleMatch
    ? titleMatch[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim()
    : 'Untitled'
  return { audio_url: m[0], title, url: cleanUrl }
}

async function resolveReddit(redditUrl) {
  // Reddit comment permalinks support .json suffix for API data.
  const apiUrl = redditUrl.replace(/\/?(\?.*)?$/, '/') + '.json'
  const text = await fetchText(apiUrl)
  let data
  try { data = JSON.parse(text) } catch { throw new Error('not JSON') }
  // Comment-permalink JSON returns [listing<post>, listing<comments>]
  const post = data?.[0]?.data?.children?.[0]?.data
  if (!post) return null
  const title = post.title || 'Untitled'
  const author = post.author || 'unknown'

  // Look for soundgasm URL in post.url or selftext
  let sgUrl = null
  if (post.url && /soundgasm\.net\/u\//.test(post.url)) sgUrl = post.url
  if (!sgUrl && post.selftext) {
    const m = post.selftext.match(SOUNDGASM_LINK_RE)
    if (m) sgUrl = m[0].replace(/[)\].,]+$/, '')
  }
  if (!sgUrl) return null

  const sg = await resolveSoundgasm(sgUrl)
  if (!sg) return null
  return {
    audio_url: sg.audio_url,
    title,
    url: redditUrl,
    creator: author,
    soundgasm_url: sgUrl,
  }
}

function extractTags(title) {
  const tags = []
  const re = /\[([^\]]{1,40})\]/g
  let m
  while ((m = re.exec(title)) !== null) {
    const t = m[1].trim().toLowerCase()
    if (t && !tags.includes(t)) tags.push(t)
  }
  return tags.slice(0, 20)
}

let inserted = 0
let resolved = 0
let failed = 0
let skipped = 0

console.log(`\nResolving ${targets.length} URLs (this will take a few minutes)...`)

for (let i = 0; i < targets.length; i++) {
  const url = targets[i]
  const tag = `[${i + 1}/${targets.length}]`
  try {
    let item = null
    if (url.includes('soundgasm.net')) {
      const sg = await resolveSoundgasm(url)
      if (sg) item = {
        ...sg,
        creator: fixedCreator,
        soundgasm_url: sg.url,
      }
    } else if (url.includes('reddit.com')) {
      item = await resolveReddit(url)
    }

    if (!item) {
      console.log(`${tag} skip (no audio): ${url}`)
      skipped++
      continue
    }
    resolved++

    const sourceDomain = url.includes('soundgasm') ? 'soundgasm.net' : 'reddit.com'
    const creator = item.creator || fixedCreator

    const result = insert.run(
      `audio_backfill_${randomUUID()}`,
      sourceDomain,
      item.url,
      item.audio_url,
      item.title,
      creator,
      sourceDomain === 'soundgasm.net' ? `u/${fixedCreator}` : `u/${creator}`,
      JSON.stringify(extractTags(item.title)),
      null,
      null,
    )
    if (result.changes > 0) {
      inserted++
      console.log(`${tag} ok: ${item.title.slice(0, 60)}`)
    } else {
      console.log(`${tag} dup: ${item.title.slice(0, 60)}`)
    }
  } catch (err) {
    failed++
    console.log(`${tag} fail: ${url} (${err.message})`)
  }
  // Be polite — soundgasm + reddit hits in quick succession.
  await new Promise(r => setTimeout(r, 300))
}

db.close()

console.log()
console.log('Summary:')
console.log(`  targets:  ${targets.length}`)
console.log(`  resolved: ${resolved}`)
console.log(`  inserted: ${inserted}`)
console.log(`  skipped:  ${skipped} (no audio found)`)
console.log(`  failed:   ${failed}`)
