import useHomeStore from '../../stores/homeStore'
import GalleryRow from './GalleryRow'

// ============================================================
// GalleryShelf
// Replaces PosterShelf. Renders the first 2 homepage categories
// as individual GalleryRow components (one per category).
// ============================================================

export default function GalleryShelf() {
  const categories = useHomeStore((s) => s.categories)

  if (!categories || categories.length === 0) return null

  const shelfCategories = categories.slice(0, 2)

  return (
    <div>
      {shelfCategories.map((cat) => (
        <GalleryRow
          key={cat.label}
          items={cat.items}
          label={cat.label}
        />
      ))}
    </div>
  )
}
