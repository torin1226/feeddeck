import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock modeStore so we don't pull the rest of the store graph (and
// nuclearFlush) into the test environment. loadFromServer only reads
// `isSFW` so a static getState() shim is enough.
vi.mock('../stores/modeStore', () => ({
  default: { getState: () => ({ isSFW: true }) },
}))

import useLibraryStore from '../stores/libraryStore'

// ============================================================
// loadFromServer cross-mode leak fix (Discovered 2026-05-06)
//
// Old contract: skipped state replacement when server returned 0
// videos, leaving stale cross-mode entries (e.g. NSFW rows visible
// after switching to SFW) in the store. LibraryPage's count display
// uses unfiltered `videos.length` and would leak the cross-mode count.
//
// New contract:
//   - 200 with array (including empty): always replace
//   - non-2xx: retain prior state, set `error`
//   - thrown fetch (network down): retain prior state, no error
// ============================================================

beforeEach(() => {
  useLibraryStore.setState({ videos: [], loading: false, error: null })
  vi.restoreAllMocks()
})

describe('libraryStore.loadFromServer', () => {
  it('replaces store with empty array on 200 + empty videos (closes cross-mode leak)', async () => {
    useLibraryStore.setState({
      videos: [{ id: 'stale-nsfw-1', mode: 'nsfw', title: 'Leftover NSFW' }],
    })

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ videos: [] }),
    })

    await useLibraryStore.getState().loadFromServer()

    expect(useLibraryStore.getState().videos).toEqual([])
    expect(useLibraryStore.getState().error).toBeNull()
  })

  it('replaces store with the returned array on 200 + populated videos', async () => {
    useLibraryStore.setState({
      videos: [{ id: 'old', mode: 'social' }],
    })

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        videos: [
          { id: 'a', title: 'A', url: 'https://youtube.com/a' },
          { id: 'b', title: 'B', url: 'https://youtube.com/b' },
        ],
      }),
    })

    await useLibraryStore.getState().loadFromServer()

    const v = useLibraryStore.getState().videos
    expect(v).toHaveLength(2)
    expect(v[0]).toMatchObject({ id: 'a', mode: 'social' })
    expect(v[1]).toMatchObject({ id: 'b', mode: 'social' })
  })

  it('retains prior state and surfaces error on 5xx (DB error contract)', async () => {
    const prior = [{ id: 'keep', mode: 'social', title: 'Should stay' }]
    useLibraryStore.setState({ videos: prior })

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Failed to load videos' }),
    })

    await useLibraryStore.getState().loadFromServer()

    expect(useLibraryStore.getState().videos).toEqual(prior)
    expect(useLibraryStore.getState().error).toMatch(/500/)
  })

  it('retains prior state and stays silent when fetch throws (server unreachable)', async () => {
    const prior = [{ id: 'keep', mode: 'social' }]
    useLibraryStore.setState({ videos: prior })

    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'))

    await useLibraryStore.getState().loadFromServer()

    expect(useLibraryStore.getState().videos).toEqual(prior)
    expect(useLibraryStore.getState().error).toBeNull()
  })

  it('clears any prior error on a successful subsequent load', async () => {
    useLibraryStore.setState({
      videos: [{ id: 'x', mode: 'social' }],
      error: 'Failed to load library (500)',
    })

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ videos: [{ id: 'y', mode: 'social' }] }),
    })

    await useLibraryStore.getState().loadFromServer()

    expect(useLibraryStore.getState().error).toBeNull()
    expect(useLibraryStore.getState().videos).toHaveLength(1)
  })

  it('resets loading flag in finally block on both success and failure', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ videos: [] }),
    })
    await useLibraryStore.getState().loadFromServer()
    expect(useLibraryStore.getState().loading).toBe(false)

    globalThis.fetch = vi.fn().mockRejectedValue(new Error('boom'))
    await useLibraryStore.getState().loadFromServer()
    expect(useLibraryStore.getState().loading).toBe(false)
  })
})
