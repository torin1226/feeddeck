import useHomeStore from '../../stores/homeStore'
import CategoryRow from './CategoryRow'
import ContinueWatchingRow from './ContinueWatchingRow'

// ============================================================
// CategoryRows
// Renders all category sections below the featured carousel.
// Continue Watching row appears first (if user has in-progress videos).
// ============================================================

export default function CategoryRows() {
  const { categories, theatreMode } = useHomeStore()

  return (
    <div
      className={`px-10 pb-20 transition-all duration-400 ease-out ${
        theatreMode ? 'opacity-0 pointer-events-none translate-y-5' : ''
      }`}
    >
      {/* Continue Watching — first row, only renders if there are in-progress videos */}
      <ContinueWatchingRow />

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
