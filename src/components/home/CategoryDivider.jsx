// ============================================================
// CategoryDivider
// Vertical pill divider between category sections in the
// poster carousel. Displays a rotated category label with a
// gradient line behind it. Navigation skips over these.
// ============================================================

export default function CategoryDivider({ label }) {
  return (
    <div
      style={{
        width: 32,
        height: '100%',
        flexShrink: 0,
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Gradient line */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '15%',
          bottom: '15%',
          width: 1,
          transform: 'translateX(-50%)',
          background: 'linear-gradient(to bottom, transparent, var(--glass-border), transparent)',
        }}
      />

      {/* Vertical label */}
      <span
        style={{
          writingMode: 'vertical-lr',
          transform: 'rotate(180deg)',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 2,
          textTransform: 'uppercase',
          color: 'var(--color-text-muted)',
          opacity: 0.3,
          fontFamily: 'var(--font-display, "Space Grotesk", system-ui, sans-serif)',
          position: 'relative',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
    </div>
  )
}
