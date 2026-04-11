import { describe, it, expect, beforeEach } from 'vitest'
import useFeedStore from '../stores/feedStore'

describe('feedStore', () => {
  beforeEach(() => {
    useFeedStore.setState({
      buffer: [],
      currentIndex: 0,
      loading: false,
      initialized: false,
      watchedIds: new Set(),
      exhausted: false,
    })
  })

  it('initializes with empty buffer', () => {
    const state = useFeedStore.getState()
    expect(state.buffer).toEqual([])
  })

  it('initializes as not loaded', () => {
    const state = useFeedStore.getState()
    expect(state.initialized).toBe(false)
    expect(state.loading).toBe(false)
  })
})
