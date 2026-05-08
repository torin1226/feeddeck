// One-shot script to debug the trail runner directly.
// Reproduces what /api/recommendations/trail/seed does in-process.
import { initDatabase } from '../database.js'
import { ytdlp as ytdlpAdapter } from '../sources/index.js'
import { createTrailRunner, distillKeywords, extractCreatorUrl } from '../recommendations/searchSimilar.js'

initDatabase()

const seedTitle = 'LIVE: FBI Director Patel Drops Bombshell'
const seedTags = ['news', 'politics']
console.log('keywords:', JSON.stringify(distillKeywords(seedTitle, seedTags)))
console.log('creator URL:', extractCreatorUrl({ channel_url: 'https://www.youtube.com/@FoxNews' }))

const runner = createTrailRunner({ ytdlpAdapter, options: { searchTimeoutMs: 45_000 } })

const seed = {
  url: 'https://www.youtube.com/watch?v=gEW5CFhHTJo',
  title: 'LIVE: FBI Director Patel Drops Bombshell',
  tags: ['news', 'politics'],
  uploader: 'Fox News',
  channel_url: 'https://www.youtube.com/@FoxNews',
}

console.log('starting trail run...')
runner.runForSeed({ seed, mode: 'social' })
  .then((res) => {
    console.log('result:', { suppressed: res.suppressed, rowCount: res.rows?.length })
    if (res.rows?.length) {
      console.log('first 3 rows:')
      for (const r of res.rows.slice(0, 3)) {
        console.log(`  [${r.source}] ${r.video_url} - ${r.title?.substring(0, 50)}`)
      }
    }
    process.exit(0)
  })
  .catch((err) => {
    console.error('error:', err.message)
    console.error(err.stack)
    process.exit(1)
  })
