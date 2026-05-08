import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import useQueueStore from '../stores/queueStore'
import useModeStore from '../stores/modeStore'

// ============================================================
// queueStore.reorder() — cross-cutting rollback hygiene
//
// Same shape as the toast race (b2b1b01) and eporner concurrency
// race (1cdf8eb): a module-level snapshot mutated across an async
// boundary. The reorder PUT is debounced 300ms and on failure
// rolls back to a snapshot captured at burst start. A mode switch
// (or any sibling mutation) between schedule and fire would
// previously resurrect the stale queue under the new mode.
// ============================================================

describe('queueStore.reorder() rollback hygiene', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Default: PUT and DELETE both succeed unless overridden per-test.
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ queue: [] }) })
    )
    useQueueStore.setState({ queue: [], currentIndex: -1, online: true, lastSynced: null })
    useModeStore.setState({ isSFW: false }) // start in NSFW for the cross-mode tests
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('does not roll back to the pre-switch queue when mode flipped during debounce', async () => {
    const nsfwQueue = [
      { id: 'n1', url: 'https://nsfw.example/a', video_url: 'https://nsfw.example/a' },
      { id: 'n2', url: 'https://nsfw.example/b', video_url: 'https://nsfw.example/b' },
      { id: 'n3', url: 'https://nsfw.example/c', video_url: 'https://nsfw.example/c' },
    ]
    useQueueStore.setState({ queue: nsfwQueue, currentIndex: 0 })

    // First drag captures the snapshot
    useQueueStore.getState().reorder(0, 2)
    expect(useQueueStore.getState().queue.map(q => q.id)).toEqual(['n2', 'n3', 'n1'])

    // Mode flips and clearQueue runs (the nuclearFlush path) before the 300ms PUT fires.
    // clearQueue must invalidate the rollback snapshot so the timer's catch path can't
    // resurrect the NSFW items under the new SFW mode.
    useModeStore.setState({ isSFW: true })
    // Make the next PUT fail so the catch branch would otherwise roll back.
    globalThis.fetch = vi.fn(() => Promise.reject(new Error('network')))
    await useQueueStore.getState().clearQueue()
    expect(useQueueStore.getState().queue).toEqual([])

    // Drain the debounced timer and any pending microtasks.
    await vi.runAllTimersAsync()

    // Cross-mode contamination would manifest as the NSFW queue resurrecting.
    expect(useQueueStore.getState().queue).toEqual([])
    expect(useQueueStore.getState().currentIndex).toBe(-1)
  })

  it('does not roll back to a stale snapshot when items were removed during debounce', async () => {
    // Stay in NSFW mode (set by beforeEach). Tag items explicitly so the
    // queueStore's mode firewall (isVideoForMode) accepts them.
    const item = (id) => ({ id, url: `u${id}`, video_url: `u${id}`, mode: 'nsfw' })
    useQueueStore.setState({
      queue: [item(1), item(2), item(3)],
      currentIndex: 0,
    })

    useQueueStore.getState().reorder(0, 2)

    // User removes item 2 while reorder is debounced. Server returns the
    // post-remove queue.
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ queue: [item(1), item(3)] }),
      })
    )
    await useQueueStore.getState().removeFromQueue(2)
    expect(useQueueStore.getState().queue.map(q => q.id)).toEqual([1, 3])

    // Now the debounced reorder PUT fires and fails. The rollback snapshot was
    // taken from the pre-remove queue and would resurrect item 2 — the fix
    // invalidates the snapshot on remove, so the catch branch becomes a no-op.
    globalThis.fetch = vi.fn(() => Promise.reject(new Error('network')))
    await vi.runAllTimersAsync()

    expect(useQueueStore.getState().queue.map(q => q.id)).toEqual([1, 3])
  })

  it('still rolls back when reorder PUT fails with no sibling mutations', async () => {
    const item = (id) => ({ id, url: `u${id}`, video_url: `u${id}`, mode: 'nsfw' })
    useQueueStore.setState({
      queue: [item(1), item(2), item(3)],
      currentIndex: 0,
    })

    useQueueStore.getState().reorder(0, 2)
    expect(useQueueStore.getState().queue.map(q => q.id)).toEqual([2, 3, 1])

    globalThis.fetch = vi.fn(() => Promise.reject(new Error('network')))
    await vi.runAllTimersAsync()

    // Pre-reorder order is restored
    expect(useQueueStore.getState().queue.map(q => q.id)).toEqual([1, 2, 3])
    expect(useQueueStore.getState().currentIndex).toBe(0)
    expect(useQueueStore.getState().online).toBe(false)
  })
})
