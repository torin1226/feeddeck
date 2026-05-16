// Single source of truth for every keyboard shortcut in the app.
// The ShortcutPalette renders this list; the actual key handlers live in
// useKeyboard.js, the theatre handler in HeroSection.jsx, and feed gestures
// in useFeedGestures.js. Keep this in sync when adding or changing a binding.

export const SHORTCUTS = [
  { scope: 'global', keys: ['Esc'], description: 'Panic — switch to SFW mode' },
  { scope: 'global', keys: ['?'], description: 'Open this shortcuts palette' },
  { scope: 'global', keys: ['Cmd', 'K'], description: 'Open shortcuts palette' },
  { scope: 'global', keys: ['N'], description: 'Skip to next in queue' },
  { scope: 'global', keys: ['Ctrl', 'M'], description: 'Toggle mobile preview' },
  { scope: 'home', keys: ['←', '→'], description: 'Move focus across a row' },
  { scope: 'home', keys: ['Enter'], description: 'Open the focused card' },
  { scope: 'theatre', keys: ['Space'], description: 'Play / pause' },
  { scope: 'theatre', keys: ['←', '→'], description: 'Seek ±5s' },
  { scope: 'theatre', keys: ['↑', '↓'], description: 'Volume ±10%' },
  { scope: 'theatre', keys: ['F'], description: 'Toggle fullscreen' },
  { scope: 'theatre', keys: ['M'], description: 'Toggle mute' },
  { scope: 'feed', keys: ['Swipe →'], description: 'Next video' },
  { scope: 'feed', keys: ['Swipe ←'], description: 'Previous video' },
  { scope: 'feed', keys: ['Double-tap'], description: 'Like' },
]

export function byScope(list) {
  return list.reduce((acc, s) => {
    acc[s.scope] = acc[s.scope] || []
    acc[s.scope].push(s)
    return acc
  }, {})
}
