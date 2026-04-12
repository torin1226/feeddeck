import { describe, it, expect } from 'vitest'

// Local safeParse implementation for testing
function safeParse(str, fallback = null) {
  try {
    return JSON.parse(str)
  } catch {
    return fallback
  }
}

describe('safeParse', () => {
  it('parses valid JSON', () => {
    expect(safeParse('{"a":1}')).toEqual({ a: 1 })
  })

  it('returns fallback on invalid JSON', () => {
    expect(safeParse('not json')).toBeNull()
    expect(safeParse('not json', [])).toEqual([])
  })

  it('handles empty/null input', () => {
    expect(safeParse('')).toBeNull()
    expect(safeParse(null)).toBeNull()
    expect(safeParse(undefined)).toBeNull()
  })
})
