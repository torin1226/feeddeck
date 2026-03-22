import { useRef, useEffect } from 'react'
import useHomeStore from '../../stores/homeStore'
import useFeaturedScroll from '../../hooks/useFeaturedScroll'

// ============================================================
// FeaturedSection
// Scroll-driven 5-phase animation. A 350vh scroll zone with a
// sticky 100vh container. Cards at fixed base size, animated
// with transform: scale() only. See spec for phase details.
// ============================================================

export default function FeaturedSection() {
  const { featuredItems, featuredIndex, setFeaturedIndex, advanceFeatured } = useHomeStore()

  const zoneRef = useRef(null)
  const stickyRef = useRef(null)
  const cardsRef = useRef([])
  const headerRef = useRef(null)
  const arrowLRef = useRef(null)
  const arrowRRef = useRef(null)
  const dotsRef = useRef(null)
  const progressRef = useRef(null)
  const progressBarRef = useRef(null)
  const overlayRef = useRef(null)

  // Chrome refs object for the scroll hook (includes progressBar)
  const chromeRef = useRef(null)
  useEffect(() => {
    chromeRef.current = {
      header: headerRef.current,
      arrowL: arrowLRef.current,
      arrowR: arrowRRef.current,
      dots: dotsRef.current,
      progress: progressRef.current,
      progressBar: progressBarRef.current,
    }
  })

  const videoElRef = useRef(null)

  const { isInteractive, setVideoRef } = useFeaturedScroll({
    zoneRef,
    stickyRef,
    cardsRef,
    chromeRef,
    overlayRef,
    activeIndex: featuredIndex,
    totalCards: featuredItems.length,
    onPhase4Enter: () => {},
    onPhase4Leave: () => {},
    advanceFeatured,
    setFeaturedIndex,
  })

  // Wire video ref to hook
  useEffect(() => {
    setVideoRef(videoElRef.current)
  })

  // Resolve stream URL for the active featured item's preview video
  useEffect(() => {
    const item = featuredItems[featuredIndex]
    const vid = videoElRef.current
    if (!vid || !item?.url) return

    let cancelled = false
    vid.pause()
    vid.style.opacity = '0'

    fetch(`/api/stream-url?url=${encodeURIComponent(item.url)}`)
      .then(r => r.json())
      .then(data => {
        if (!cancelled && data.streamUrl && videoElRef.current) {
          const v = videoElRef.current
          v.src = data.streamUrl
          v.load()
          v.oncanplay = () => {
            if (!cancelled) v.play().catch(() => {})
          }
        }
      })
      .catch(() => {})

    return () => {
      cancelled = true
      if (vid) vid.oncanplay = null
    }
  }, [featuredIndex, featuredItems])

  // Nav handlers
  function goTo(idx) {
    setFeaturedIndex(idx)
  }

  const navPrev = () => { if (featuredIndex > 0) goTo(featuredIndex - 1) }
  const navNext = () => { if (featuredIndex < featuredItems.length - 1) goTo(featuredIndex + 1) }

  if (featuredItems.length === 0) return null

  return (
    <div ref={zoneRef} className="relative" style={{ height: '550vh' }}>
      <div
        ref={stickyRef}
        className="sticky top-0 h-screen w-full flex flex-col items-center justify-center overflow-hidden bg-surface"
      >
        {/* Header — hidden until Phase 3+ */}
        <div
          ref={headerRef}
          className="absolute top-[18px] left-0 right-0 px-10 flex items-baseline justify-between z-40 opacity-0 pointer-events-none"
        >
          <div>
            <span className="text-[22px] font-bold tracking-tight">Featured</span>
            <span className="text-xs text-text-muted font-normal ml-2.5">Handpicked for you</span>
          </div>
          <span className="text-[11px] font-semibold text-accent uppercase tracking-wider cursor-pointer opacity-75 hover:opacity-100 transition-opacity">
            See all &rarr;
          </span>
        </div>

        {/* Cards container */}
        <div className="relative w-full h-full flex items-center justify-center">
          {featuredItems.map((item, i) => (
            <FeaturedCard
              key={item.id}
              item={item}
              index={i}
              cardRef={(el) => (cardsRef.current[i] = el)}
              overlayRef={i === featuredIndex ? overlayRef : null}
              videoRef={i === featuredIndex ? videoElRef : null}
              isActive={i === featuredIndex}
              onClick={() => {
                if (isInteractive() && i !== featuredIndex) goTo(i)
              }}
            />
          ))}
        </div>

        {/* Left arrow */}
        <button
          ref={arrowLRef}
          onClick={navPrev}
          className="absolute left-5 top-1/2 -translate-y-1/2 z-30 w-11 h-11 rounded-full
            bg-[rgba(20,20,22,0.85)] border border-white/[0.12] text-white text-xl
            flex items-center justify-center cursor-pointer backdrop-blur-lg
            hover:bg-[rgba(40,40,44,0.95)] hover:scale-105 transition-all opacity-0 pointer-events-none"
        >
          &lsaquo;
        </button>

        {/* Right arrow */}
        <button
          ref={arrowRRef}
          onClick={navNext}
          className="absolute right-5 top-1/2 -translate-y-1/2 z-30 w-11 h-11 rounded-full
            bg-[rgba(20,20,22,0.85)] border border-white/[0.12] text-white text-xl
            flex items-center justify-center cursor-pointer backdrop-blur-lg
            hover:bg-[rgba(40,40,44,0.95)] hover:scale-105 transition-all opacity-0 pointer-events-none"
        >
          &rsaquo;
        </button>

        {/* Dots */}
        <div
          ref={dotsRef}
          className="flex justify-center gap-1.5 mt-[18px] opacity-0 pointer-events-none"
        >
          {featuredItems.map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              className={`h-[5px] rounded-full cursor-pointer transition-all duration-300 ${
                i === featuredIndex
                  ? 'w-[18px] bg-text-primary'
                  : 'w-[5px] bg-text-muted'
              }`}
            />
          ))}
        </div>

        {/* Progress bar */}
        <div
          ref={progressRef}
          className="h-0.5 bg-white/[0.08] rounded-sm mx-10 mt-2.5 overflow-hidden w-[calc(100%-80px)] opacity-0"
        >
          <div
            ref={progressBarRef}
            className="h-full w-0 bg-white/30 rounded-sm"
          />
        </div>
      </div>
    </div>
  )
}

// -------------------------------------------------------
// Single featured card
// Rendered at fixed base size (62vw × 380px), centered.
// All position/scale changes happen via transform only.
// -------------------------------------------------------
function FeaturedCard({ item, index, cardRef, overlayRef, videoRef, isActive, onClick }) {
  return (
    <div
      ref={cardRef}
      onClick={onClick}
      data-fc-index={index}
      className="absolute cursor-pointer overflow-hidden"
      style={{
        width: '62vw',
        height: '380px',
        left: '50%',
        top: '50%',
        marginLeft: '-31vw',
        marginTop: '-190px',
        borderRadius: '0px',
        willChange: 'transform, opacity',
        backfaceVisibility: 'hidden',
      }}
    >
      {/* Video preview for active card */}
      {videoRef && (
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover z-[0] opacity-0 transition-opacity duration-300"
          muted
          playsInline
          loop
          preload="none"
          onPlaying={(e) => { e.target.style.opacity = '1' }}
          onPause={(e) => { e.target.style.opacity = '0' }}
        />
      )}

      {/* Image */}
      <div className="absolute inset-0 overflow-hidden">
        <img
          src={item.thumbnail}
          alt={item.title}
          className="w-full h-[115%] object-cover block"
          draggable="false"
        />
      </div>

      {/* Dim overlay for non-active cards */}
      <div
        className="absolute inset-0 z-[1] rounded-2xl transition-opacity duration-500"
        style={{
          background: 'var(--color-gradient-mid)',
          opacity: isActive ? 0 : 1,
        }}
      />

      {/* Gradient for active card */}
      <div
        className="absolute inset-0 z-[2] transition-opacity duration-400"
        style={{
          background: 'linear-gradient(to top, var(--color-gradient-solid) 0%, var(--color-gradient-light) 50%, transparent 100%)',
          opacity: isActive ? 1 : 0,
        }}
      />

      {/* Body content — overlay controlled by scroll hook via overlayRef */}
      <div
        ref={overlayRef}
        className="absolute bottom-0 left-0 right-0 p-6 z-[3] opacity-0 pointer-events-none"
      >
        <div className="text-[10px] font-bold uppercase tracking-[1.4px] text-accent mb-1.5">
          {item.featuredLabel}
        </div>
        <div className="text-[22px] font-bold tracking-tight leading-tight mb-1.5">
          {item.title}
        </div>
        <div className="text-[13px] text-text-secondary mb-4">
          {item.featuredTagline}
        </div>
        <div className="flex items-center gap-2.5">
          <button className="inline-flex items-center gap-2 px-5 py-2.5 bg-text-primary text-surface rounded-full text-[13px] font-bold hover:opacity-90 hover:scale-[1.03] transition-all">
            &#9654; &nbsp;Stream now
          </button>
          <button className="w-9 h-9 rounded-full bg-white/10 border border-white/20 text-white text-lg flex items-center justify-center hover:bg-white/20 transition-colors">
            +
          </button>
        </div>
      </div>
    </div>
  )
}
