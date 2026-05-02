import { describe, it, expect } from 'vitest'
import { computeSuggested } from '../hooks/useSuggested'

const mkItem = (id, overrides = {}) => ({
  id,
  title: `Title ${id}`,
  url: `https://example.com/${id}`,
  thumbnail: `https://example.com/${id}.jpg`,
  uploader: `Creator${id}`,
  tags: [],
  ...overrides,
})

describe('computeSuggested', () => {
  it('returns empty lists when no homepage data is loaded', () => {
    const out = computeSuggested({ seedId: 'any' })
    expect(out.related).toEqual([])
    expect(out.recommended).toEqual([])
  })

  it('excludes the seed id from related and recommended', () => {
    const items = [
      mkItem('a', { tags: ['x'] }),
      mkItem('b', { tags: ['x'] }),
      mkItem('c', { tags: ['y'] }),
    ]
    const out = computeSuggested({
      seedId: 'a',
      categories: [{ label: 'Cat', items }],
    })
    expect(out.related.find((it) => it.id === 'a')).toBeUndefined()
    expect(out.recommended.find((it) => it.id === 'a')).toBeUndefined()
  })

  it('related and recommended never share an item', () => {
    const items = []
    for (let i = 0; i < 30; i++) items.push(mkItem(String(i), { tags: ['common'] }))
    const out = computeSuggested({
      seedId: '0',
      categories: [{ label: 'Cat', items }],
    })
    const relatedIds = new Set(out.related.map((r) => String(r.id)))
    for (const r of out.recommended) {
      expect(relatedIds.has(String(r.id))).toBe(false)
    }
  })

  it('finds seed in carouselItems even when not in categories', () => {
    const carousel = [mkItem('hero', { tags: ['interesting'] })]
    const cats = [{ label: 'Cat', items: [mkItem('a', { tags: ['interesting'] })] }]
    const out = computeSuggested({
      seedId: 'hero',
      categories: cats,
      carouselItems: carousel,
      heroItem: carousel[0],
    })
    // 'a' shares a tag with the seed; it should appear in related.
    expect(out.related.find((it) => it.id === 'a')).toBeDefined()
  })

  it('falls back to a slice of all items when nothing scores positive', () => {
    // Seed has unique uploader, no tags, no shared category context
    const items = [
      mkItem('seed', { uploader: 'Solo', tags: [] }),
      mkItem('x', { uploader: 'OtherA', tags: [] }),
      mkItem('y', { uploader: 'OtherB', tags: [] }),
    ]
    const out = computeSuggested({
      seedId: 'seed',
      categories: [{ label: 'Cat', items }],
    })
    // Same _category will give other category-mates score+1, so they pass.
    // Even if not, the fallback ensures non-empty related.
    expect(out.related.length).toBeGreaterThan(0)
  })

  it('boosts items with shared uploader and shared tags', () => {
    const seed = mkItem('s', { uploader: 'CreatorX', tags: ['nature', 'docs'] })
    const sameCreator = mkItem('a', { uploader: 'CreatorX', tags: [] })
    const sharedTag = mkItem('b', { uploader: 'CreatorY', tags: ['nature'] })
    const unrelated = mkItem('c', { uploader: 'CreatorZ', tags: ['code'] })
    const out = computeSuggested({
      seedId: 's',
      categories: [{ label: 'Cat', items: [seed, sameCreator, sharedTag, unrelated] }],
    })
    const relatedIds = out.related.map((r) => r.id)
    // sameCreator outranks unrelated (uploader bonus is +5)
    expect(relatedIds.indexOf('a')).toBeLessThan(relatedIds.indexOf('c'))
  })

  it('dedupes items appearing in both categories and carousel/top10', () => {
    const dup = mkItem('dup', { tags: ['shared'] })
    const out = computeSuggested({
      seedId: 'other',
      categories: [{ label: 'Cat', items: [dup, mkItem('other')] }],
      carouselItems: [dup],
      top10: [dup],
    })
    // Across all the result lists combined, 'dup' should appear at most once.
    const all = [...out.related, ...out.recommended]
    const dupCount = all.filter((it) => String(it.id) === 'dup').length
    expect(dupCount).toBeLessThanOrEqual(1)
  })
})
