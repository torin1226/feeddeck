import { describe, it, expect, beforeEach, vi } from 'vitest'
import useQueueStore from '../stores/queueStore'

// ============================================================
// queueStore.advance() — AP3b regression
//
// VDP's autoadvance now calls advance() when the next item came
// from the queue, so currentIndex moves forward and the next page
// load doesn't re-offer the same row.
// ============================================================

describe('queueStore.advance()', () => {
  beforeEach(() => {
    // Stub fetch — advance() fires a background fetchQueue we don't care about.
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 500 }))
    useQueueStore.setState({
      queue: [],
      currentIndex: -1,
      online: true,
      lastSynced: null,
    })
  })

  it('returns null when queue is empty', () => {
    expect(useQueueStore.getState().advance()).toBeNull()
    expect(useQueueStore.getState().currentIndex).toBe(-1)
  })

  it('returns null and does not move when at the last item', () => {
    useQueueStore.setState({
      queue: [{ id: 1, url: 'a', video_url: 'a' }],
      currentIndex: 0,
    })
    expect(useQueueStore.getState().advance()).toBeNull()
    expect(useQueueStore.getState().currentIndex).toBe(0)
  })

  it('advances cursor by one and returns the next item', () => {
    useQueueStore.setState({
      queue: [
        { id: 1, url: 'a', video_url: 'a' },
        { id: 2, url: 'b', video_url: 'b' },
      ],
      currentIndex: 0,
    })
    const next = useQueueStore.getState().advance()
    expect(next).toMatchObject({ id: 2, url: 'b' })
    expect(useQueueStore.getState().currentIndex).toBe(1)
  })

  it('skips items missing both url and video_url', () => {
    useQueueStore.setState({
      queue: [
        { id: 1, url: 'a' },
        { id: 2 },
      ],
      currentIndex: 0,
    })
    expect(useQueueStore.getState().advance()).toBeNull()
    expect(useQueueStore.getState().currentIndex).toBe(0)
  })
})
