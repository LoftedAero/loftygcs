import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import SlideConfirm from './SlideConfirm'

// jsdom has no PointerEvent, so events would arrive without a pointer id or
// button and every drag would be ignored.
class TestPointerEvent extends MouseEvent {
  pointerId: number
  isPrimary: boolean
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init)
    this.pointerId = init.pointerId ?? 1
    this.isPrimary = init.isPrimary ?? true
  }
}
globalThis.PointerEvent ??= TestPointerEvent as unknown as typeof PointerEvent

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('SlideConfirm', () => {
  it('confirms only once the knob reaches the end', () => {
    const onConfirm = vi.fn()
    render(<SlideConfirm label="Slide to arm" onConfirm={onConfirm} onCancel={() => {}} />)
    const knob = screen.getByRole('slider', { name: 'Slide to arm' })
    fireEvent.keyDown(knob, { key: 'ArrowRight' })
    fireEvent.keyDown(knob, { key: 'ArrowRight' })
    expect(onConfirm).not.toHaveBeenCalled()
    fireEvent.keyDown(knob, { key: 'End' })
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('does not confirm on a tap', () => {
    const onConfirm = vi.fn()
    render(<SlideConfirm label="Slide to arm" onConfirm={onConfirm} onCancel={() => {}} />)
    const knob = screen.getByRole('slider')
    fireEvent.pointerDown(knob, { clientX: 10 })
    fireEvent.pointerUp(window, { clientX: 10 })
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('withdraws by itself when left unanswered', () => {
    vi.useFakeTimers()
    const onCancel = vi.fn()
    render(<SlideConfirm label="Slide to arm" onConfirm={() => {}} onCancel={onCancel} />)
    vi.advanceTimersByTime(10000)
    expect(onCancel).toHaveBeenCalled()
  })

  it('cancels on Escape', () => {
    const onCancel = vi.fn()
    render(<SlideConfirm label="Slide to arm" onConfirm={() => {}} onCancel={onCancel} />)
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
  })

  // jsdom lays nothing out, so the track is one pixel long: any drag to the
  // right reaches the end.
  const down = (el: Element, id = 1, x = 0) =>
    fireEvent.pointerDown(el, { pointerId: id, clientX: x, button: 0, isPrimary: true })
  const moveTo = (id: number, x: number) =>
    fireEvent.pointerMove(window, { pointerId: id, clientX: x })
  const upAt = (id: number) => fireEvent.pointerUp(window, { pointerId: id })

  it('confirms when dragged to the end and released', () => {
    const onConfirm = vi.fn()
    render(<SlideConfirm label="Slide to arm" onConfirm={onConfirm} onCancel={() => {}} />)
    down(screen.getByRole('slider'))
    moveTo(1, 50)
    upAt(1)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('never confirms after it has been withdrawn mid-drag', () => {
    const onConfirm = vi.fn()
    const { unmount } = render(
      <SlideConfirm label="Slide to arm" onConfirm={onConfirm} onCancel={() => {}} />,
    )
    down(screen.getByRole('slider'))
    moveTo(1, 50)
    unmount()
    upAt(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('ignores a second finger', () => {
    const onConfirm = vi.fn()
    render(<SlideConfirm label="Slide to arm" onConfirm={onConfirm} onCancel={() => {}} />)
    down(screen.getByRole('slider'), 1, 0)
    moveTo(2, 50)
    upAt(2)
    expect(onConfirm).not.toHaveBeenCalled()
    upAt(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('does not confirm when the system cancels the touch', () => {
    const onConfirm = vi.fn()
    render(<SlideConfirm label="Slide to arm" onConfirm={onConfirm} onCancel={() => {}} />)
    down(screen.getByRole('slider'))
    moveTo(1, 50)
    fireEvent.pointerCancel(window, { pointerId: 1 })
    upAt(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('waits while a finger is on the knob', () => {
    vi.useFakeTimers()
    const onCancel = vi.fn()
    render(<SlideConfirm label="Slide to arm" onConfirm={() => {}} onCancel={onCancel} />)
    down(screen.getByRole('slider'))
    vi.advanceTimersByTime(15000)
    expect(onCancel).not.toHaveBeenCalled()
  })
})
