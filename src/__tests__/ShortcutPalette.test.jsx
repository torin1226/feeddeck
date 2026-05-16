import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ShortcutPalette from '../components/ShortcutPalette'
import { SHORTCUTS, byScope } from '../shortcuts/registry'

describe('shortcuts registry', () => {
  it('every shortcut has scope, keys, description', () => {
    for (const s of SHORTCUTS) {
      expect(s.scope).toBeTruthy()
      expect(Array.isArray(s.keys)).toBe(true)
      expect(s.keys.length).toBeGreaterThan(0)
      expect(s.description).toBeTruthy()
    }
  })

  it('byScope groups by scope key', () => {
    const grouped = byScope(SHORTCUTS)
    expect(grouped.global.length).toBeGreaterThan(0)
    expect(grouped.theatre.length).toBeGreaterThan(0)
  })
})

describe('ShortcutPalette', () => {
  it('renders the panel when open', () => {
    render(<ShortcutPalette open onClose={() => {}} />)
    expect(screen.getByText(/Keyboard shortcuts/i)).toBeTruthy()
    expect(screen.getByText(/Global/i)).toBeTruthy()
    expect(screen.getByText(/Theatre/i)).toBeTruthy()
  })

  it('renders nothing when closed', () => {
    const { container } = render(<ShortcutPalette open={false} onClose={() => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn()
    render(<ShortcutPalette open onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn()
    render(<ShortcutPalette open onClose={onClose} />)
    const dialog = screen.getByRole('dialog')
    fireEvent.click(dialog)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not call onClose when inner panel is clicked', () => {
    const onClose = vi.fn()
    render(<ShortcutPalette open onClose={onClose} />)
    // Click on the inner panel (the one with the heading)
    const heading = screen.getByText(/Keyboard shortcuts/i)
    fireEvent.click(heading)
    expect(onClose).not.toHaveBeenCalled()
  })
})
