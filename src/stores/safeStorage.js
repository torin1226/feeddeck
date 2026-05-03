// ============================================================
// Safe localStorage wrapper for Zustand persist
// Catches QuotaExceededError and logs a warning instead of
// crashing the store. Fires a toast on quota exceeded so the
// user knows data isn't being saved.
// Import and use as `storage: safeStorage` in persist options.
// ============================================================

import useToastStore from './toastStore'

// Track whether we've shown a quota warning this session to avoid spam
let _quotaWarningShown = false

// Legacy corrupt sentinel: prior versions of this file passed safeStorage
// directly to Zustand persist without createJSONStorage wrapping, which
// caused setItem to receive a {state, version} object that localStorage
// coerced to the literal string "[object Object]". Detect and evict on
// read so upgraded users don't carry the broken entry forever.
const LEGACY_CORRUPT = '[object Object]'

export const safeStorage = {
  getItem: (name) => {
    try {
      const v = localStorage.getItem(name)
      if (v === LEGACY_CORRUPT) {
        try { localStorage.removeItem(name) } catch {}
        return null
      }
      return v
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
        if (!_quotaWarningShown) {
          _quotaWarningShown = true
          try { useToastStore.getState().showToast('Storage full — some data may not be saved', 'error') } catch {}
        }
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

// Returns approximate localStorage usage in bytes
export function getStorageUsage() {
  try {
    let total = 0
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      total += (key?.length || 0) + (localStorage.getItem(key)?.length || 0)
    }
    return total * 2 // UTF-16 = 2 bytes per char
  } catch {
    return 0
  }
}
