import { execSync } from 'child_process'

const PORT = 3001
const isCleanup = process.argv.includes('--cleanup')

function getPidsOnPort() {
  try {
    const out = execSync(`netstat -ano | findstr :${PORT}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    // Only match LISTENING lines for the exact port (not just any line containing the port number)
    const lines = out.split('\n').filter(l => {
      return l.includes('LISTENING') && new RegExp(`[:\\s]${PORT}\\s`).test(l)
    })
    return [...new Set(
      lines.map(l => l.trim().split(/\s+/).pop()).filter(p => /^\d+$/.test(p))
    )]
  } catch {
    return []
  }
}

const pids = getPidsOnPort()

if (pids.length === 0) {
  if (isCleanup) console.log(`[PREFLIGHT] Port ${PORT} is free — nothing to clean up.`)
  process.exit(0)
}

if (!isCleanup) {
  console.error(
    `[PREFLIGHT] Port ${PORT} already bound by PID ${pids.join(', ')}. Run npm run dev:cleanup or kill manually.`
  )
  process.exit(1)
}

// Cleanup mode: identify + kill each PID
for (const pid of pids) {
  let name = '(unknown)'
  try {
    const info = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    const match = info.match(/"([^"]+)"/)
    if (match) name = match[1]
  } catch {}

  try {
    console.log(`[PREFLIGHT] Killing PID ${pid} (${name}) bound to :${PORT}`)
    execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' })
  } catch (err) {
    console.warn(`[PREFLIGHT] Could not kill PID ${pid}: ${err.message}`)
  }
}

console.log(`[PREFLIGHT] Cleaned up ${pids.length} process(es) on :${PORT}`)
