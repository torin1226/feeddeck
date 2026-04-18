import useHomeStore from '../../stores/homeStore'
import GalleryRow from './GalleryRow'
import PosterPeekRow from './PosterPeekRow'

// ============================================================
// GalleryShelf
// Renders the first 2 homepage categories as GalleryRows.
// Shows a peek strip of the 3rd category below to tease more.
// ============================================================

export default function GalleryShelf() {
  const categories = useHomeStore((s) => s.categories)

  if (!categories || categories.length === 0) return null

  const shelfCategories = categories.slice(0, 2)
  // Peek row shows thumbnails from the next unrendered category
  const peekCategory = categories[2] ?? null

  return (
    <div>
      {shelfCategories.map((cat) => (
        <GalleryRow
          key={cat.label}
          items={cat.items}
          label={cat.label}
        />
      ))}
      {peekCategory && (
        <PosterPeekRow
          category={peekCategory}
          onActivate={null}
        />
      )}
    </div>
  )
}
