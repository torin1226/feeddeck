import { useMemo, useCallback } from 'react'
import useHomeStore from '../../stores/homeStore'
import GalleryRow from './GalleryRow'

// ============================================================
// GalleryShelf
// Flat-pool homepage carousel (5c.2b infinite hydration).
//   - Categories are merged into a single flat pool
//   - Divider markers inserted between categories
//   - Header label cross-fades based on focused item's category
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
        _pinned: !!cat._pinned,
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

  const pool = useMemo(
    () => buildPool(categories, loadedCategoryIndices),
    [categories, loadedCategoryIndices]
  )

  // Approach-end handler — load next category in the background. The
  // newly added items show up via store reactivity; if user scrolls into
  // them, the divider marker preserves visual continuity.
  const handleApproachEnd = useCallback(() => {
    const next = loadNextCategory()
    return next != null
  }, [loadNextCategory])

  if (!categories || categories.length === 0) return null
  if (pool.length === 0) return null

  return (
    <div>
      <GalleryRow
        items={pool}
        // Initial label — overridden dynamically by focused item's _catLabel
        label={pool[0]?._catLabel ?? ''}
        onApproachEnd={handleApproachEnd}
        surface="gallery-shelf"
      />
    </div>
  )
}
