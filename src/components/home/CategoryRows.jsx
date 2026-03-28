import useHomeStore from '../../stores/homeStore'
import CategoryRow from './CategoryRow'

// ============================================================
// CategoryRows
// Renders all category sections below the featured carousel.
// ============================================================

export default function CategoryRows() {
  const categories = useHomeStore(s => s.categories)
  const theatreMode = useHomeStore(s => s.theatreMode)

  return (
    <div
      className={`px-10 pb-20 transition-all duration-400 ease-out ${
        theatreMode ? 'opacity-0 pointer-events-none translate-y-5' : ''
      }`}
    >
      {categories.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <span className="text-4xl mb-3 opacity-40">&#128250;</span>
          <p className="text-sm text-text-muted">No categories loaded yet. Content will appear once videos are fetched.</p>
        </div>
      ) : (
        categories.map((cat) => (
          <CategoryRow key={cat.label} category={cat} />
        ))
      )}
    </div>
  )
}
