// ============================================================
// Boundary outcome classifier
// Pure functions that map an HTTP response or thrown error to
// one of eight outcome tags. No I/O, no side effects.
// ============================================================

export const OUTCOMES = Object.freeze({
  OK: 'ok',
  EMPTY: 'empty',
  WRONG_SHAPE: 'wrong_shape',
  AUTH_FAILED: 'auth_failed',
  RATE_LIMITED: 'rate_limited',
  TIMEOUT: 'timeout',
  BLOCKED: 'blocked',
  UNKNOWN_ERROR: 'unknown_error',
})

const GEO_BODY_FRAGMENTS = [
  'not available in your region',
  'not available in your country',
  'video unavailable in your country',
]

function isEmpty(body) {
  if (body == null) return true
  if (typeof body === 'string') return body.length === 0
  if (Array.isArray(body)) return body.length === 0
  if (typeof body === 'object') return Object.keys(body).length === 0
  return false
}

function bodyLooksLikeHtml(body) {
  if (typeof body !== 'string') return false
  const head = body.slice(0, 200).toLowerCase()
  return head.includes('<!doctype html') || head.includes('<html')
}

export function classifyHttp(response, body) {
  const status = response?.status ?? 0
  const bodyText = typeof body === 'string' ? body.toLowerCase() : ''

  if (status === 451) return OUTCOMES.BLOCKED
  if (status === 403 && GEO_BODY_FRAGMENTS.some(f => bodyText.includes(f))) {
    return OUTCOMES.BLOCKED
  }
  if (status === 401 || status === 403) return OUTCOMES.AUTH_FAILED
  if (status === 429) return OUTCOMES.RATE_LIMITED

  if (status >= 200 && status < 300) {
    if (isEmpty(body)) return OUTCOMES.EMPTY
    if (bodyLooksLikeHtml(body)) return OUTCOMES.WRONG_SHAPE
    return OUTCOMES.OK
  }

  return OUTCOMES.UNKNOWN_ERROR
}

export function classifyError(err) {
  if (!err) return OUTCOMES.UNKNOWN_ERROR
  const msg = (err.stderr || err.message || '').toLowerCase()
  const code = err.code || err.name || ''

  if (
    err.name === 'AbortError' ||
    code === 'ABORT_ERR' ||
    code === 'ETIMEDOUT' ||
    code === 'ESOCKETTIMEDOUT' ||
    code === 'ENOTFOUND' ||
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'EAI_AGAIN'
  ) {
    return OUTCOMES.TIMEOUT
  }

  if (msg.includes('cookies are no longer valid') || msg.includes('login required')) {
    return OUTCOMES.AUTH_FAILED
  }

  if (msg.includes('http error 429') || msg.includes('rate limit')) {
    return OUTCOMES.RATE_LIMITED
  }

  if (msg.includes('unavailable in your country') || msg.includes('cloudflare challenge')) {
    return OUTCOMES.BLOCKED
  }

  if (err.name === 'SyntaxError' || msg.includes('unexpected token')) {
    return OUTCOMES.WRONG_SHAPE
  }

  return OUTCOMES.UNKNOWN_ERROR
}
