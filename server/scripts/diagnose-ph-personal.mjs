// Smoke test for the PornHub personal fetchers.
// Run: node server/scripts/diagnose-ph-personal.mjs
//
// Confirms:
//   1. PH cookies are present and reachable
//   2. /favorites returns video cards (or surfaces a clear error)
//   3. /subscriptions returns videos via yt-dlp
//   4. selectTopPHModels() runs without throwing
//
// Exits 0 if all four checks complete (even if 0 results -- empty != failure).

import { initDatabase } from '../database.js'
import { parseCookieFile } from '../cookies.js'
import {
  fetchLikes,
  fetchSubscriptionsFeed,
  selectTopPHModels,
  _closePornhubPersonalBrowser,
} from '../sources/pornhub-personal.js'

initDatabase()

function log(label, body) {
  console.log(`\n=== ${label} ===`)
  console.log(body)
}

async function main() {
  // 1. Cookies
  const { cookies, cookiePath } = parseCookieFile('pornhub.com')
  log('1. PH cookie file', `path: ${cookiePath || '(none)'}, names: ${Object.keys(cookies).join(', ') || '(empty)'}`)

  // 2. /favorites
  let likes = []
  try {
    likes = await fetchLikes({ limit: 10 })
  } catch (err) {
    log('2. /favorites', `THREW: ${err.message}`)
  }
  log('2. /favorites', `count=${likes.length}\n${likes.slice(0, 3).map(v => ` - ${v.title} | ${v.url}`).join('\n')}`)

  // 3. /subscriptions
  let subs = []
  try {
    subs = await fetchSubscriptionsFeed({ limit: 10 })
  } catch (err) {
    log('3. /subscriptions', `THREW: ${err.message}`)
  }
  log('3. /subscriptions', `count=${subs.length}\n${subs.slice(0, 3).map(v => ` - ${v.title} | ${v.uploader}`).join('\n')}`)

  // 4. Top-3 models
  let top = []
  try {
    top = selectTopPHModels({ limit: 3 })
  } catch (err) {
    log('4. selectTopPHModels', `THREW: ${err.message}`)
  }
  log('4. selectTopPHModels', `count=${top.length}\n${top.map(t => ` - ${t.creator} (boost=${t.boost_score})`).join('\n')}`)

  // Summary
  console.log('\n=== Summary ===')
  console.log(`Cookies present: ${Object.keys(cookies).length > 0 ? 'YES' : 'NO'}`)
  console.log(`Favorites scrape: ${likes.length > 0 ? `OK (${likes.length})` : 'EMPTY'}`)
  console.log(`Subs feed: ${subs.length > 0 ? `OK (${subs.length})` : 'EMPTY'}`)
  console.log(`Top models: ${top.length > 0 ? `OK (${top.length})` : 'EMPTY (no creator_boosts yet)'}`)
}

main()
  .catch(err => {
    console.error('Diagnostic failed:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await _closePornhubPersonalBrowser()
    process.exit(process.exitCode || 0)
  })
