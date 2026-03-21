// Migrate old pv-* localStorage keys to fd-* (one-time on load)
// This module must be imported before any Zustand stores so they
// find data under the new fd-* keys when they initialize.
const migrations = [
  ['pv-mode', 'fd-mode'],
  ['pv-lib', 'fd-lib'],
  ['pv-queue', 'fd-queue'],
  ['pv-app', 'fd-app'],
  ['pv-content', 'fd-content'],
]

for (const [old, next] of migrations) {
  const val = localStorage.getItem(old)
  if (val !== null && localStorage.getItem(next) === null) {
    localStorage.setItem(next, val)
  }
  localStorage.removeItem(old)
}
