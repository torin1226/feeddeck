import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import WhyThisCardTooltip from '../components/home/WhyThisCardTooltip'

describe('WhyThisCardTooltip', () => {
  it('renders the reason label', () => {
    render(<WhyThisCardTooltip reason={{ kind: 'creator', label: 'Because you watch Veritasium' }} />)
    expect(screen.getByText(/Because you watch Veritasium/)).toBeTruthy()
  })

  it('renders nothing when reason is null', () => {
    const { container } = render(<WhyThisCardTooltip reason={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when reason is undefined', () => {
    const { container } = render(<WhyThisCardTooltip />)
    expect(container.firstChild).toBeNull()
  })

  it('applies the creator tone class for creator kind', () => {
    const { container } = render(<WhyThisCardTooltip reason={{ kind: 'creator', label: 'x' }} />)
    expect(container.firstChild.className).toMatch(/text-accent/)
  })

  it('applies the subscription tone class for subscription kind', () => {
    const { container } = render(<WhyThisCardTooltip reason={{ kind: 'subscription', label: 'From your subs' }} />)
    expect(container.firstChild.className).toMatch(/emerald/)
  })
})
