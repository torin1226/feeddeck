// ============================================================
// Structured Logger
// JSON-line output for journald/systemd. Each log entry is a
// single JSON line with timestamp, level, message, and optional
// context. In development, falls back to colorized console output.
// ============================================================

const IS_PROD = process.env.NODE_ENV === 'production'

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 }
const MIN_LEVEL = LEVELS[process.env.LOG_LEVEL] ?? (IS_PROD ? LEVELS.info : LEVELS.debug)

// ANSI colors for dev mode
const COLORS = {
  debug: '\x1b[36m', // cyan
  info: '\x1b[32m',  // green
  warn: '\x1b[33m',  // yellow
  error: '\x1b[31m', // red
  reset: '\x1b[0m',
}

function log(level, message, context = {}) {
  if (LEVELS[level] < MIN_LEVEL) return

  if (IS_PROD) {
    // Structured JSON for journald
    const entry = {
      ts: new Date().toISOString(),
      level,
      msg: message,
      ...context,
    }
    const stream = level === 'error' ? process.stderr : process.stdout
    stream.write(JSON.stringify(entry) + '\n')
  } else {
    // Colorized console for development
    const color = COLORS[level] || COLORS.reset
    const prefix = `${color}[${level.toUpperCase()}]${COLORS.reset}`
    const ctx = Object.keys(context).length > 0
      ? ` ${JSON.stringify(context)}`
      : ''
    const stream = level === 'error' ? console.error : console.log
    stream(`${prefix} ${message}${ctx}`)
  }
}

export const logger = {
  debug: (msg, ctx) => log('debug', msg, ctx),
  info: (msg, ctx) => log('info', msg, ctx),
  warn: (msg, ctx) => log('warn', msg, ctx),
  error: (msg, ctx) => log('error', msg, ctx),
}
