import { describe, it, expect } from 'vitest'
import { getFeedStatus } from '../components/feed/FeedStatusOverlay'

describe('getFeedStatus', () => {
  it("returns 'loading' before init completes while a request is in flight", () => {
    expect(getFeedStatus({ initialized: false, loading: true, error: null, isEmpty: true })).toBe('loading')
    expect(getFeedStatus({ initialized: false, loading: true, error: 'X', isEmpty: false })).toBe('loading')
  })

  it("returns 'error' once initialized when the buffer is empty AND error is set", () => {
    expect(getFeedStatus({ initialized: true, loading: false, error: 'fetch failed', isEmpty: true })).toBe('error')
  })

  it("returns 'empty' once initialized when the buffer is empty without an error", () => {
    expect(getFeedStatus({ initialized: true, loading: false, error: null, isEmpty: true })).toBe('empty')
  })

  it('returns null when the feed has slots to render (no overlay needed)', () => {
    expect(getFeedStatus({ initialized: true, loading: false, error: null, isEmpty: false })).toBeNull()
    expect(getFeedStatus({ initialized: true, loading: false, error: 'transient', isEmpty: false })).toBeNull()
  })

  it('prioritises the loading state over a stale error from a prior fetch', () => {
    // initialized=false beats any other signal — the overlay should not flash
    // an error while a fresh request is mid-flight.
    expect(getFeedStatus({ initialized: false, loading: true, error: 'stale', isEmpty: true })).toBe('loading')
  })
})
