// Quick probe: validate trends24.js selectors against the live page.
// Runs in isolation, exits non-zero if any section returns an empty payload.
//
// Usage: node server/scripts/probe-trends24.mjs

import { fetchSection, shutdown } from '../sources/trends24.js'

const SECTIONS = [
  'group-all',
  'group-music',
  'group-news-and-politics',
  'group-gaming',
  'group-sports',
]

let failures = 0
for (const anchor of SECTIONS) {
  process.stdout.write(`${anchor}... `)
  try {
    const { videos, creators, keywords } = await fetchSection(anchor)
    const ok = videos.length >= 5
    if (!ok) failures++
    console.log(
      `${ok ? 'OK ' : 'FAIL'}  videos=${videos.length}  creators=${creators.length}  keywords=${keywords.length}`
    )
    if (videos[0]) {
      const v = videos[0]
      console.log(
        `         sample: "${v.title.slice(0, 60)}" by ${v.uploader || '?'} — ${v.view_count ?? '?'} views`
      )
      console.log(
        `         url=${v.url}  thumb=${v.thumbnail ? 'yes' : 'NO'}  channel_url=${v.channel_url ? 'yes' : 'NO'}  upload_date=${v.upload_date ?? 'NO'}`
      )
    }
  } catch (err) {
    failures++
    console.log(`THROW ${err.message}`)
  }
}

await shutdown()

if (failures > 0) {
  console.error(`\n${failures}/${SECTIONS.length} sections failed (need >=5 videos each)`)
  process.exit(1)
}
console.log('\nAll sections returned >=5 videos.')
