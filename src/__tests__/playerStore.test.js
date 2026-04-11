import { describe, it, expect, beforeEach } from 'vitest'
import usePlayerStore from '../stores/playerStore'

describe('playerStore', () => {
  beforeEach(() => {
    usePlayerStore.setState({
      activeVideo: null,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      streamUrl: null,
      streamLoading: false,
      streamError: null,
    })
  })

  it('initializes with null activeVideo', () => {
    const state = usePlayerStore.getState()
    expect(state.activeVideo).toBeNull()
  })

  it('initializes with no stream URL', () => {
    const state = usePlayerStore.getState()
    expect(state.streamUrl).toBeNull()
    expect(state.streamLoading).toBe(false)
  })
})
