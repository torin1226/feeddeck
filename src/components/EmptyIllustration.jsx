// ============================================================
// EmptyIllustration
// Branded line-art SVGs for empty/error states. Replaces emoji
// glyphs with consistent stroke-based illustrations that match
// the Feather-style icons used elsewhere in the app.
//
// Strokes use currentColor so callers can tint via text color.
// The accent dot in each illustration uses the navy token for
// a small branded flourish.
// ============================================================

const SHARED_PROPS = {
  width: '100%',
  height: '100%',
  viewBox: '0 0 80 80',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

const ACCENT = 'var(--color-accent, #1e3a8a)'

function Library() {
  return (
    <svg {...SHARED_PROPS} aria-hidden="true">
      <rect x="14" y="22" width="40" height="28" rx="3" transform="rotate(-6 34 36)" opacity="0.45" />
      <rect x="20" y="20" width="40" height="28" rx="3" opacity="0.7" />
      <rect x="26" y="26" width="40" height="28" rx="3" />
      <path d="M40 36l8 4-8 4z" fill="currentColor" stroke="none" opacity="0.8" />
      <circle cx="62" cy="22" r="2" fill={ACCENT} stroke="none" />
    </svg>
  )
}

function Liked() {
  return (
    <svg {...SHARED_PROPS} aria-hidden="true">
      <path d="M22 38h6v22h-6a2 2 0 0 1-2-2V40a2 2 0 0 1 2-2z" />
      <path d="M28 38l8-14a4 4 0 0 1 4-2 4 4 0 0 1 4 4v8h10a4 4 0 0 1 4 5l-3 14a4 4 0 0 1-4 3H28" />
      <circle cx="58" cy="22" r="1.6" fill={ACCENT} stroke="none" />
      <path d="M52 18l1.5 3M64 28l-1.5-3" stroke={ACCENT} opacity="0.7" />
    </svg>
  )
}

function Favorites() {
  return (
    <svg {...SHARED_PROPS} aria-hidden="true">
      <path d="M40 60s-18-10-18-24a10 10 0 0 1 18-6 10 10 0 0 1 18 6c0 14-18 24-18 24z" />
      <circle cx="60" cy="20" r="1.6" fill={ACCENT} stroke="none" />
      <path d="M58 14l1 3M64 22l-3-1" stroke={ACCENT} opacity="0.7" />
    </svg>
  )
}

function History() {
  return (
    <svg {...SHARED_PROPS} aria-hidden="true">
      <circle cx="40" cy="42" r="20" />
      <path d="M40 30v12l8 4" />
      <path d="M22 18a26 26 0 0 1 8-4M58 18a26 26 0 0 0-8-4" opacity="0.5" />
      <circle cx="40" cy="14" r="1.8" fill={ACCENT} stroke="none" />
    </svg>
  )
}

function WatchLater() {
  return (
    <svg {...SHARED_PROPS} aria-hidden="true">
      <path d="M26 18h28v44l-14-10-14 10z" />
      <path d="M40 30v10M40 44v0.5" opacity="0.6" />
      <circle cx="58" cy="20" r="1.6" fill={ACCENT} stroke="none" />
    </svg>
  )
}

function Rated() {
  return (
    <svg {...SHARED_PROPS} aria-hidden="true">
      <path d="M40 18l6.5 13.5L61 33.5l-10.5 9.5L53 58l-13-7-13 7 2.5-15-10.5-9.5 14.5-2z" />
      <path d="M16 22l3 1M64 22l-3 1M40 10v3" opacity="0.5" />
      <circle cx="60" cy="14" r="1.6" fill={ACCENT} stroke="none" />
    </svg>
  )
}

function Search() {
  return (
    <svg {...SHARED_PROPS} aria-hidden="true">
      <circle cx="34" cy="34" r="16" />
      <path d="M46 46l14 14" />
      <path d="M28 34h12M34 28v12" opacity="0.4" />
      <circle cx="60" cy="20" r="1.6" fill={ACCENT} stroke="none" />
    </svg>
  )
}

function Feed() {
  return (
    <svg {...SHARED_PROPS} aria-hidden="true">
      <circle cx="40" cy="46" r="3" />
      <path d="M40 49v12" />
      <path d="M30 36a14 14 0 0 1 20 0" />
      <path d="M22 28a26 26 0 0 1 36 0" opacity="0.7" />
      <path d="M14 20a38 38 0 0 1 52 0" opacity="0.4" />
      <circle cx="40" cy="46" r="1.6" fill={ACCENT} stroke="none" />
    </svg>
  )
}

function Sources() {
  return (
    <svg {...SHARED_PROPS} aria-hidden="true">
      <circle cx="40" cy="40" r="6" />
      <path d="M40 18v8M40 54v8M18 40h8M54 40h8M24 24l6 6M50 50l6 6M56 24l-6 6M30 50l-6 6" />
      <circle cx="62" cy="18" r="1.6" fill={ACCENT} stroke="none" />
    </svg>
  )
}

function AllCaughtUp() {
  return (
    <svg {...SHARED_PROPS} aria-hidden="true">
      <circle cx="40" cy="40" r="20" />
      <path d="M30 40l7 7 13-15" />
      <circle cx="62" cy="20" r="1.4" fill={ACCENT} stroke="none" />
      <circle cx="20" cy="22" r="1" fill={ACCENT} stroke="none" opacity="0.6" />
      <circle cx="64" cy="58" r="1" fill={ACCENT} stroke="none" opacity="0.6" />
    </svg>
  )
}

function Error() {
  return (
    <svg {...SHARED_PROPS} aria-hidden="true">
      <path d="M40 14l28 48H12z" />
      <path d="M40 32v14" />
      <circle cx="40" cy="54" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

const VARIANTS = {
  library: Library,
  liked: Liked,
  favorites: Favorites,
  history: History,
  watchLater: WatchLater,
  rated: Rated,
  search: Search,
  feed: Feed,
  sources: Sources,
  allCaughtUp: AllCaughtUp,
  error: Error,
}

export default function EmptyIllustration({ variant = 'library', className = 'w-20 h-20', ...rest }) {
  const Component = VARIANTS[variant] || Library
  return (
    <div className={className} role="img" {...rest}>
      <Component />
    </div>
  )
}
