import { describe, it, expect, beforeEach } from 'vitest'
import useHomeStore from '../stores/homeStore'

// ============================================================
// homeStore focusedItem contract (Milestone 0.1)
//
// Verifies the single-source-of-truth focused-item state that
// preview hooks and feed dedup will subscribe to.
// ============================================================

beforeEach(() => {
  // Reset between tests so leftover focus state from one test
  // doesn't leak into the next.
  useHomeStore.setState({
    focusedItem: null,
    heroItem: null,
    carouselItems: [],
    categories: [],
    loadedCategoryIndices: [],
    top10: [],
    theatreMode: false,
    inlinePlay: false,
    fetchError: null,
    refreshing: false,
    shuffling: false,
  })
})

const ytItem = {
  id: 'yt-1',
  url: 'https://youtube.com/watch?v=abc',
  title: 'YT Video',
}

const phItem = {
  id: 'ph-1',
  url: 'https://pornhub.com/view_video.php?viewkey=xyz',
  title: 'PH Video',
}

const idOnlyItem = { id: 'plain-1', title: 'Plain' }

describe('homeStore focusedItem', () => {
  it('starts as null', () => {
    expect(useHomeStore.getState().focusedItem).toBeNull()
  })

  it('setFocusedItem stores id, url, surface, and inferred mode', () => {
    useHomeStore.getState().setFocusedItem(ytItem, 'hero')
    const f = useHomeStore.getState().focusedItem
    expect(f).toEqual({
      id: 'yt-1',
      url: 'https://youtube.com/watch?v=abc',
      surface: 'hero',
      mode: 'social',
      inputKind: 'mouse',
      adjacentItems: [],
    })
  })

  it('infers nsfw mode from URL', () => {
    useHomeStore.getState().setFocusedItem(phItem, 'gallery-shelf')
    expect(useHomeStore.getState().focusedItem.mode).toBe('nsfw')
  })

  it('honors explicit item.mode field over URL inference', () => {
    useHomeStore.getState().setFocusedItem(
      { ...ytItem, mode: 'nsfw' },
      'hero'
    )
    expect(useHomeStore.getState().focusedItem.mode).toBe('nsfw')
  })

  it('stores items without a url (mode falls back to social default)', () => {
    useHomeStore.getState().setFocusedItem(idOnlyItem, 'top10')
    const f = useHomeStore.getState().focusedItem
    expect(f.id).toBe('plain-1')
    expect(f.url).toBeNull()
    expect(f.surface).toBe('top10')
    expect(f.mode).toBe('social')
  })

  it('passing null clears focus', () => {
    useHomeStore.getState().setFocusedItem(ytItem, 'hero')
    expect(useHomeStore.getState().focusedItem).not.toBeNull()
    useHomeStore.getState().setFocusedItem(null)
    expect(useHomeStore.getState().focusedItem).toBeNull()
  })

  it('switching surfaces immediately replaces focus (no debounce)', () => {
    useHomeStore.getState().setFocusedItem(ytItem, 'hero')
    useHomeStore.getState().setFocusedItem(phItem, 'gallery-shelf')
    const f = useHomeStore.getState().focusedItem
    expect(f.id).toBe('ph-1')
    expect(f.surface).toBe('gallery-shelf')
    expect(f.mode).toBe('nsfw')
  })

  it('dedupes calls with same id + surface (no extra writes during scroll)', () => {
    useHomeStore.getState().setFocusedItem(ytItem, 'gallery-shelf')
    const ref1 = useHomeStore.getState().focusedItem
    useHomeStore.getState().setFocusedItem(ytItem, 'gallery-shelf')
    const ref2 = useHomeStore.getState().focusedItem
    // Same object identity proves the store wasn't re-set
    expect(ref2).toBe(ref1)
  })

  it('same id with different surface does write', () => {
    useHomeStore.getState().setFocusedItem(ytItem, 'hero')
    const ref1 = useHomeStore.getState().focusedItem
    useHomeStore.getState().setFocusedItem(ytItem, 'gallery-shelf')
    const ref2 = useHomeStore.getState().focusedItem
    expect(ref2).not.toBe(ref1)
    expect(ref2.surface).toBe('gallery-shelf')
  })

  it('rejects items with neither id nor url', () => {
    useHomeStore.getState().setFocusedItem(ytItem, 'hero')
    useHomeStore.getState().setFocusedItem({ title: 'no id' }, 'hero')
    // Untouched — bad input is a no-op, not a crash
    expect(useHomeStore.getState().focusedItem.id).toBe('yt-1')
  })

  it('resetHome clears focusedItem', () => {
    useHomeStore.getState().setFocusedItem(ytItem, 'hero')
    expect(useHomeStore.getState().focusedItem).not.toBeNull()
    useHomeStore.getState().resetHome()
    expect(useHomeStore.getState().focusedItem).toBeNull()
  })

  it('falls back url to id when no url field present', () => {
    useHomeStore.getState().setFocusedItem(idOnlyItem, 'top10')
    const f = useHomeStore.getState().focusedItem
    expect(f.url).toBeNull()
    expect(f.id).toBe('plain-1')
  })

  it('default surface label when omitted', () => {
    useHomeStore.getState().setFocusedItem(ytItem)
    expect(useHomeStore.getState().focusedItem.surface).toBe('unknown')
  })

  it('captures opts.inputKind when explicitly keyboard', () => {
    useHomeStore.getState().setFocusedItem(ytItem, 'gallery-shelf', { inputKind: 'keyboard' })
    expect(useHomeStore.getState().focusedItem.inputKind).toBe('keyboard')
  })

  it('rejects unknown inputKind values and falls back to mouse', () => {
    useHomeStore.getState().setFocusedItem(ytItem, 'gallery-shelf', { inputKind: 'banana' })
    expect(useHomeStore.getState().focusedItem.inputKind).toBe('mouse')
  })

  it('accepts auto inputKind for non-user-driven focus claims', () => {
    useHomeStore.getState().setFocusedItem(ytItem, 'hero', { inputKind: 'auto' })
    expect(useHomeStore.getState().focusedItem.inputKind).toBe('auto')
  })

  it('captures adjacentItems for eager prefetch', () => {
    const adj = [
      { id: 'next-1', url: 'https://youtube.com/watch?v=next1' },
      { id: 'next-2', url: 'https://youtube.com/watch?v=next2' },
    ]
    useHomeStore.getState().setFocusedItem(ytItem, 'gallery-shelf', { adjacentItems: adj })
    expect(useHomeStore.getState().focusedItem.adjacentItems).toEqual(adj)
  })

  it('non-array adjacentItems defaults to empty list', () => {
    useHomeStore.getState().setFocusedItem(ytItem, 'gallery-shelf', { adjacentItems: 'not-an-array' })
    expect(useHomeStore.getState().focusedItem.adjacentItems).toEqual([])
  })
})
