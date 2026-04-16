import { useState, useCallback } from 'react'

// ============================================================
// KeywordOverridePanel (3.12 Step 2)
// Inline panel anchored below a row header. Up to 5 keyword
// inputs for manual row preference override. Glass material,
// max-height 160px, slides down from row header area.
// ============================================================

export default function KeywordOverridePanel({ surfaceKey, onApply, onClose }) {
  const [keywords, setKeywords] = useState([''])
  const [saving, setSaving] = useState(false)

  const handleAdd = useCallback(() => {
    if (keywords.length < 5) setKeywords(prev => [...prev, ''])
  }, [keywords.length])

  const handleChange = useCallback((index, value) => {
    setKeywords(prev => {
      const next = [...prev]
      next[index] = value
      return next
    })
  }, [])

  const handleRemove = useCallback((index) => {
    setKeywords(prev => prev.filter((_, i) => i !== index))
  }, [])

  const handleApply = useCallback(async () => {
    const validKeywords = keywords.map(k => k.trim()).filter(Boolean)
    if (validKeywords.length === 0) return

    setSaving(true)
    try {
      await fetch('/api/ratings/row-preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ surfaceKey, keywords: validKeywords }),
      })
      onApply?.(validKeywords)
    } catch (err) {
      console.warn('Row preferences failed:', err.message)
    }
    setSaving(false)
  }, [keywords, surfaceKey, onApply])

  return (
    <div
      className="mx-10 mb-4 rounded-xl border border-white/10 overflow-hidden animate-[slideDown_250ms_ease-out]"
      style={{
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        maxHeight: '160px',
      }}
    >
      <div className="px-4 py-3 flex items-start gap-3">
        <div className="flex-1">
          <p className="text-xs text-white/50 font-medium mb-2">
            Tell us what you want in this row (up to 5 keywords)
          </p>
          <div className="flex flex-wrap gap-2">
            {keywords.map((kw, i) => (
              <div key={i} className="flex items-center gap-1">
                <input
                  type="text"
                  value={kw}
                  onChange={(e) => handleChange(i, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleApply()
                    if (e.key === 'Escape') onClose?.()
                  }}
                  placeholder={`keyword ${i + 1}`}
                  className="bg-white/10 border border-white/10 rounded-lg px-2.5 py-1 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-accent/50 w-28"
                  autoFocus={i === keywords.length - 1}
                />
                {keywords.length > 1 && (
                  <button
                    onClick={() => handleRemove(i)}
                    className="text-white/30 hover:text-white/60 text-sm px-1"
                    aria-label="Remove keyword"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            {keywords.length < 5 && (
              <button
                onClick={handleAdd}
                className="text-xs text-accent/70 hover:text-accent font-medium px-2 py-1"
              >
                + Add
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0 pt-5">
          <button
            onClick={handleApply}
            disabled={saving || keywords.every(k => !k.trim())}
            className="px-3 py-1.5 rounded-lg bg-accent/20 text-accent text-xs font-semibold hover:bg-accent/30 disabled:opacity-40 transition-colors"
          >
            {saving ? 'Saving...' : 'Apply'}
          </button>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-white/40 text-xs font-medium hover:text-white/60 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
