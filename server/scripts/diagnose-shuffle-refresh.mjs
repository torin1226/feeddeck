#!/usr/bin/env node
// diagnose-shuffle-refresh.mjs
//
// Live diagnostic: hits the running dev server (port 3001) and reports
// whether shuffle and refresh actually change visible content.
//
// Usage:
//   node server/scripts/diagnose-shuffle-refresh.mjs
//   node server/scripts/diagnose-shuffle-refresh.mjs --mode=nsfw
//   node server/scripts/diagnose-shuffle-refresh.mjs --skip-refresh
//   node server/scripts/diagnose-shuffle-refresh.mjs --skip-shuffle
//
// Output: one-page report showing exactly how many cards changed per
// category row. Answers "is it broken or am I being impatient?" with
// hard numbers, not guesses.

import { parseArgs } from 'node:util'

const { values: flags } = parseArgs({
  options: {
    mode:         { type: 'string',  default: 'social' },
    host:         { type: 'string',  default: 'http://localhost:3001' },
    'skip-refresh': { type: 'boolean', default: false },
    'skip-shuffle': { type: 'boolean', default: false },
  },
})

const BASE = flags.host
const MODE = flags.mode === 'nsfw' ? 'nsfw' : 'social'

const RESET = '\x1b[0m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const RED = '\x1b[31m'
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'

function color(text, c) { return `${c}${text}${RESET}` }
function bold(t) { return color(t, BOLD) }
function dim(t) { return color(t, DIM) }

async function get(path) {
  const url = `${BASE}${path}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`)
  return res.json()
}

async function post(path) {
  const url = `${BASE}${path}`
  const res = await fetch(url, { method: 'POST' })
  if (!res.ok && res.status !== 429) throw new Error(`POST ${path} → HTTP ${res.status}`)
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

function snapshotCategories(data) {
  const snap = {}
  for (const cat of data.categories || []) {
    snap[cat.label] = {
      pinned: !!cat.pinned,
      ids: (cat.videos || []).map(v => v.id),
    }
  }
  return snap
}

function diffSnapshot(before, after, label) {
  const b = before[label] || { ids: [] }
  const a = after[label] || { ids: [] }
  const bSet = new Set(b.ids)
  const aSet = new Set(a.ids)

  const top5Changed = a.ids.slice(0, 5).filter(id => !bSet.has(id)).length
  const tailChanged = a.ids.slice(5).filter(id => !bSet.has(id)).length
  const totalBefore = b.ids.length
  const totalAfter = a.ids.length
  const totalChanged = a.ids.filter(id => !bSet.has(id)).length

  return { top5Changed, tailChanged, totalChanged, totalBefore, totalAfter }
}

function reportCategoryDiff(label, diff, pinned) {
  const { top5Changed, tailChanged, totalChanged, totalBefore, totalAfter } = diff

  let top5Color = RED
  if (top5Changed === 5) top5Color = GREEN
  else if (top5Changed > 0) top5Color = YELLOW

  let summary
  if (pinned) {
    summary = dim('(pinned — intentionally skipped by shuffle)')
  } else {
    summary = [
      color(`${top5Changed}/5`, top5Color) + ' top cards changed',
      tailChanged > 0
        ? color(`${tailChanged}`, GREEN) + ' tail cards changed'
        : color('tail unchanged', RED) + dim(' (phase 2 skipped — < 6 fresh items)'),
    ].join('  |  ')
  }

  const labelStr = bold(label.padEnd(30))
  console.log(`  ${labelStr}  ${summary}`)
}

function diagnoseResult(diffs) {
  const nonPinned = Object.entries(diffs).filter(([,d]) => !d.pinned)
  if (nonPinned.length === 0) return color('⚠  All categories are pinned — nothing to shuffle.', YELLOW)

  const allTop5Changed = nonPinned.every(([,d]) => d.diff.top5Changed === 5)
  const noneChanged = nonPinned.every(([,d]) => d.diff.totalChanged === 0)
  const someTop5Changed = nonPinned.some(([,d]) => d.diff.top5Changed > 0)

  if (noneChanged) {
    return [
      color('❌ SHUFFLE NOT WORKING', RED),
      '   Possible causes:',
      '   • Cache exhausted — 0 unviewed items in homepage_cache',
      '   • ID mismatch — viewed POSTs hit wrong rows (check with ?debug mode)',
      '   • All items already viewed — try running: npm run warm',
    ].join('\n')
  }
  if (allTop5Changed) {
    return color('✅ SHUFFLE WORKING — top 5 rotate on every use', GREEN)
  }
  if (someTop5Changed) {
    return [
      color('⚠  PARTIAL — some rows updated, some did not', YELLOW),
      '   Likely: low cache inventory in specific categories',
      '   Run: npm run warm to replenish',
    ].join('\n')
  }
  return color('⚠  Unknown result — inspect row details above', YELLOW)
}

async function runShuffleDiagnosis() {
  console.log('\n' + bold('━━━ SHUFFLE DIAGNOSIS ━━━'))

  console.log(dim('\nSnapshot 1: current homepage state...'))
  const before = await get(`/api/homepage?mode=${MODE}`)
  const snap1 = snapshotCategories(before)

  const catCount = Object.keys(snap1).length
  const nonPinnedCats = Object.entries(snap1).filter(([,v]) => !v.pinned)
  console.log(`  ${catCount} categories found (${nonPinnedCats.length} non-pinned)`)

  // Mark leftmost-5 viewed for each non-pinned category (mirrors shuffleHome)
  console.log(dim('\nMarking leftmost-5 items as viewed in each non-pinned row...'))
  const markedIds = []
  for (const [label, snap] of Object.entries(snap1)) {
    if (snap.pinned) continue
    const toMark = snap.ids.slice(0, 5)
    await Promise.all(
      toMark.map(id => post(`/api/homepage/viewed?id=${encodeURIComponent(id)}`))
    )
    markedIds.push(...toMark)
  }
  console.log(`  Marked ${markedIds.length} items as viewed`)

  console.log(dim('\nSnapshot 2: homepage after marking viewed...'))
  const after = await get(`/api/homepage?mode=${MODE}`)
  const snap2 = snapshotCategories(after)

  console.log('\n' + bold('Results per category:'))
  const allDiffs = {}
  for (const label of Object.keys(snap1)) {
    const diff = diffSnapshot(snap1, snap2, label)
    const pinned = snap1[label].pinned
    allDiffs[label] = { diff, pinned }
    reportCategoryDiff(label, diff, pinned)
  }

  console.log('\n' + diagnoseResult(allDiffs))
}

async function runRefreshDiagnosis() {
  console.log('\n' + bold('━━━ REFRESH DIAGNOSIS ━━━'))

  console.log(dim('\nSnapshot before warm...'))
  const before = await get(`/api/homepage?mode=${MODE}`)
  const snap1 = snapshotCategories(before)

  console.log(dim('\nPOST /api/homepage/warm (this takes 30–60 s — please wait)...'))
  const warmStart = Date.now()
  try {
    const { status } = await post(`/api/homepage/warm?mode=${MODE}`)
    const elapsed = ((Date.now() - warmStart) / 1000).toFixed(1)
    if (status === 429) {
      console.log(color(`  ⚠  Warm already in progress (429). Fetching current state anyway.`, YELLOW))
    } else {
      console.log(color(`  ✅ Warm completed in ${elapsed}s`, GREEN))
    }
  } catch (err) {
    console.log(color(`  ❌ Warm failed: ${err.message}`, RED))
    console.log('  Skipping refresh diff — cannot compare without a completed warm.')
    return
  }

  console.log(dim('\nSnapshot after warm...'))
  const after = await get(`/api/homepage?mode=${MODE}`)
  const snap2 = snapshotCategories(after)

  console.log('\n' + bold('Results per category:'))
  let totalNewItems = 0
  for (const label of Object.keys(snap1)) {
    const diff = diffSnapshot(snap1, snap2, label)
    const pinned = snap1[label].pinned
    totalNewItems += diff.totalChanged
    reportCategoryDiff(label, diff, pinned)
  }

  if (totalNewItems === 0) {
    console.log('\n' + color('⚠  REFRESH: no new items — cache may already be fully populated', YELLOW))
    console.log(dim('   This is expected if warm just ran. Shuffle should still work.'))
  } else {
    console.log('\n' + color(`✅ REFRESH: ${totalNewItems} new items now in cache`, GREEN))
  }
}

async function checkServer() {
  try {
    await fetch(`${BASE}/api/homepage?mode=${MODE}`)
    return true
  } catch {
    return false
  }
}

console.log(bold('\nFeedDeck Shuffle & Refresh Diagnostic'))
console.log(dim(`Server: ${BASE}  Mode: ${MODE}`))

try {
  const up = await checkServer()
  if (!up) {
    console.error(color('\n❌ Cannot reach server. Start it with: npm run dev:server', RED))
    process.exit(1)
  }

  if (!flags['skip-shuffle']) await runShuffleDiagnosis()
  if (!flags['skip-refresh']) await runRefreshDiagnosis()

  console.log('\n' + dim('Diagnosis complete.\n'))
} catch (err) {
  console.error(color(`\n❌ Fatal: ${err.message}`, RED))
  process.exit(1)
}
