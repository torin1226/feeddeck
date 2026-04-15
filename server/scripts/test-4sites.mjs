#!/usr/bin/env node
// Test scraper selectors for 4 NSFW sites: xvideos, redtube, xhamster, youporn.
// Run: node server/scripts/test-4sites.mjs

import { ScraperAdapter } from '../sources/scraper.js'

const SITES = ['xvideos.com', 'redtube.com', 'xhamster.com', 'youporn.com']
const LIMIT = 5

const scraper = new ScraperAdapter()

async function testSite(site) {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`  ${site} -- fetchTrending (limit ${LIMIT})`)
  console.log('='.repeat(60))

  try {
    const videos = await scraper.fetchTrending({ site, limit: LIMIT })
    console.log(`Results: ${videos.length} videos`)

    if (videos.length === 0) {
      console.log('STATUS: FAIL -- 0 results (selectors likely broken)')
      return { site, status: 'FAIL', count: 0, error: 'No results' }
    }

    let allGood = true
    for (const v of videos) {
      const hasTitle = !!v.title
      const hasUrl = !!v.url
      const hasThumb = !!v.thumbnail
      const hasDur = v.duration > 0
      const missing = []
      if (!hasTitle) missing.push('title')
      if (!hasUrl) missing.push('url')
      if (!hasThumb) missing.push('thumbnail')
      if (!hasDur) missing.push('duration')

      const flag = missing.length > 0 ? `PARTIAL (missing: ${missing.join(', ')})` : 'OK'
      if (missing.length > 0) allGood = false

      console.log(`  [${flag}] "${(v.title || '(no title)').slice(0, 50)}"`)
      console.log(`         url=${(v.url || '').slice(0, 70)}`)
      console.log(`         thumb=${(v.thumbnail || '').slice(0, 70)}`)
      console.log(`         dur=${v.duration}s  views=${v.view_count || 0}  uploader="${v.uploader || ''}"`)
    }

    const status = allGood ? 'PASS' : 'PARTIAL'
    console.log(`\nSTATUS: ${status} -- ${videos.length} videos returned`)
    return { site, status, count: videos.length }
  } catch (err) {
    console.log(`STATUS: ERROR -- ${err.message}`)
    return { site, status: 'ERROR', count: 0, error: err.message }
  }
}

async function run() {
  console.log('Testing 4 NSFW sites...\n')
  const results = []

  for (const site of SITES) {
    const result = await testSite(site)
    results.push(result)
  }

  console.log('\n' + '='.repeat(60))
  console.log('  SUMMARY')
  console.log('='.repeat(60))
  for (const r of results) {
    const emoji = r.status === 'PASS' ? 'PASS' : r.status === 'PARTIAL' ? 'PARTIAL' : 'FAIL'
    console.log(`  ${emoji}: ${r.site} -- ${r.count} videos ${r.error ? `(${r.error})` : ''}`)
  }

  await scraper.close()
  console.log('\nDone.')
}

run().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
