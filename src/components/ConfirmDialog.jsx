// TODO: Wire into SourceControlSheet.jsx for source hide/delete confirmation
import { useEffect } from 'react'
import useFocusTrap from '../hooks/useFocusTrap'

// ============================================================
// ConfirmDialog
// Minimal confirmation modal — supports destructive actions
// with red confirm button. Uses focus trap + Escape to close.
// ============================================================

export default function ConfirmDialog({
  open,
  title,
  message,
  onConfirm,
  onCancel,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
}) {
  const trapRef = useFocusTrap(open)

  useEffect(() => {
    if (!open) return
    const handleKey = (e) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-toast flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        ref={trapRef}
        className="bg-surface-raised border border-surface-border rounded-xl p-6 w-full max-w-sm mx-4 animate-fade-slide-in"
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <h2 className="text-lg font-semibold text-text-primary mb-2">{title}</h2>
        )}
        {message && (
          <p className="text-sm text-text-secondary mb-6">{message}</p>
        )}

        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm text-text-secondary bg-surface-overlay border border-surface-border
              hover:text-text-primary transition-colors active:scale-95"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors active:scale-95
              ${destructive
                ? 'bg-red-600 text-white hover:bg-red-500'
                : 'bg-accent text-white hover:bg-accent/90'
              }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
