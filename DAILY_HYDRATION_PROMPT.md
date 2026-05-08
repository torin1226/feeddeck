# Daily Playback Quality Sprint

> Scheduled Claude Code task. Runs daily. Goal: seamless, buffer-free video playback that starts fast, seeks instantly, and never stalls — even on constrained bandwidth.

run memory protocol

---

## Identity & Context

You are maintaining FeedDeck, a personal media aggregator. Stack: React + Vite + Tailwind frontend, Express backend on port 3001, SQLite via `node:sqlite`, content sourced via yt-dlp (with Arc browser cookies), Puppeteer scraper, and Cobalt API. Two modes: `social` and `nsfw`. Source adapter registry with fallback chains in `server/sources/`.

**Playback architecture:**
- Singleton `<video>` element shared across feed items (`src/components/feed/FeedVideo.jsx`)
- Stream URL resolution: `/api/stream-url` resolves via yt-dlp/cobalt, caches 2hr in `feed_cache.stream_url`
- All playback proxied through Express: `/api/proxy-stream` (MP4) and `/api/hls-proxy` (HLS m3u8 + segments)
- HLS via lazy-loaded `hls.js` on desktop; iOS native HLS
- yt-dlp format string: `1080p/720p/480p/best[height<=1080][protocol=https][ext=mp4]`
- Preload window: adaptive based on `navigator.connection.effectiveType` (1-4 videos ahead)
- Error recovery: 1 stream URL retry, then error card with skip/retry
- Environment: laptop or mini PC, bandwidth is often low or variable

**North star:** Hit play — instant start. Scrub forward — instant resume. No spinner. No stall. Looks as good as the pipe allows.

Also generate a "quality score" (0-100) each session based on: stream validity rate, TTFB, sustained throughput vs video bitrate, seek responsiveness, proxy error rate. Record in the progress report for trendline.

Ask Torin if he'd watch 2 random videos from the current cache so he can calibrate content quality.

---

## Session Protocol

### 1. Orient (always do first)

```
1. Read CLAUDE.md for current architecture state
2. Read ../BACKLOG.md (vault root — first 100 lines minimum)
3. Read the most recent MORNING_SPRINT_*.md and PROGRESS_REPORT_*.md files
4. Run: git log --oneline -20
5. Run: git diff HEAD~5 --stat
6. Run: npx eslint src/ server/ --format compact 2>&1 | head -60
7. Review: server/routes/stream.js, src/components/feed/FeedVideo.jsx, server/sources/ytdlp.js
```

If the memory vault at `../_memory/` exists, follow the memory protocol in CLAUDE.md.

### 2. Detect External Changes

```
git log --oneline --since="24 hours ago" -- server/routes/stream.js src/components/feed/FeedVideo.jsx server/sources/ytdlp.js server/sources/registry.js server/sources/cobalt.js src/stores/feedStore.js
```

For each commit: read the diff, assess impact on playback/seeking/proxy, fix regressions immediately.

### 3. Playback Health Check — Full 2-Minute Streaming Test

This is the core diagnostic. Start the server and run a REAL playback simulation: stream 2 full minutes of video through the proxy, measuring throughput and stall events. Then test seeking behavior.

```bash
node --experimental-detect-module server/index.js &
SERVER_PID=$!
sleep 3
```

#### 3a. Real Browser Playback Test (PRIMARY — this is the source of truth)

This test runs the actual FeedDeck UI in a headless browser and measures what the user sees. Everything else is supplementary. If this passes, playback works. If this fails, nothing else matters.

```javascript
// Save as server/scripts/playback-test.js
// Run: node --experimental-detect-module server/scripts/playback-test.js
//
// Requirements: puppeteer (npm install -D puppeteer)
// This launches a real Chromium, loads FeedDeck, and measures actual
// video element behavior — the same code path as a real viewer.

import puppeteer from 'puppeteer'

const BASE_URL = 'http://localhost:3001'
const NUM_VIDEOS = 5
const PLAYBACK_DURATION_MS = 120_000  // Watch each video for 2 minutes
const SEEK_POSITIONS = [0.25, 0.5, 0.75]  // Seek to 25%, 50%, 75%
const SEEK_RESUME_TIMEOUT_MS = 3000  // Max acceptable time to resume after seek
const FIRST_FRAME_TIMEOUT_MS = 5000  // Max acceptable time to first frame
const NETWORK_THROTTLE = { downloadThroughput: 1.5 * 1024 * 1024 / 8 } // 1.5 Mbps (low wifi)

const results = []

async function run() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--autoplay-policy=no-user-gesture-required', '--disable-web-security']
  })

  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 720 })

  // Throttle network to simulate constrained bandwidth
  const cdp = await page.createCDPSession()
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 50,
    downloadThroughput: NETWORK_THROTTLE.downloadThroughput,
    uploadThroughput: 512 * 1024 / 8,
  })

  // Navigate to feed
  await page.goto(`${BASE_URL}/#/feed`, { waitUntil: 'networkidle2', timeout: 30000 })
  await page.waitForSelector('[data-feed-index]', { timeout: 15000 })

  for (let i = 0; i < NUM_VIDEOS; i++) {
    const videoResult = {
      index: i,
      source: null,
      timeToFirstFrame: null,
      bufferingEvents: [],
      totalBufferingMs: 0,
      seekResults: [],
      errors: [],
      finalState: null,
    }

    console.log(`\n--- Video ${i + 1}/${NUM_VIDEOS} ---`)

    // Instrument the video element from inside the page
    const metrics = await page.evaluate((playDuration, seekPositions, seekTimeout, firstFrameTimeout) => {
      return new Promise((resolve) => {
        const video = document.querySelector('video')
        if (!video) return resolve({ error: 'No video element found' })

        const result = {
          timeToFirstFrame: null,
          bufferingEvents: [],
          totalBufferingMs: 0,
          seekResults: [],
          errors: [],
          source: video.src || video.currentSrc || 'unknown',
          resolution: null,
          duration: null,
        }

        let firstFrameStart = Date.now()
        let bufferStart = null
        let playbackStarted = false

        // Track first frame (time from now until 'playing' fires)
        const onPlaying = () => {
          if (!playbackStarted) {
            result.timeToFirstFrame = Date.now() - firstFrameStart
            playbackStarted = true
            console.log(`[TEST] First frame: ${result.timeToFirstFrame}ms`)
          }
          if (bufferStart) {
            const duration = Date.now() - bufferStart
            result.bufferingEvents.push({ at: video.currentTime, durationMs: duration })
            result.totalBufferingMs += duration
            bufferStart = null
          }
        }

        // Track buffering (waiting = stalled, needs data)
        const onWaiting = () => {
          bufferStart = Date.now()
          console.log(`[TEST] Buffering at ${video.currentTime.toFixed(1)}s`)
        }

        // Track errors
        const onError = () => {
          result.errors.push({
            at: video.currentTime,
            code: video.error?.code,
            message: video.error?.message
          })
        }

        const onLoadedMetadata = () => {
          result.resolution = `${video.videoWidth}x${video.videoHeight}`
          result.duration = video.duration
        }

        video.addEventListener('playing', onPlaying)
        video.addEventListener('waiting', onWaiting)
        video.addEventListener('error', onError)
        video.addEventListener('loadedmetadata', onLoadedMetadata)

        // Phase 1: Wait for first frame or timeout
        const firstFrameCheck = setTimeout(() => {
          if (!playbackStarted) {
            result.timeToFirstFrame = firstFrameTimeout
            result.errors.push({ at: 0, code: -1, message: 'First frame timeout' })
          }
        }, firstFrameTimeout)

        // Phase 2: After short playback, test seeking
        setTimeout(async () => {
          clearTimeout(firstFrameCheck)

          if (!video.duration || video.duration === Infinity) {
            // HLS or live — skip percentage seeks, use absolute times
            result.seekResults.push({ position: 'N/A', note: 'Duration unknown (HLS/live)' })
          } else {
            // Test seeking to each position
            for (const pct of seekPositions) {
              const seekTarget = video.duration * pct
              const seekStart = Date.now()
              let seekResolved = false

              const seekPromise = new Promise((res) => {
                const onSeeked = () => {
                  const elapsed = Date.now() - seekStart
                  seekResolved = true
                  result.seekResults.push({
                    position: `${(pct * 100).toFixed(0)}%`,
                    targetTime: seekTarget.toFixed(1),
                    resumeMs: elapsed,
                    pass: elapsed < seekTimeout,
                  })
                  video.removeEventListener('seeked', onSeeked)
                  res()
                }
                video.addEventListener('seeked', onSeeked)
                video.currentTime = seekTarget
              })

              // Timeout for seek
              await Promise.race([
                seekPromise,
                new Promise(res => setTimeout(() => {
                  if (!seekResolved) {
                    result.seekResults.push({
                      position: `${(pct * 100).toFixed(0)}%`,
                      targetTime: seekTarget.toFixed(1),
                      resumeMs: seekTimeout,
                      pass: false,
                      note: 'Seek timeout'
                    })
                  }
                  res()
                }, seekTimeout))
              ])

              // Wait a beat between seeks
              await new Promise(r => setTimeout(r, 1000))
            }
          }

          // Phase 3: Continue playback for remaining duration, count stalls
          // (already being tracked by waiting/playing listeners)
        }, 15000)  // Seek after 15s of initial playback

        // End test after full playback duration
        setTimeout(() => {
          video.removeEventListener('playing', onPlaying)
          video.removeEventListener('waiting', onWaiting)
          video.removeEventListener('error', onError)
          video.removeEventListener('loadedmetadata', onLoadedMetadata)
          result.finalState = video.paused ? 'paused' : 'playing'
          result.playedTo = video.currentTime
          resolve(result)
        }, playDuration)
      })
    }, PLAYBACK_DURATION_MS, SEEK_POSITIONS, SEEK_RESUME_TIMEOUT_MS, FIRST_FRAME_TIMEOUT_MS)

    Object.assign(videoResult, metrics)
    results.push(videoResult)

    // Log result for this video
    console.log(`  First frame: ${metrics.timeToFirstFrame}ms ${metrics.timeToFirstFrame < FIRST_FRAME_TIMEOUT_MS ? '✓' : '✗'}`)
    console.log(`  Resolution: ${metrics.resolution || 'unknown'}`)
    console.log(`  Buffering events: ${metrics.bufferingEvents?.length || 0} (total ${metrics.totalBufferingMs}ms)`)
    console.log(`  Seeks: ${metrics.seekResults?.map(s => `${s.position}→${s.resumeMs}ms ${s.pass ? '✓' : '✗'}`).join(', ') || 'none'}`)
    console.log(`  Errors: ${metrics.errors?.length || 0}`)
    console.log(`  Played to: ${metrics.playedTo?.toFixed(1)}s`)

    // Scroll to next video (simulate swipe)
    if (i < NUM_VIDEOS - 1) {
      await page.evaluate(() => {
        const next = document.querySelector(`[data-feed-index="${window.__feedTestIndex + 1}"]`)
        if (next) next.scrollIntoView({ behavior: 'instant' })
        window.__feedTestIndex = (window.__feedTestIndex || 0) + 1
      })
      await new Promise(r => setTimeout(r, 2000))  // Let next video activate
    }
  }

  await browser.close()

  // === SUMMARY ===
  console.log('\n\n========== PLAYBACK TEST SUMMARY ==========')
  const avgFirstFrame = results.reduce((s, r) => s + (r.timeToFirstFrame || 0), 0) / results.length
  const totalStalls = results.reduce((s, r) => s + (r.bufferingEvents?.length || 0), 0)
  const totalBufferMs = results.reduce((s, r) => s + (r.totalBufferingMs || 0), 0)
  const seekPasses = results.flatMap(r => r.seekResults || []).filter(s => s.pass).length
  const seekTotal = results.flatMap(r => r.seekResults || []).filter(s => s.resumeMs != null).length
  const errors = results.reduce((s, r) => s + (r.errors?.length || 0), 0)

  console.log(`Videos tested: ${results.length}`)
  console.log(`Avg time to first frame: ${avgFirstFrame.toFixed(0)}ms ${avgFirstFrame < FIRST_FRAME_TIMEOUT_MS ? '✓' : '✗ SLOW'}`)
  console.log(`Total buffering stalls: ${totalStalls} (${totalBufferMs}ms total)`)
  console.log(`Seek pass rate: ${seekPasses}/${seekTotal} within ${SEEK_RESUME_TIMEOUT_MS}ms`)
  console.log(`Errors: ${errors}`)
  console.log(`Network: throttled to ${(NETWORK_THROTTLE.downloadThroughput * 8 / 1024 / 1024).toFixed(1)} Mbps`)

  // PASS/FAIL
  const passed = avgFirstFrame < FIRST_FRAME_TIMEOUT_MS
    && totalStalls <= 2
    && seekPasses === seekTotal
    && errors === 0
  console.log(`\nRESULT: ${passed ? 'PASS ✓' : 'FAIL ✗'}`)

  if (!passed) {
    console.log('\nFailure details:')
    if (avgFirstFrame >= FIRST_FRAME_TIMEOUT_MS) console.log(`  - First frame too slow (${avgFirstFrame.toFixed(0)}ms > ${FIRST_FRAME_TIMEOUT_MS}ms)`)
    if (totalStalls > 2) console.log(`  - Too many stalls: ${totalStalls} (max 2 allowed across ${NUM_VIDEOS} videos)`)
    if (seekPasses < seekTotal) console.log(`  - Seeks too slow: ${seekTotal - seekPasses} exceeded ${SEEK_RESUME_TIMEOUT_MS}ms`)
    if (errors > 0) console.log(`  - ${errors} video errors encountered`)
    results.forEach((r, i) => {
      if (r.errors?.length) console.log(`    Video ${i}: ${JSON.stringify(r.errors)}`)
    })
  }

  process.exit(passed ? 0 : 1)
}

run().catch(err => {
  console.error('Test harness error:', err)
  process.exit(2)
})
```

**What this measures (that curl never could):**

| Browser behavior | This test captures it | curl test captures it |
|---|---|---|
| Time from video activation to first visible frame | Yes (playing event) | No |
| Mid-stream buffering stalls | Yes (waiting → playing gaps) | No |
| Seek resume time (currentTime assignment → seeked event) | Yes | Partially (just Range TTFB) |
| HLS ABR switching and segment load time | Yes (hls.js runs in-page) | No |
| Singleton video element swap overhead | Yes (it's the real component) | No |
| Stream URL resolution waterfall (fetch + set src + canplay) | Yes (included in first frame time) | Separately measured |
| Error recovery path timing | Yes (error event + retry + playing) | No |
| Behavior under throttled network | Yes (CDP network emulation) | No (curl uses full bandwidth) |
| Rapid video switching (scroll to next) | Yes (scrolls between videos) | No |

**Run this FIRST.** If it passes at 1.5 Mbps throttled, playback is solid. The curl-based tests below are supplementary diagnostics for isolating WHERE a failure occurs (proxy vs client vs CDN).

#### 3b. Pick 3 test videos (mix of sources — for supplementary proxy tests)

```bash
# Get 3 random unwatched videos from different sources
node -e "
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('data/library.db');
const videos = db.prepare(\`
  SELECT url, source_domain, title FROM feed_cache
  WHERE watched = 0 AND stream_url IS NOT NULL AND expires_at > datetime('now')
  ORDER BY RANDOM() LIMIT 3
\`).all();
console.log(JSON.stringify(videos, null, 2));
"
```

#### 3c. Supplementary: Full 2-minute streaming test (per video)

For each test video, simulate real playback — download 2 minutes of content through the proxy and measure:

```bash
#!/bin/bash
# playback-test.sh — run for each test video URL
TEST_URL="$1"
echo "=== Testing: $TEST_URL ==="

# Step 1: Resolve stream URL (measure resolution time)
START=$(date +%s%N)
STREAM_JSON=$(curl -s "http://localhost:3001/api/stream-url?url=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$TEST_URL'))")")
RESOLVE_MS=$(( ($(date +%s%N) - START) / 1000000 ))
STREAM_URL=$(echo "$STREAM_JSON" | jq -r '.streamUrl // empty')

if [ -z "$STREAM_URL" ]; then
  echo "FAIL: Could not resolve stream URL"
  echo "$STREAM_JSON"
  exit 1
fi
echo "Stream resolved in ${RESOLVE_MS}ms"

# Step 2: Get content size via HEAD (if supported)
ENCODED_STREAM=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$STREAM_URL'))")
CONTENT_LENGTH=$(curl -sI "http://localhost:3001/api/proxy-stream?url=$ENCODED_STREAM" | grep -i content-length | awk '{print $2}' | tr -d '\r')
echo "Content-Length: ${CONTENT_LENGTH:-unknown}"

# Step 3: Stream 2 minutes of video, measuring throughput every 10s
# Download with a 120-second max time, track bytes received
echo "Streaming for 120 seconds..."
PLAYBACK_FILE="/tmp/feeddeck_playback_test_$$"
curl -s --max-time 120 -o "$PLAYBACK_FILE" \
  -w "total_bytes: %{size_download}\nttfb: %{time_starttransfer}s\navg_speed: %{speed_download} bytes/s\ntotal_time: %{time_total}s\nhttp_code: %{http_code}\n" \
  "http://localhost:3001/api/proxy-stream?url=$ENCODED_STREAM"

FILESIZE=$(stat -f%z "$PLAYBACK_FILE" 2>/dev/null || stat -c%s "$PLAYBACK_FILE" 2>/dev/null)
echo "Downloaded: ${FILESIZE} bytes"

# Step 4: Check if throughput sustains video bitrate
# Typical 720p: ~2-4 Mbps = 250-500 KB/s. 1080p: ~4-8 Mbps = 500KB-1MB/s
# If avg download speed < video bitrate, user would see buffering
SPEED_BPS=$(curl -s --max-time 30 -o /dev/null \
  -w "%{speed_download}" \
  "http://localhost:3001/api/proxy-stream?url=$ENCODED_STREAM")
echo "Sustained speed: $(echo "$SPEED_BPS / 1024" | bc) KB/s"

# Step 5: Stall detection — download in 10s chunks and check for gaps
echo "Checking for stalls (10s chunks)..."
for i in $(seq 0 11); do
  CHUNK_START=$((i * 1048576))  # ~1MB chunks (roughly 8-10s of 720p)
  CHUNK_END=$((CHUNK_START + 1048575))
  CHUNK_TIME=$(curl -s -o /dev/null \
    -H "Range: bytes=${CHUNK_START}-${CHUNK_END}" \
    -w "%{time_total}" \
    "http://localhost:3001/api/proxy-stream?url=$ENCODED_STREAM")
  # A chunk taking > 10s means the video would stall at this point
  echo "  Chunk $i: ${CHUNK_TIME}s $(echo "$CHUNK_TIME > 10" | bc -l | grep -q 1 && echo 'STALL' || echo 'OK')"
done

rm -f "$PLAYBACK_FILE"
```

#### 3d. Supplementary: Backpressure survival test

This catches the exact bug class where wallclock timeouts kill streams during browser buffering pauses. A real browser reads ~30-50s of video fast, then STOPS draining while it plays through the buffer. If the proxy has a wallclock timeout on the upstream fetch, it kills the connection during this pause and the video dies ~50s in.

```python
#!/usr/bin/env python3
"""
Simulate browser backpressure: burst-read, pause 20s, try to read again.
If the connection is dead after the pause, the proxy has a wallclock timeout bug.
"""
import socket, time, sys, urllib.parse

PROXY_HOST = "localhost"
PROXY_PORT = 3001
STREAM_URL = sys.argv[1]  # Already-resolved CDN URL
PAUSE_SECONDS = 20  # Exceed any wallclock timeout (the bug used 15s)
BURST_BYTES = 2 * 1024 * 1024  # Read 2MB fast (simulates browser buffer fill)

encoded = urllib.parse.quote(STREAM_URL)
path = f"/api/proxy-stream?url={encoded}"

sock = socket.create_connection((PROXY_HOST, PROXY_PORT), timeout=10)
sock.sendall(f"GET {path} HTTP/1.1\r\nHost: {PROXY_HOST}:{PROXY_PORT}\r\n\r\n".encode())

# Phase 1: Burst read (like browser filling its buffer)
total_read = 0
start = time.time()
while total_read < BURST_BYTES:
    chunk = sock.recv(65536)
    if not chunk:
        print(f"FAIL: Connection closed during burst after {total_read} bytes")
        sys.exit(1)
    total_read += len(chunk)

burst_time = time.time() - start
print(f"Phase 1: Read {total_read} bytes in {burst_time:.1f}s (burst)")

# Phase 2: Pause — simulate browser playing through buffer, not reading from network
print(f"Phase 2: Pausing {PAUSE_SECONDS}s (simulating browser backpressure)...")
time.sleep(PAUSE_SECONDS)

# Phase 3: Try to read again — if proxy killed the upstream, this fails
print("Phase 3: Resuming read after pause...")
sock.settimeout(10)
try:
    resumed_bytes = 0
    resume_start = time.time()
    while resumed_bytes < 524288:  # Try to read 512KB more
        chunk = sock.recv(65536)
        if not chunk:
            if resumed_bytes == 0:
                print(f"FAIL: Connection dead after {PAUSE_SECONDS}s pause (0 bytes on resume)")
                print(">>> This is the wallclock timeout bug. The proxy killed the stream during backpressure.")
                sys.exit(1)
            break
        resumed_bytes += len(chunk)
    resume_time = time.time() - resume_start
    print(f"PASS: Read {resumed_bytes} bytes after pause in {resume_time:.1f}s")
    print(f"Total: {total_read + resumed_bytes} bytes, stream survived {PAUSE_SECONDS}s backpressure")
except (socket.timeout, ConnectionError, OSError) as e:
    print(f"FAIL: {type(e).__name__}: {e}")
    print(">>> Stream died during backpressure pause. Check proxy timeout configuration.")
    sys.exit(1)
finally:
    sock.close()
```

Run it:
```bash
# Save the script, run against a resolved stream URL
python3 /tmp/backpressure_test.py "$STREAM_URL"
# Expected: PASS — stream survives 20s of silence
# If FAIL: the proxy has a wallclock timeout on the body stream (not just headers)
```

#### 3e. Supplementary: Seek/fast-forward test

This simulates the user scrubbing forward. The critical metric: how fast does the proxy serve bytes from an arbitrary position?

```bash
# Seek test: request bytes from 25%, 50%, 75% into the file
# Each should respond with 206 Partial Content and TTFB < 500ms
echo "=== Seek Test ==="

if [ -n "$CONTENT_LENGTH" ] && [ "$CONTENT_LENGTH" -gt 0 ]; then
  for PCT in 25 50 75; do
    SEEK_POS=$(( CONTENT_LENGTH * PCT / 100 ))
    SEEK_END=$(( SEEK_POS + 524288 ))  # Request 512KB from seek point
    SEEK_RESULT=$(curl -s -o /dev/null \
      -H "Range: bytes=${SEEK_POS}-${SEEK_END}" \
      -w "status:%{http_code} ttfb:%{time_starttransfer}s total:%{time_total}s size:%{size_download}" \
      "http://localhost:3001/api/proxy-stream?url=$ENCODED_STREAM")
    echo "  Seek to ${PCT}%: $SEEK_RESULT"
  done
else
  # No content-length — test Range with arbitrary offsets
  for OFFSET in 5242880 20971520 52428800; do  # 5MB, 20MB, 50MB
    SEEK_END=$((OFFSET + 524288))
    SEEK_RESULT=$(curl -s -o /dev/null \
      -H "Range: bytes=${OFFSET}-${SEEK_END}" \
      -w "status:%{http_code} ttfb:%{time_starttransfer}s total:%{time_total}s" \
      "http://localhost:3001/api/proxy-stream?url=$ENCODED_STREAM")
    echo "  Seek to ${OFFSET}: $SEEK_RESULT"
  done
fi
```

#### 3f. Interpret results

```bash
kill $SERVER_PID 2>/dev/null
```

| Metric | Healthy | Degraded | Critical |
|--------|---------|----------|----------|
| Stream URL resolve time | < 3s | 3-8s | > 8s |
| TTFB (first byte from proxy) | < 500ms | 500ms-2s | > 2s |
| Sustained throughput | > 500 KB/s | 200-500 KB/s | < 200 KB/s |
| Stalls in 2-min test | 0 | 1-2 | 3+ |
| Backpressure survival (20s) | PASS | — | FAIL (stream died) |
| Seek TTFB (any position) | < 500ms | 500ms-1.5s | > 1.5s |
| Seek HTTP status | 206 | 200 (full re-download!) | 4xx/5xx |
| Range support | Yes (206) | Missing headers | Broken |

**If backpressure test FAILS:** The proxy has a wallclock timeout on the upstream body stream. Fix: move the timeout to only cover the header phase (`fetch` with timeout → clear on first response headers → no timeout on body). Ensure `res.on('close')` handles cleanup instead of a timer. This is a P0 — videos will die ~50s in for ANY content longer than the browser's buffer window.

### 4. Playback Optimization Work (rotate daily)

Pick 1-2 based on what the health check and 2-minute test revealed.

#### A. Fast Seeking (Priority: HIGH)

When the user scrubs forward, the video should resume in under 500ms. This requires:

**Server-side (proxy):**
- Ensure `/api/proxy-stream` correctly forwards Range headers to upstream AND returns 206 with proper `Content-Range`
- Verify upstream CDNs actually support byte-range requests (some return 200 + full file regardless — detect and handle this)
- For HLS: seeking means loading the correct segment. Ensure hls.js `startPosition` works and segment index is cached
- Add `Accept-Ranges: bytes` header to ALL proxy responses
- Consider: if upstream doesn't support Range, cache the full file locally and serve ranges from disk (for short videos < 100MB)

**Client-side (FeedVideo.jsx):**
- When user seeks, immediately show the last rendered frame (don't flash black)
- If video is MP4: browser handles seeking natively via Range — ensure the proxy doesn't break this
- If video is HLS: hls.js handles segment seeking — tune `maxBufferHole` and `nudgeMaxRetry` for faster gap recovery
- After a seek, prioritize loading from the new position (cancel any pending fetches for the old position)
- Add `fastSeek()` API usage where supported (less precise but faster than `currentTime` assignment)

**Pre-computation:**
- During warm-cache or stream URL resolution: probe whether the CDN supports Range requests (store in feed_cache as a flag)
- If Range is not supported by a source: flag it so the client can use a different seeking strategy (e.g., reload from new URL with time offset for yt-dlp sources)

#### B. Instant Start (Priority: HIGH)

First frame should appear in < 1 second after the video enters view.

**Pre-resolution:**
- Resolve stream URLs for the next 5 videos during idle time (not just the preload window)
- Move stream URL resolution into warm-cache: every cached video should have a valid stream_url BEFORE the user opens the app
- Re-resolve any URL that's past 50% of its TTL (PornHub: refresh if > 1hr old)

**Pre-buffering:**
- After resolving the next video's stream URL, issue a background `fetch` with `Range: bytes=0-2097152` (first 2MB) through the proxy
- Store in a client-side `Map<streamUrl, ArrayBuffer>` and use as initial source when the video activates
- Alternative: use `link rel="prefetch"` for the proxy URL of the next video
- For HLS: pre-fetch the manifest + first 2 segments of the next video

**Proxy warm-up:**
- The first request to a new CDN domain has TLS handshake overhead. Keep connections alive with `keep-alive` agent in the proxy fetch calls
- Consider an HTTP Agent pool that maintains persistent connections to common CDN domains (e.g., YouTube, PornHub CDNs)

#### C. Bandwidth Adaptation

The environment is a laptop/mini PC with low or variable bandwidth. The system should never request more data than the pipe can deliver without stalling.

**Quality selection:**
- Replace the static yt-dlp format string with a dynamic one based on measured bandwidth
- Add a bandwidth estimator: track download speed of last 3 proxy responses, use rolling average
- Thresholds: < 1 Mbps → 480p, 1-3 Mbps → 720p, > 3 Mbps → 1080p
- Store preferred quality in feed store; allow manual override
- During warm-cache: resolve stream URLs at MULTIPLE qualities (store best + fallback in separate columns or as JSON)

**Runtime downgrade:**
- If the 2-minute test shows stalls: the system should automatically lower the default quality for the next session
- In FeedVideo: if `waiting` event fires more than twice in 30s, dispatch event to downgrade next video's quality
- For HLS: tune `hls.js` ABR settings — lower `maxBufferLength` (default 30s is too aggressive for slow connections), set `maxMaxBufferLength` to 60s, increase `backBufferLength` for seek-back

**Budget-aware buffering:**
- Calculate: video_bitrate vs available_bandwidth. If ratio > 0.8, you're on the edge — pre-buffer more aggressively or drop quality
- Add a "low bandwidth mode" that prefetches more aggressively at lower quality

#### D. Proxy Throughput & Reliability

**Connection management:**
- Use a shared `fetch` agent with `keepAlive: true` for upstream CDN requests
- Pool connections by CDN domain (YouTube CDNs, PornHub CDNs, etc.)
- Set appropriate timeouts: 5s connect, 15s first-byte, no total timeout (streams can be long)

**Chunked delivery optimization:**
- Ensure `Transfer-Encoding: chunked` is used when Content-Length is unknown
- For MP4: if the upstream provides Content-Length, forward it (browsers use it for seek bar accuracy)
- Stream with optimal chunk size: too small = overhead, too large = latency. 64KB chunks are a good default.

**Failover:**
- If upstream stalls (no data for 10s mid-stream): abort and retry with a fresh connection
- If a CDN URL 403s: automatically re-resolve via yt-dlp (URLs can become invalid before `expires_at`)
- Add circuit breaker per CDN domain: if 3 consecutive failures, skip that source for 5 minutes

**Caching layer (optional but high impact):**
- For videos in the "next 3" queue: download entire file to disk cache (`data/stream-cache/`)
- Serve subsequent requests from disk = zero upstream latency, perfect seeking, immune to bandwidth drops
- Cap disk cache at 2GB, LRU eviction
- This is the nuclear option for instant playback — trades disk for experience

#### E. Error Recovery & Graceful Degradation

**Graduated retry (replace current 1-retry approach):**
1. Stream URL expired → re-resolve silently (no UI feedback unless it takes > 3s)
2. Proxy timeout → retry same URL once, then try alternate quality
3. CDN 403/404 → re-resolve with fresh yt-dlp call (force, ignore cache)
4. All qualities fail → show error card with "Try different source" option
5. Network offline → pause, show reconnecting indicator, auto-resume when back

**Seek failure recovery:**
- If seek to position X returns error: try requesting from slightly before X (keyframe alignment)
- If Range not supported: fall back to reloading the full stream and using `currentTime` once buffered
- For HLS: if segment load fails, skip to next segment (brief glitch > infinite spinner)

**Client resilience:**
- Track consecutive failures per source domain in the feed store
- If a source has 3+ failures in this session, deprioritize it in the queue (move those videos to the back)
- Show a subtle "low quality" badge on videos where we had to downgrade, not an error state

### 5. Hydration Maintenance (quick check only)

```javascript
const homepage = db.prepare(`
  SELECT category, mode, SUM(CASE WHEN viewed = 0 THEN 1 ELSE 0 END) as unwatched
  FROM homepage_cache GROUP BY category, mode
`).all()

const feed = db.prepare(`
  SELECT mode, SUM(CASE WHEN watched = 0 THEN 1 ELSE 0 END) as unwatched
  FROM feed_cache GROUP BY mode
`).all()
```

**Only intervene if:**
- Any category < 5 unwatched
- Either mode < 50 unwatched in feed_cache
- warm-cache hasn't run in > 24 hours

Otherwise skip. Cache is healthy.

### 6. Code Quality Pass

```bash
npx eslint src/ server/ --fix
git diff

node --experimental-detect-module server/index.js &
sleep 3

# End-to-end playback verification (abbreviated version of Section 3)
TEST_URL=$(node -e "
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('data/library.db');
const v = db.prepare('SELECT url FROM feed_cache WHERE watched=0 AND stream_url IS NOT NULL ORDER BY RANDOM() LIMIT 1').get();
console.log(v?.url || '');
")

if [ -n "$TEST_URL" ]; then
  ENCODED=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$TEST_URL'))")
  STREAM=$(curl -s "http://localhost:3001/api/stream-url?url=$ENCODED" | jq -r '.streamUrl')
  if [ "$STREAM" != "null" ] && [ -n "$STREAM" ]; then
    ENCODED_STREAM=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$STREAM'))")
    # Verify: starts fast, sustains 30s, seeks work
    echo "=== Quick playback verify ==="
    curl -s -o /dev/null -w "ttfb: %{time_starttransfer}s\n" "http://localhost:3001/api/proxy-stream?url=$ENCODED_STREAM"
    curl -s -o /dev/null --max-time 30 -w "30s_throughput: %{speed_download} bytes/s\n" "http://localhost:3001/api/proxy-stream?url=$ENCODED_STREAM"
    curl -s -o /dev/null -H "Range: bytes=10485760-11534335" -w "seek_status: %{http_code} seek_ttfb: %{time_starttransfer}s\n" "http://localhost:3001/api/proxy-stream?url=$ENCODED_STREAM"
  fi
fi

kill %1 2>/dev/null
npx vitest run --reporter=verbose 2>&1 | tail -30
```

**Comment standards:**
- `// PLAYBACK:` — playback quality logic
- `// SEEK:` — seeking/fast-forward optimization
- `// BUFFER:` — buffering/preload logic
- `// PROXY:` — proxy performance
- `// HYDRATION:` — content freshness (legacy)

### 7. Commit Protocol

All must pass:
```bash
npx eslint src/ server/ 2>&1 | grep -c "error"  # 0
npm run build 2>&1 | tail -5
timeout 5 node --experimental-detect-module server/index.js 2>&1 | tail -10
git diff --stat
```

Message format:
```
playback: <what in <=50 chars>

<1-3 lines: why, tradeoffs>

Diagnostics: <metrics from 2-min test, e.g. "TTFB: 0.4s, seek: 0.3s, 0 stalls, 720p sustained at 450KB/s">
```

### 8. Progress Report

```markdown
### Daily Playback Run — [timestamp]

**2-Minute Streaming Test:**
- Video 1: [source] — TTFB [X]ms, throughput [Y] KB/s, stalls: [N], seek TTFB: [Z]ms
- Video 2: [source] — TTFB [X]ms, throughput [Y] KB/s, stalls: [N], seek TTFB: [Z]ms
- Video 3: [source] — TTFB [X]ms, throughput [Y] KB/s, stalls: [N], seek TTFB: [Z]ms

**Seek Test:** [all 206? TTFB range?]

**Quality Score:** [0-100]
  - Stream validity: [X]%
  - TTFB: [avg]
  - Sustained throughput vs bitrate: [ratio]
  - Seek responsiveness: [avg ms]
  - Errors: [count]
**Trend:** [up/down/flat] from yesterday's [score]

**Actions Taken:** [1-3 bullets]
**Focus:** [section A-E]
**Next Session Should:** [priority]

**Calibration:** Would you watch these?
1. [title] — [source]
2. [title] — [source]
```

### 9. Emergency Protocols

- **All streams stalling:** Check system resources (is something else eating bandwidth?). Test direct CDN URL outside proxy to isolate. If CDN is fine but proxy is slow: Express event loop might be blocked.
- **Seeking completely broken (200 instead of 206):** The upstream CDN doesn't support Range. Add local caching for that source, or switch to HLS format which handles seeking via segments.
- **HLS broken:** Check hls.js version, test with a public m3u8 stream. Verify `/api/hls-proxy` rewrites are correct for the current CDN URL structure.
- **Database corrupted:** Do NOT repair. Log and stop.

---

## What "Done" Looks Like

1. **Browser playback test PASSES** at 1.5 Mbps throttle: first frame < 5s, <= 2 stalls across 5 videos, all seeks resume < 3s
2. Backpressure survival test PASSES (stream survives 20s pause)
3. Seek returns 206 with TTFB < 500ms
4. < 10% of upcoming queue has expired/missing stream URLs
5. Both modes >= 50 unwatched (hydration)
6. Zero ESLint errors, build passes
7. Committed with metrics in message
8. Progress report with quality score and trend
