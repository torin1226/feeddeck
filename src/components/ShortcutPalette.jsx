import { useEffect } from 'react'
import { SHORTCUTS, byScope } from '../shortcuts/registry'

const SCOPE_LABEL = {
  global: 'Global',
  home: 'Home',
  theatre: 'Theatre',
  feed: 'Feed',
}

export default function ShortcutPalette({ open, onClose }) {
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  const groups = byScope(SHORTCUTS)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      className="fixed inset-0 z-[1000] flex items-start justify-center pt-[12vh] bg-black/60 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="w-[min(720px,90vw)] rounded-2xl bg-surface border border-white/10 shadow-2xl p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline justify-between mb-6">
          <h2 className="text-xl font-semibold">Keyboard shortcuts</h2>
          <span className="text-xs text-white/40">Esc to close</span>
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-6">
          {Object.entries(groups).map(([scope, items]) => (
            <section key={scope}>
              <h3 className="text-[11px] uppercase tracking-wider text-white/50 mb-2">
                {SCOPE_LABEL[scope] || scope}
              </h3>
              <ul className="space-y-1.5">
                {items.map((s, i) => (
                  <li key={i} className="flex items-center justify-between text-sm gap-3">
                    <span className="text-white/80">{s.description}</span>
                    <span className="flex gap-1 flex-none">
                      {s.keys.map((k, j) => (
                        <kbd
                          key={j}
                          className="px-1.5 py-0.5 rounded bg-white/10 border border-white/15 text-[11px] font-mono text-white/90"
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
