import { describe, it, expect, beforeEach, vi } from 'vitest'
import useAudioFeedStore from '../stores/audioFeedStore'

// ============================================================
// audioFeedStore contract tests (2026-05-16 cycle-2 audit)
//
// Locks down four bug classes the audit surfaced:
//   1. onPlaybackError advances WITHOUT marking complete (asymmetric
//      to onEnded, same shape as useHeroAutoplay 956c8de).
//   2. rateCurrent rolls back local state on HTTP errors too, not
//      just thrown fetch errors.
//   3. loadFeed preserves the playing track's currentIndex across an
//      items[] swap by re-finding the id in the new list; sets to -1
//      if the track is no longer in the filtered set.
//   4. loadFeed drops stale responses when a newer call has been
//      kicked off (token guard against rapid filter changes).
// ============================================================

const NS = (id) => ({ id, audio_url: `https://media/${id}.m4a`, title: id, creator: 'c1', tags: [] })

beforeEach(() => {
  useAudioFeedStore.setState({
    items: [],
    loading: false,
    error: null,
    currentIndex: -1,
    isPlaying: false,
    position: 0,
    duration: 0,
    localRatings: new Map(),
    _loadFeedToken: 0,
    query: '',
    creatorFilter: null,
    sourceFilter: null,
  })
  vi.restoreAllMocks()
})

describe('onPlaybackError vs onEnded asymmetry', () => {
  it('onEnded marks /complete and advances', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    globalThis.fetch = fetchSpy
    useAudioFeedStore.setState({
      items: [NS('a1'), NS('a2')],
      currentIndex: 0,
      isPlaying: true,
    })

    await useAudioFeedStore.getState().onEnded()

    expect(fetchSpy).toHaveBeenCalledWith('/api/audio/a1/complete', { method: 'POST' })
    expect(useAudioFeedStore.getState().currentIndex).toBe(1)
  })

  it('onPlaybackError advances but does NOT call /complete (the regression fix)', () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    globalThis.fetch = fetchSpy
    useAudioFeedStore.setState({
      items: [NS('a1'), NS('a2')],
      currentIndex: 0,
      isPlaying: true,
    })

    useAudioFeedStore.getState().onPlaybackError()

    // The broken track (a1) must never be marked /complete — that would
    // sink it from the feed even on a transient CDN failure.
    const completeCalls = fetchSpy.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.includes('/complete')
    )
    expect(completeCalls).toHaveLength(0)
    expect(useAudioFeedStore.getState().currentIndex).toBe(1)
  })

  it('onPlaybackError at last track stops playback without marking complete', () => {
    const fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy
    useAudioFeedStore.setState({
      items: [NS('a1')],
      currentIndex: 0,
      isPlaying: true,
    })

    useAudioFeedStore.getState().onPlaybackError()

    // No /complete fired; no /play fired (no next track).
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(useAudioFeedStore.getState().isPlaying).toBe(false)
  })
})

describe('rateCurrent HTTP error rollback', () => {
  it('rolls back optimistic rating on HTTP 500 (not just thrown error)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    })
    useAudioFeedStore.setState({
      items: [NS('a1')],
      currentIndex: 0,
    })

    await useAudioFeedStore.getState().rateCurrent('up')

    const local = useAudioFeedStore.getState().localRatings
    expect(local.has('a1')).toBe(false)
    expect(useAudioFeedStore.getState().error).toMatch(/500/)
  })

  it('keeps optimistic rating on HTTP 200', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    })
    useAudioFeedStore.setState({
      items: [NS('a1'), NS('a2')],
      currentIndex: 0,
    })

    await useAudioFeedStore.getState().rateCurrent('up')

    const local = useAudioFeedStore.getState().localRatings
    expect(local.get('a1')).toBe(1)
    expect(useAudioFeedStore.getState().error).toBeNull()
  })

  it('rolls back on thrown network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network'))
    useAudioFeedStore.setState({
      items: [NS('a1')],
      currentIndex: 0,
    })

    await useAudioFeedStore.getState().rateCurrent('down')

    expect(useAudioFeedStore.getState().localRatings.has('a1')).toBe(false)
    expect(useAudioFeedStore.getState().currentIndex).toBe(0) // did NOT advance on rollback
  })

  it('down-vote on 200 advances; down-vote on 500 does not', async () => {
    useAudioFeedStore.setState({
      items: [NS('a1'), NS('a2')],
      currentIndex: 0,
    })
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    await useAudioFeedStore.getState().rateCurrent('down')
    expect(useAudioFeedStore.getState().currentIndex).toBe(1)

    useAudioFeedStore.setState({ currentIndex: 0 })
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'oops' })
    await useAudioFeedStore.getState().rateCurrent('down')
    expect(useAudioFeedStore.getState().currentIndex).toBe(0)
  })
})

describe('loadFeed preserves currentIndex across items[] swap', () => {
  it('re-finds the playing track in the new list when filter narrows', async () => {
    useAudioFeedStore.setState({
      items: [NS('a1'), NS('a2'), NS('a3')],
      currentIndex: 1, // playing a2
    })
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [NS('a2'), NS('a3')] }),
    })

    await useAudioFeedStore.getState().loadFeed()

    expect(useAudioFeedStore.getState().currentIndex).toBe(0) // a2 is now at index 0
    expect(useAudioFeedStore.getState().items[0].id).toBe('a2')
  })

  it('sets currentIndex to -1 when the playing track is filtered out', async () => {
    useAudioFeedStore.setState({
      items: [NS('a1'), NS('a2'), NS('a3')],
      currentIndex: 1, // playing a2
    })
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [NS('b1'), NS('b2')] }),
    })

    await useAudioFeedStore.getState().loadFeed()

    expect(useAudioFeedStore.getState().currentIndex).toBe(-1)
  })

  it('keeps currentIndex at -1 when nothing is playing', async () => {
    useAudioFeedStore.setState({ items: [], currentIndex: -1 })
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [NS('a1'), NS('a2')] }),
    })

    await useAudioFeedStore.getState().loadFeed()

    expect(useAudioFeedStore.getState().currentIndex).toBe(-1)
    expect(useAudioFeedStore.getState().items.length).toBe(2)
  })
})

describe('loadFeed stale-fetch token guard', () => {
  it('drops the older response when a newer loadFeed call has started', async () => {
    let slowResolve
    const slowFetch = new Promise(r => { slowResolve = r })
    let fastResolve
    const fastFetch = new Promise(r => { fastResolve = r })

    globalThis.fetch = vi.fn()
      .mockReturnValueOnce(slowFetch)
      .mockReturnValueOnce(fastFetch)

    const slow = useAudioFeedStore.getState().loadFeed()
    const fast = useAudioFeedStore.getState().loadFeed()

    fastResolve({ ok: true, json: async () => ({ items: [NS('fresh')] }) })
    await fast
    expect(useAudioFeedStore.getState().items[0].id).toBe('fresh')

    slowResolve({ ok: true, json: async () => ({ items: [NS('stale')] }) })
    await slow

    // The slower response must NOT overwrite the fresher one.
    expect(useAudioFeedStore.getState().items[0].id).toBe('fresh')
  })

  it('suppresses error from a superseded call', async () => {
    let staleReject
    const staleFetch = new Promise((_r, rej) => { staleReject = rej })
    let freshResolve
    const freshFetch = new Promise(r => { freshResolve = r })

    globalThis.fetch = vi.fn()
      .mockReturnValueOnce(staleFetch)
      .mockReturnValueOnce(freshFetch)

    const stale = useAudioFeedStore.getState().loadFeed()
    const fresh = useAudioFeedStore.getState().loadFeed()

    freshResolve({ ok: true, json: async () => ({ items: [NS('a1')] }) })
    await fresh

    staleReject(new Error('network blip on superseded call'))
    await stale

    // Error from a superseded call should not clobber the fresh success.
    expect(useAudioFeedStore.getState().error).toBeNull()
    expect(useAudioFeedStore.getState().items[0].id).toBe('a1')
  })
})
