import { describe, it, expect } from 'vitest'
import { resolveWatchItem } from '../utils/resolveWatchItem'

// ============================================================
// resolveWatchItem — VDP id-namespace bridge (AP3c regression)
//
// VDP's /watch/:id route receives ids from THREE distinct namespaces:
//   - homeStore composite ids (e.g. "youtube_top10_abc123")
//   - libraryStore bare UUIDs (Continue Watching deep links)
//   - queueStore server-PK numbers
// Before the fix, only homeStore was searched and library/queue
// deep links rendered "Video not found".
// ============================================================

const heroItem = { id: 'hero_yt_1', url: 'https://yt/1', title: 'Hero' }
const carouselItem = { id: 'cat_yt_2', url: 'https://yt/2', title: 'Carousel' }
const top10Item = { id: 'top_yt_3', url: 'https://yt/3', title: 'Top10' }
const categoryItem = { id: 'cat_yt_4', url: 'https://yt/4', title: 'CatItem' }
const dividerItem = { id: 'cat_yt_4', _isDivider: true, title: 'Divider' }
const libVideo = {
  id: '11111111-2222-3333-4444-555555555555',
  url: 'https://yt/lib',
  title: 'Library Video',
}
const queueServerItem = {
  id: 42,
  video_url: 'https://yt/queued',
  title: 'Queued',
  thumbnail: 'thumb.jpg',
  duration: 120,
  duration_formatted: '2:00',
  uploader: 'creator',
}

const allSources = {
  heroItem,
  carouselItems: [carouselItem],
  top10: [top10Item],
  categories: [{ items: [dividerItem, categoryItem] }],
  libraryVideos: [libVideo],
  queueItems: [queueServerItem],
}

describe('resolveWatchItem', () => {
  it('returns null for missing id', () => {
    expect(resolveWatchItem(null, allSources)).toBeNull()
    expect(resolveWatchItem(undefined, allSources)).toBeNull()
    expect(resolveWatchItem('', allSources)).toBeNull()
  })

  it('returns null for missing sources', () => {
    expect(resolveWatchItem('hero_yt_1', null)).toBeNull()
    expect(resolveWatchItem('hero_yt_1', undefined)).toBeNull()
  })

  it('finds hero item first', () => {
    const found = resolveWatchItem('hero_yt_1', allSources)
    expect(found).toBe(heroItem)
  })

  it('finds carousel item', () => {
    const found = resolveWatchItem('cat_yt_2', allSources)
    expect(found).toBe(carouselItem)
  })

  it('finds top10 item', () => {
    const found = resolveWatchItem('top_yt_3', allSources)
    expect(found).toBe(top10Item)
  })

  it('finds category item, skipping dividers', () => {
    const found = resolveWatchItem('cat_yt_4', allSources)
    expect(found).toBe(categoryItem)
    expect(found._isDivider).toBeUndefined()
  })

  it('finds library video by bare UUID (CW deep link bridge)', () => {
    const found = resolveWatchItem(libVideo.id, allSources)
    expect(found).toBe(libVideo)
  })

  it('finds library video when no homeStore items exist', () => {
    const found = resolveWatchItem(libVideo.id, {
      heroItem: null,
      carouselItems: [],
      top10: [],
      categories: [],
      libraryVideos: [libVideo],
      queueItems: [],
    })
    expect(found).toBe(libVideo)
  })

  it('synthesizes a watchable item from a queue server-PK id', () => {
    const found = resolveWatchItem(42, allSources)
    expect(found).toMatchObject({
      id: 42,
      url: 'https://yt/queued',
      title: 'Queued',
      thumbnail: 'thumb.jpg',
      duration: 120,
      durationFormatted: '2:00',
      uploader: 'creator',
    })
  })

  it('queue lookup falls through if id is not a queue PK', () => {
    const found = resolveWatchItem('999', allSources)
    expect(found).toBeNull()
  })

  it('coerces numeric ids to string for matching', () => {
    const found = resolveWatchItem('42', allSources)
    expect(found?.url).toBe('https://yt/queued')
  })

  it('homeStore wins over library when ids collide', () => {
    const collide = { id: 'shared', url: 'home', title: 'Home' }
    const libCollide = { id: 'shared', url: 'lib', title: 'Lib' }
    const found = resolveWatchItem('shared', {
      heroItem: collide,
      libraryVideos: [libCollide],
    })
    expect(found).toBe(collide)
  })

  it('library wins over queue when ids collide', () => {
    const lib = { id: '7', url: 'lib' }
    const q = { id: 7, video_url: 'queue' }
    const found = resolveWatchItem('7', {
      libraryVideos: [lib],
      queueItems: [q],
    })
    expect(found).toBe(lib)
  })

  it('returns null when nothing matches', () => {
    expect(resolveWatchItem('not-a-real-id', allSources)).toBeNull()
  })

  it('handles empty arrays gracefully', () => {
    expect(resolveWatchItem('anything', {
      heroItem: null,
      carouselItems: [],
      top10: [],
      categories: [],
      libraryVideos: [],
      queueItems: [],
    })).toBeNull()
  })

  it('skips null entries safely in arrays', () => {
    const found = resolveWatchItem('cat_yt_4', {
      categories: [{ items: [null, undefined, dividerItem, categoryItem] }],
    })
    expect(found).toBe(categoryItem)
  })
})
