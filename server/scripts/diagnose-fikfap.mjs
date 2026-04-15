#!/usr/bin/env node
// Diagnostic: verify FikFap API is reachable and returning data.
// Tests the anonymous UUID auth mechanism and available sort options.
//
// Run: cd feeddeck && node server/scripts/diagnose-fikfap.mjs
//
// Architecture notes:
//   - FikFap is a React SPA with a service worker that adds auth headers
//   - Auth: `authorization-anonymous` header with any random UUID
//   - API: GET https://api.fikfap.com/posts?amount=N&sort=SORT
//   - Sorts: new, trending, top, random (NOT hot, best)
//   - Videos hosted on BunnyCDN (vz-5d293dac-178.b-cdn.net)

const { randomUUID } = await import('crypto')

const FIKFAP_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
  'Accept': '*/*',
  'Origin': 'https://fikfap.com',
  'Referer': 'https://fikfap.com/',
  'authorization-anonymous': randomUUID(),
  'isloggedin': 'false',
  'ispwa': 'false',
}

async function testEndpoint(url, label) {
  try {
    const res = await fetch(url, { headers: FIKFAP_HEADERS })
    const body = await res.text()
    let count = 0
    let sample = ''
    if (res.ok) {
      try {
        const data = JSON.parse(body)
        if (Array.isArray(data)) {
          count = data.length
          if (data[0]) {
            sample = `"${data[0].label?.slice(0, 40)}" by ${data[0].author?.username}`
          }
        }
      } catch {}
    }
    console.log(`  ${label}: status=${res.status}, count=${count}${sample ? `, sample: ${sample}` : ''}`)
    return res.ok
  } catch (e) {
    console.log(`  ${label}: ERROR ${e.message}`)
    return false
  }
}

console.log('FikFap API Diagnostic')
console.log('=====================\n')

console.log('Testing sort options:')
const results = await Promise.all([
  testEndpoint('https://api.fikfap.com/posts?amount=5&sort=trending&useDistinctUserIds=true&minimumScore=-20', 'sort=trending'),
  testEndpoint('https://api.fikfap.com/posts?amount=5&sort=new&useDistinctUserIds=true&minimumScore=-20', 'sort=new'),
  testEndpoint('https://api.fikfap.com/posts?amount=5&sort=top&useDistinctUserIds=true&minimumScore=-20', 'sort=top'),
  testEndpoint('https://api.fikfap.com/posts?amount=5&sort=random&useDistinctUserIds=true&minimumScore=-20', 'sort=random'),
])

console.log(`\nFull post structure (1 item):`)
const res = await fetch('https://api.fikfap.com/posts?amount=1&sort=trending&useDistinctUserIds=true&minimumScore=-20', { headers: FIKFAP_HEADERS })
if (res.ok) {
  const data = await res.json()
  if (data[0]) {
    const p = data[0]
    console.log(`  postId: ${p.postId}`)
    console.log(`  label: ${p.label?.slice(0, 80)}`)
    console.log(`  author: ${p.author?.username}`)
    console.log(`  views: ${p.viewsCount}`)
    console.log(`  score: ${p.score}`)
    console.log(`  duration: ${p.duration}`)
    console.log(`  thumbnail: ${p.thumbnailStreamUrl?.slice(0, 80)}...`)
    console.log(`  video: ${p.videoStreamUrl?.slice(0, 80)}...`)
    console.log(`  hashtags: ${p.hashtags?.map(h => h.label).join(', ')}`)
    console.log(`  orientation: ${p.sexualOrientation}`)
    console.log(`  bunnyVideoId: ${p.bunnyVideoId}`)
  }
}

const allOk = results.every(r => r)
console.log(`\nResult: ${allOk ? 'ALL OK' : 'SOME FAILED'}`)
process.exit(allOk ? 0 : 1)
