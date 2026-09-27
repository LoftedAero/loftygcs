import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import WriteFeedback from './WriteFeedback'
import { useWriteFeedbackStore } from '../../stores/write-feedback-store'

// Sensors has two write-as-you-go cards sharing one feedback slot; feedback
// must appear only in the card that made the change.

function TwoCards() {
  return (
    <>
      <div data-testid="accel">
        <WriteFeedback prefixes={['AHRS_']} />
      </div>
      <div data-testid="compass">
        <WriteFeedback prefixes={['COMPASS_']} />
      </div>
    </>
  )
}

beforeEach(() => useWriteFeedbackStore.getState().clear())
afterEach(cleanup)

describe('write feedback on a screen with more than one card', () => {
  it('answers in the card that owns the parameter, and nowhere else', () => {
    render(<TwoCards />)
    act(() => useWriteFeedbackStore.getState().report({ ok: true, param: 'AHRS_ORIENTATION' }))
    expect(within(screen.getByTestId('accel')).queryByText('Saved')).not.toBeNull()
    expect(within(screen.getByTestId('compass')).queryByText('Saved')).toBeNull()
  })

  it('keeps a failure with its own card too', () => {
    render(<TwoCards />)
    act(() =>
      useWriteFeedbackStore
        .getState()
        .report({ ok: false, param: 'COMPASS_PRIO1_ID/COMPASS_PRIO2_ID', error: 'timeout' }),
    )
    expect(within(screen.getByTestId('compass')).queryByText(/was not saved/)).not.toBeNull()
    expect(within(screen.getByTestId('accel')).queryByText(/was not saved/)).toBeNull()
  })

  it('answers for everything when it is not scoped', () => {
    render(<WriteFeedback />)
    act(() => useWriteFeedbackStore.getState().report({ ok: true, param: 'ANY_PARAM' }))
    expect(screen.queryByText('Saved')).not.toBeNull()
  })
})
