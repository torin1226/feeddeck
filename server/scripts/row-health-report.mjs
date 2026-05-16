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
//   3. GET /api/audio/stats
//        Audio-surface diversity signal. total === 0 means the audio cache has
//        gone dark (silent killer). A single distinct source_domain or creator
//        with total > 0 means the surface has collapsed onto one source — the
//        2026-05-16 symptom that surfaced as "audio shows one creator". Soft
//        warning (does not fail exit) because the live fetcher is a no-op
//        until audio creators are seeded; total === 0 is a hard fail.
//
// Exit code is non-zero when any category in either mode has fresh_unviewed
// === 0, or when the audio surface is empty (total === 0). Single-source
// collapse on audio is reported as a warning but does not flip exit.
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

// Audio surface classifier. Distinct-non-null counts on bySource / byCreator
// give the diversity signal; total drives the empty (silent-killer) signal.
// `collapsed` flips true once content exists but lives in <=1 source OR
// <=1 creator — the 2026-05-16 mycatwithclaws shape.
function classifyAudio(stats) {
  const total = Number.isFinite(stats?.total) ? stats.total : 0
  const unrated = Number.isFinite(stats?.unrated) ? stats.unrated : 0
  const sources = Array.isArray(stats?.bySource)
    ? stats.bySource.filter(s => s && typeof s.source_domain === 'string' && s.source_domain.length > 0)
    : []
  const creators = Array.isArray(stats?.byCreator)
    ? stats.byCreator.filter(c => c && typeof c.creator === 'string' && c.creator.length > 0)
    : []
  const empty = total === 0
  const collapsed = !empty && (sources.length <= 1 || creators.length <= 1)
  return { total, unrated, sources, creators, empty, collapsed }
}

function printMarkdown(report) {
  const { social, nsfw, engagement, audio, audioError, generatedAt } = report
  const totalEmpty = social.empty.length + nsfw.empty.length
  const totalLow = social.low.length + nsfw.low.length
  const audioBadge = audioError
    ? ', audio: error'
    : audio?.empty
      ? ', audio: empty'
      : audio?.collapsed
        ? ', audio: collapsed'
        : ''

  console.log(`# Row Health Report`)
  console.log(`_Generated ${generatedAt}_`)
  console.log()
  console.log(
    `**Summary:** ${totalEmpty} empty, ${totalLow} low, ` +
      `${engagement.underperformingRows.length} flagged engagement, ` +
      `${engagement.emergentClusters.length} emergent clusters${audioBadge}.`,
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
  console.log()

  printAudioSection(audio, audioError)
}

function printAudioSection(audio, audioError) {
  console.log(`## audio surface`)
  if (audioError) {
    console.log(`Could not fetch /api/audio/stats: ${audioError}`)
    return
  }
  if (!audio) {
    console.log(`No audio stats available.`)
    return
  }
  console.log(
    `**Total:** ${audio.total} items (unrated: ${audio.unrated}); ` +
      `**diversity:** ${audio.sources.length} source(s) / ${audio.creators.length} creator(s).`,
  )
  if (audio.empty) {
    console.log()
    console.log(`### Empty (total = 0) — silent-killer candidate`)
    console.log(
      `Audio cache has zero rated-positive rows. Live fetcher is likely a no-op ` +
        `(no \`creators\` rows with \`surface = 'audio'\`). See ` +
        `\`debug_audio_single_source_no_creators.md\` and seed creators via ` +
        `\`POST /api/creators\` with \`{ surface: 'audio' }\`.`,
    )
    return
  }
  if (audio.collapsed) {
    console.log()
    console.log(`### Diversity collapse — single source/creator`)
    console.log(
      `Audio surface has ${audio.total} items but only ${audio.sources.length} ` +
        `source(s) and ${audio.creators.length} creator(s). Likely cause: live ` +
        `fetcher is a no-op (no active audio creators); the items in cache came ` +
        `from a one-shot import. Seed creators via \`POST /api/creators\` with ` +
        `\`{ surface: 'audio' }\`.`,
    )
  }
  if (audio.sources.length > 0) {
    console.log()
    console.log(`### Sources`)
    for (const s of audio.sources) {
      console.log(`- \`${s.source_domain}\` — ${s.n}`)
    }
  }
  if (audio.creators.length > 0) {
    console.log()
    console.log(`### Top creators`)
    for (const c of audio.creators) {
      console.log(`- \`${c.creator}\` — ${c.n}`)
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

  // Audio is fetched separately so an older server (or a route 500) does not
  // break the existing three-endpoint contract. The audio block degrades to a
  // visible "could not fetch" line in the report.
  let audio = null
  let audioError = null
  try {
    const stats = await getJson('/api/audio/stats')
    audio = classifyAudio(stats)
  } catch (err) {
    audioError = err.message
  }

  const report = {
    generatedAt: new Date().toISOString(),
    social: classify(social.categories || []),
    nsfw: classify(nsfw.categories || []),
    engagement: {
      underperformingRows: engagement.underperformingRows || [],
      emergentClusters: engagement.emergentClusters || [],
    },
    audio,
    audioError,
  }

  if (EMITTING_JSON) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    printMarkdown(report)
  }

  const totalEmpty = report.social.empty.length + report.nsfw.empty.length
  const audioEmpty = audio?.empty === true
  if (totalEmpty > 0 || audioEmpty) {
    process.exit(1)
  }
}

export { classify, classifyAudio, EMPTY_THRESHOLD, LOW_THRESHOLD }

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main()
}
