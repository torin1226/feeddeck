import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import useHomeStore from '../stores/homeStore'
import Top10Row from '../components/home/Top10Row'

// ============================================================
// Top10Row markExposed parity (2026-05-13)
//
// HeroSection, HeroCarousel, and GalleryRow all wire their rendered
// items into homeStore.markExposed so /api/feed/next?excludeIds=
// can dedupe what the user already saw on the homepage. Top10Row
// shipped without this wire-in: top-ranked items could resurface
// in the feed even though they were on screen seconds before.
// Same "fix one file, not the pattern" shape the 2026-05-12
// content-filter fix called out — escalation: lock the contract.
// ============================================================

// jsdom doesn't provide these by default; Top10Row uses ResizeObserver to
// track scroll affordances and IntersectionObserver for stream prefetch.
if (typeof globalThis.IntersectionObserver === 'undefined') {
  globalThis.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}
// React 18 requires this global so act() doesn't warn under vitest/jsdom.
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const seedTop10 = (count, prefix = 'top10') =>
  Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`,
    rank: i + 1,
    title: `Item ${i + 1}`,
    url: `https://example.com/v/${prefix}-${i}`,
    thumbnail: '',
    views: '1.0M',
  }))

let container
let root

const mount = () => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(
      <MemoryRouter>
        <Top10Row />
      </MemoryRouter>
    )
  })
}

beforeEach(() => {
  useHomeStore.setState({ top10: [], exposedItemIds: new Set() })
  try { sessionStorage.removeItem('fd-exposed-ids') } catch { /* ignore */ }
})

afterEach(() => {
  if (root) act(() => root.unmount())
  if (container && container.parentNode) container.parentNode.removeChild(container)
  root = null
  container = null
})

describe('Top10Row markExposed wiring', () => {
  it('marks all rendered top10 items as exposed on mount', () => {
    useHomeStore.setState({ top10: seedTop10(10) })
    mount()
    const exposed = useHomeStore.getState().exposedItemIds
    expect(exposed.size).toBe(10)
    expect(exposed.has('top10-0')).toBe(true)
    expect(exposed.has('top10-9')).toBe(true)
  })

  it('marks nothing when top10 is empty', () => {
    mount()
    expect(useHomeStore.getState().exposedItemIds.size).toBe(0)
  })

  it('adds newly arrived items after a shuffle (idempotent for known ids)', () => {
    useHomeStore.setState({ top10: seedTop10(5) })
    mount()
    expect(useHomeStore.getState().exposedItemIds.size).toBe(5)

    // Shuffle replaces 3 of the 5 with new IDs.
    const next = [
      ...seedTop10(2),
      ...seedTop10(3, 'fresh'),
    ]
    act(() => {
      useHomeStore.setState({ top10: next })
    })
    const exposed = useHomeStore.getState().exposedItemIds
    expect(exposed.has('top10-0')).toBe(true)
    expect(exposed.has('fresh-0')).toBe(true)
    expect(exposed.has('fresh-2')).toBe(true)
    expect(exposed.size).toBe(5 + 3)
  })
})
