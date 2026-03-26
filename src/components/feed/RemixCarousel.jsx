import { useRef, useEffect, memo } from 'react'

const RemixCard = memo(function RemixCard({ video, isFocused, onClick }) {
  return (
    <div
      onClick={onClick}
      className="relative flex-shrink-0 cursor-pointer select-none transition-all duration-200"
      style={{
        width: '200px',
        transform: isFocused ? 'scale(1.05)' : 'scale(0.95)',
        opacity: isFocused ? 1 : 0.7,
      }}
    >
      <div
        className="relative rounded-lg overflow-hidden"
        style={{
          aspectRatio: '16/9',
          border: isFocused ? '2px solid white' : '2px solid transparent'
        }}
      >
        <img
          src={video.thumbnail}
          alt={video.title}
          className="w-full h-full object-cover"
          draggable={false}
          loading="lazy"
        />
        {video.duration && (
          <div className="absolute bottom-1.5 right-1.5 bg-black/70 text-white text-xs px-1.5 py-0.5 rounded font-mono">
            {video.duration}
          </div>
        )}
      </div>
      <div
        className="mt-1.5 px-0.5 overflow-hidden transition-all duration-200"
        style={{ maxHeight: isFocused ? '40px' : '0px', opacity: isFocused ? 1 : 0 }}
      >
        <p className="text-white text-xs font-medium truncate">{video.title}</p>
        <p className="text-white/50 text-xs truncate">{video.creator}</p>
      </div>
    </div>
  )
})

function CarouselRow({ videos, focusedId, onFocus }) {
  const scrollRef = useRef(null)

  // Auto-scroll to keep focused card visible
  useEffect(() => {
    const idx = videos.findIndex(v => v.id === focusedId)
    if (idx < 0 || !scrollRef.current) return
    const cards = scrollRef.current.querySelectorAll('[data-remix-card]')
    if (cards[idx]) {
      cards[idx].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
    }
  }, [focusedId, videos])

  return (
    <div
      ref={scrollRef}
      className="flex items-center gap-3 px-8 overflow-x-auto"
      style={{ scrollbarWidth: 'none' }}
    >
      {videos.map(video => (
        <div key={video.id} data-remix-card>
          <RemixCard
            video={video}
            isFocused={focusedId === video.id}
            onClick={() => onFocus(video)}
          />
        </div>
      ))}
    </div>
  )
}

export default function RemixCarousel({ categories, activeCategoryIdx, setActiveCategoryIdx, focusedVideoId, onFocusVideo }) {
  const activeCategory = categories[activeCategoryIdx]
  if (!activeCategory) return null

  return (
    <div className="absolute left-0 right-0 bottom-0" style={{ height: '150px' }}>
      {/* Category tabs + row */}
      <div className="px-8 mb-3">
        <div className="flex items-center gap-4">
          {categories.map((cat, i) => (
            <button
              key={cat.id}
              onClick={() => {
                setActiveCategoryIdx(i)
                if (cat.videos[0]) onFocusVideo(cat.videos[0])
              }}
              className="text-xs font-semibold uppercase tracking-widest transition-colors"
              style={{ color: i === activeCategoryIdx ? 'white' : 'rgba(255,255,255,0.35)' }}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      <CarouselRow
        videos={activeCategory.videos}
        focusedId={focusedVideoId}
        onFocus={onFocusVideo}
      />
    </div>
  )
}
