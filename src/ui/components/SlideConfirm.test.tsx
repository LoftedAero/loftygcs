import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import SlideConfirm from './SlideConfirm'

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
})
