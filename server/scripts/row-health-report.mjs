// Row health report. The structural fix for source-DOM-shift silent failures
// (RedGifs Apr 16, social_shorts Apr 25, trends24 Apr 30): pulls the two
// available signals from a running server and prints a Markdown report the
// daily-hydration session can paste into its log.
//
//   1. GET /api/homepage/status?mode={social,nsfw}
//        Stocking signal. fresh_unviewed === 0 means a category has gone dark
//        (the silent-killer pattern). 1-4 means it is on its way there.
//
//   2. GET /api/rows/health
//        Engagement signal. underperformingRows (>= 0.4 thumbs-down ratio over
//        30d, >= 5 impressions) are deprecation candidates. emergentClusters
//        are tag co-occurrences not yet covered by a row's topic_sources.
//
// Exit code is non-zero when any category in either mode has fresh_unviewed
// === 0. That single signal is what the cron / scheduled task watches.
//
// Usage:
//   node server/scripts/row-health-report.mjs
//   node server/scripts/row-health-report.mjs --base http://localhost:3001
//   node server/scripts/row-health-report.mjs --json   (machine-readable)

import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : null
}

const BASE = flag('--base') || process.env.FEEDDECK_BASE_URL || 'http://localhost:3001'
const EMITTING_JSON = args.includes('--json')

const EMPTY_THRESHOLD = 0
const LOW_THRESHOLD = 5
const FETCH_TIMEOUT_MS = 10000

async function getJson(path) {
  const url = `${BASE}${path}`
  let res
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  } catch (err) {
    throw new Error(
      `fetch ${url} failed: ${err.message} — is the dev server running on ${BASE}?`,
      { cause: err },
    )
  }
  if (!res.ok) {
    throw new Error(`GET ${path} returned HTTP ${res.status}`)
  }
  return res.json()
}

function classify(categories) {
  const empty = []
  const low = []
  for (const c of categories) {
    if (c.fresh_unviewed <= EMPTY_THRESHOLD) {
      empty.push(c)
    } else if (c.fresh_unviewed < LOW_THRESHOLD) {
      low.push(c)
    }
  }
  return { empty, low, total: categories.length }
}

function printMarkdown(report) {
  const { social, nsfw, engagement, generatedAt } = report
  const totalEmpty = social.empty.length + nsfw.empty.length
  const totalLow = social.low.length + nsfw.low.length

  console.log(`# Row Health Report`)
  console.log(`_Generated ${generatedAt}_`)
  console.log()
  console.log(
    `**Summary:** ${totalEmpty} empty, ${totalLow} low, ` +
      `${engagement.underperformingRows.length} flagged engagement, ` +
      `${engagement.emergentClusters.length} emergent clusters.`,
  )
  console.log()

  for (const [mode, data] of [['social', social], ['nsfw', nsfw]]) {
    console.log(`## ${mode} (${data.total} categories)`)
    if (data.empty.length === 0 && data.low.length === 0) {
      console.log(`All categories at or above ${LOW_THRESHOLD} fresh unviewed entries.`)
    } else {
      if (data.empty.length > 0) {
        console.log(`### Empty (fresh_unviewed = 0) — silent-killer candidates`)
        for (const c of data.empty) {
          console.log(`- \`${c.key}\` (${c.label}) — total=${c.total}, unviewed_total=${c.unviewed_total}`)
        }
      }
      if (data.low.length > 0) {
        console.log(`### Low (fresh_unviewed < ${LOW_THRESHOLD}) — refill recommended`)
        for (const c of data.low) {
          console.log(`- \`${c.key}\` (${c.label}) — fresh=${c.fresh_unviewed}, unviewed_total=${c.unviewed_total}, total=${c.total}`)
        }
      }
    }
    console.log()
  }

  console.log(`## Engagement (last 30 days)`)
  if (engagement.underperformingRows.length === 0) {
    console.log(`No rows above the 0.4 thumbs-down ratio threshold (>= 5 impressions).`)
  } else {
    console.log(`### Underperforming rows`)
    for (const r of engagement.underperformingRows) {
      console.log(
        `- \`${r.row_key}\` — impressions=${r.impressions}, downRatio=${r.downRatio} ` +
          `(${r.thumbs_down} down / ${r.thumbs_up} up)`,
      )
    }
  }
  console.log()

  console.log(`## Emergent tag clusters`)
  if (engagement.emergentClusters.length === 0) {
    console.log(`No tag pairs above co_occurrences=3 outside existing rows' topic_sources.`)
  } else {
    for (const c of engagement.emergentClusters) {
      console.log(`- \`${c.tag_a}\` + \`${c.tag_b}\` — ${c.co_occurrences} co-occurrences`)
    }
  }
}

async function main() {
  let social, nsfw, engagement
  try {
    [social, nsfw, engagement] = await Promise.all([
      getJson('/api/homepage/status?mode=social'),
      getJson('/api/homepage/status?mode=nsfw'),
      getJson('/api/rows/health'),
    ])
  } catch (err) {
    console.error(`Row health report failed: ${err.message}`)
    process.exit(2)
  }

  const report = {
    generatedAt: new Date().toISOString(),
    social: classify(social.categories || []),
    nsfw: classify(nsfw.categories || []),
    engagement: {
      underperformingRows: engagement.underperformingRows || [],
      emergentClusters: engagement.emergentClusters || [],
    },
  }

  if (EMITTING_JSON) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    printMarkdown(report)
  }

  const totalEmpty = report.social.empty.length + report.nsfw.empty.length
  if (totalEmpty > 0) {
    process.exit(1)
  }
}

export { classify, EMPTY_THRESHOLD, LOW_THRESHOLD }

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main()
}
