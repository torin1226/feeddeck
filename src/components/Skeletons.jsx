// ============================================================
// Skeleton Components
// Shimmer placeholders for loading states. No spinners.
// ============================================================

// Directional shimmer: sweeps L→R like Netflix/HBO loading states.
// Uses gradient animation instead of basic pulse for cinematic feel.
const shimmer = 'animate-shimmer rounded'
  + ' bg-[length:200%_100%]'
  + ' bg-gradient-to-r from-white/[0.04] via-white/[0.10] to-white/[0.04]'

export function SkeletonCard() {
  return (
    <div className="flex-none w-card">
      <div className={`${shimmer} w-full h-card-thumb rounded-card mb-2`} />
      <div className={`${shimmer} h-3 w-3/4 mb-1.5`} />
      <div className={`${shimmer} h-2.5 w-1/2`} />
    </div>
  )
}

export function SkeletonCategoryRow() {
  return (
    <div className="mb-9">
      <div className="flex items-center justify-between mb-3.5">
        <div className={`${shimmer} h-4 w-32`} />
        <div className={`${shimmer} h-3 w-16`} />
      </div>
      <div className="flex gap-2.5 overflow-hidden">
        {Array.from({ length: 6 }, (_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </div>
  )
}

export function SkeletonHero() {
  // Mirrors HeroSection: 100vh / min-h 600px, content block at bottom-[230px],
  // tags / title (clamp 28-48px) / meta / desc / action buttons at left-10.
  return (
    <div className="relative h-screen min-h-[600px] bg-surface">
      <div className={`absolute inset-0 ${shimmer} rounded-none`} />
      <div className="absolute left-10 bottom-[230px] max-w-[520px] z-content">
        <div className="flex gap-1.5 mb-3">
          <div className={`${shimmer} h-5 w-10`} />
          <div className={`${shimmer} h-5 w-20`} />
          <div className={`${shimmer} h-5 w-14`} />
        </div>
        <div className={`${shimmer} h-[clamp(28px,4vw,48px)] w-80 mb-2.5`} />
        <div className={`${shimmer} h-[13px] w-64 mb-5`} />
        <div className={`${shimmer} h-[14px] w-96 mb-5`} />
        <div className="flex gap-2.5 items-center">
          <div className={`${shimmer} h-10 w-24 rounded-lg`} />
          <div className={`${shimmer} h-10 w-28 rounded-lg`} />
          <div className={`${shimmer} w-[42px] h-[42px] rounded-full`} />
        </div>
      </div>
    </div>
  )
}

export function SkeletonGalleryShelf() {
  // Mirrors GalleryShelf: GalleryRow (left-aligned header + "See all" pill,
  // 50vh focus-scaled cards, windowed progress dots) + PosterPeekRow below.
  // Card widths track PosterCard.WIDTH (h: 420 default / 600 focused, v: 320 default).
  return (
    <div>
      {/* Row header — left-aligned, matches GalleryRow `px-10 mb-4 flex items-baseline justify-between` */}
      <div className="px-10 mb-4 flex items-baseline justify-between">
        <div className={`${shimmer} h-7 w-48`} />
        <div className={`${shimmer} h-3 w-16`} />
      </div>

      {/* Carousel container — 50vh card row with overflow hidden */}
      <div className="relative overflow-hidden">
        <div
          className="flex items-center gap-2.5"
          style={{ paddingLeft: '35vw', paddingRight: '35vw', paddingTop: '24px', paddingBottom: '24px' }}
        >
          {[
            { width: 320, opacity: 0.4 },
            { width: 420, opacity: 0.6 },
            { width: 600, opacity: 1 },
            { width: 420, opacity: 0.6 },
            { width: 320, opacity: 0.4 },
          ].map((card, i) => (
            <div
              key={i}
              className="rounded-card-lg bg-surface-raised animate-shimmer flex-shrink-0"
              style={{ width: `${card.width}px`, height: '50vh', opacity: card.opacity }}
            />
          ))}
        </div>
      </div>

      {/* Windowed progress dots — matches GalleryRow `mt-3 px-10`, 4px tall, 20px active */}
      <div className="flex justify-center items-center gap-1.5 mt-3 px-10">
        {Array.from({ length: 7 }, (_, i) => (
          <div
            key={i}
            className="h-[4px] rounded-full bg-surface-raised animate-shimmer"
            style={{ width: i === 3 ? '20px' : '4px' }}
          />
        ))}
      </div>

      {/* Peek-row placeholder — matches PosterPeekRow (16px/48px/20px padding, 72px thumb track) */}
      <div style={{ padding: '16px 48px 20px' }}>
        <div className={`${shimmer} h-2.5 w-32 mb-2.5`} />
        <div className="flex gap-3" style={{ height: '72px' }}>
          {Array.from({ length: 8 }, (_, i) => (
            <div
              key={i}
              className="rounded-[10px] bg-surface-raised animate-shimmer flex-shrink-0"
              style={{ width: '96px', height: '72px', opacity: 0.3 }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

export function SkeletonLibrary() {
  return (
    <div className="pt-14">
      {/* Title area */}
      <div className="px-10 pt-8 pb-2">
        <div className={`${shimmer} h-8 w-48 mb-2`} />
        <div className={`${shimmer} h-4 w-28`} />
      </div>

      {/* Tab bar */}
      <div className="px-10 pt-3 pb-1 border-b border-surface-border">
        <div className="flex gap-1">
          {[20, 24, 28, 24, 22].map((w, i) => (
            <div key={i} className={`${shimmer} h-8 rounded-full`} style={{ width: `${w * 4}px` }} />
          ))}
        </div>
      </div>

      {/* Continue Watching row */}
      <div className="px-10 pt-6 pb-2">
        <div className="flex items-center justify-between mb-3.5">
          <div className={`${shimmer} h-5 w-44`} />
          <div className={`${shimmer} h-3 w-16`} />
        </div>
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex-none w-card">
              <div className={`${shimmer} w-full h-[124px] rounded-[10px] mb-2`} />
              <div className={`${shimmer} h-3 w-3/4 mb-1.5`} />
              <div className={`${shimmer} h-2.5 w-1/3`} />
            </div>
          ))}
        </div>
      </div>

      {/* Video grid */}
      <div className="px-10 py-6">
        <div className="flex items-center justify-between mb-4">
          <div className={`${shimmer} h-4 w-16`} />
          <div className={`${shimmer} h-3 w-20`} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {Array.from({ length: 15 }, (_, i) => (
            <div key={i}>
              <div className={`${shimmer} aspect-video rounded-lg mb-2`} />
              <div className={`${shimmer} h-3.5 w-3/4 mb-1.5`} />
              <div className={`${shimmer} h-3 w-1/2`} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function SkeletonVideoGrid() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 p-6">
      {Array.from({ length: 10 }, (_, i) => (
        <div key={i}>
          <div className={`${shimmer} aspect-video rounded-lg mb-2`} />
          <div className={`${shimmer} h-3.5 w-3/4 mb-1.5`} />
          <div className={`${shimmer} h-3 w-1/2`} />
        </div>
      ))}
    </div>
  )
}
