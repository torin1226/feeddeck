import { useMemo, useCallback, useRef } from 'react'
import useHomeStore from '../../stores/homeStore'
import GalleryRow from './GalleryRow'
import PosterPeekRow from './PosterPeekRow'

// ============================================================
// GalleryShelf
// Flat-pool homepage carousel (5c.2b infinite hydration).
//   - Categories are merged into a single flat pool
//   - Divider markers inserted between categories
//   - Header label cross-fades based on focused item's category
//   - Peek-row click hydrates the next category
//   - Approaching end of pool auto-loads the next category
// ============================================================

function buildPool(categories, loadedCategoryIndices) {
  const pool = []
  loadedCategoryIndices.forEach((catIdx, n) => {
    const cat = categories[catIdx]
    if (!cat) return
    const catKey = cat.label
    if (n > 0) {
      pool.push({
        _isDivider: true,
        id: `__divider-${catIdx}`,
        label: cat.label,
        _cat: catIdx,
        _catLabel: cat.label,
        _catKey: catKey,
      })
    }
    for (const item of cat.items) {
      pool.push({
        ...item,
        _cat: catIdx,
        _catLabel: cat.label,
        _catKey: catKey,
      })
    }
  })
  return pool
}

export default function GalleryShelf() {
  const categories = useHomeStore((s) => s.categories)
  const loadedCategoryIndices = useHomeStore((s) => s.loadedCategoryIndices)
  const loadNextCategory = useHomeStore((s) => s.loadNextCategory)
  const loadCategoryAt = useHomeStore((s) => s.loadCategoryAt)

  const pool = useMemo(
    () => buildPool(categories, loadedCategoryIndices),
    [categories, loadedCategoryIndices]
  )

  // Pull next *unloaded* category for the peek row
  const peekCategory = useMemo(() => {
    if (!categories?.length) return null
    const loaded = new Set(loadedCategoryIndices)
    for (let i = 0; i < categories.length; i++) {
      if (!loaded.has(i)) return { ...categories[i], _index: i }
    }
    return null
  }, [categories, loadedCategoryIndices])

  // Imperative jump-to-id handle exposed by GalleryRow.
  const galleryJumpRef = useRef(null)

  // Approach-end handler — load next category in the background. The
  // newly added items show up via store reactivity; if user scrolls into
  // them, the divider marker preserves visual continuity.
  const handleApproachEnd = useCallback(() => {
    const next = loadNextCategory()
    return next != null
  }, [loadNextCategory])

  // Peek-row click — hydrate the target category and scroll to its first
  // item. We rely on GalleryRow's exposed jumpToId handle.
  const handlePeekActivate = useCallback(() => {
    if (!peekCategory) return
    loadCategoryAt(peekCategory._index)
    // Defer the scroll-jump until the new items are in the DOM.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const firstItem = peekCategory.items?.[0]
        if (firstItem?.id && galleryJumpRef.current) {
          galleryJumpRef.current(firstItem.id)
        }
      })
    })
  }, [peekCategory, loadCategoryAt])

  if (!categories || categories.length === 0) return null
  if (pool.length === 0) return null

  return (
    <div>
      <GalleryRow
        items={pool}
        // Initial label — overridden dynamically by focused item's _catLabel
        label={pool[0]?._catLabel ?? ''}
        onApproachEnd={handleApproachEnd}
        jumpRef={galleryJumpRef}
      />
      {peekCategory && (
        <PosterPeekRow
          category={peekCategory}
          onActivate={handlePeekActivate}
        />
      )}
    </div>
  )
}
