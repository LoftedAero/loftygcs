import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import StickDiagram from './StickDiagram'

afterEach(cleanup)

const knobs = () =>
  [...document.querySelectorAll<SVGGElement>('.stick-diagram__knob')].map((k) => k.style.transform)

describe('the stick diagram', () => {
  it('rests with the throttle down, not centered -- a throttle has no spring', () => {
    render(<StickDiagram active={null} />)
    const [left, right] = knobs()
    // Mode 2: the left stick's vertical is the throttle, and down is +y.
    expect(left).toMatch(/translate\(0px, [1-9]\d*px\)/)
    expect(right).toBe('translate(0px, 0px)')
  })

  it('pushes the throttle up when the throttle is asked for', () => {
    render(<StickDiagram active="throttle" />)
    expect(knobs()[0]).toMatch(/translate\(0px, -[1-9]\d*px\)/)
  })
})
