// ============================================================
// Safe localStorage wrapper for Zustand persist
// Catches QuotaExceededError and logs a warning instead of
// crashing the store. Import and use as `storage: safeStorage`
// in persist options.
// ============================================================

export const safeStorage = {
  getItem: (name) => {
    try {
      return localStorage.getItem(name)
    } catch {
      return null
    }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value)
    } catch (err) {
      if (err?.name === 'QuotaExceededError') {
        console.warn(`[Storage] Quota exceeded writing ${name} (${(value?.length / 1024).toFixed(1)}KB). Data not persisted.`)
      } else {
        console.warn(`[Storage] Failed to write ${name}:`, err?.message)
      }
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name)
    } catch {}
  },
}
