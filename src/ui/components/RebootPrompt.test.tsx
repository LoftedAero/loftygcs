import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import RebootPrompt, { useRebootReminder } from './RebootPrompt'
import { CardHeadExtra, LaCard } from './La'
import { useWriteFeedbackStore } from '../../stores/write-feedback-store'

// One dialog for the whole app, and after Later a reminder on the card whose
// change needs the restart.

afterEach(() => {
  cleanup()
  useWriteFeedbackStore.setState({
    rebootPending: null,
    rebootSource: null,
    rebootDeferred: false,
  } as never)
})

describe('the restart prompt', () => {
  it('is a dialog from the shell, and nothing on a card, until Later', () => {
    useWriteFeedbackStore.getState().needReboot('OSD_TYPE takes effect after a restart')
    render(
      <>
        <RebootPrompt />
        <RebootPrompt inline />
        <RebootPrompt inline />
      </>,
    )
    expect(screen.getAllByText('OSD_TYPE takes effect after a restart')).toHaveLength(1)
    expect(screen.queryByText('Reboot required')).toBeNull()
  })

  it('is a reminder on each card, and no dialog, after Later', () => {
    useWriteFeedbackStore.getState().needReboot('OSD_TYPE takes effect after a restart')
    useWriteFeedbackStore.getState().deferReboot()
    render(
      <>
        <RebootPrompt />
        <RebootPrompt inline />
      </>,
    )
    expect(screen.queryByRole('button', { name: 'Later' })).toBeNull()
    expect(screen.getAllByText('Reboot required')).toHaveLength(1)
  })

  it('after Later, is on the card that made the change and no other', () => {
    // A servo function written from the outputs table once put the reminder
    // on the neighboring card that had a Write button.
    useWriteFeedbackStore
      .getState()
      .needReboot('SERVO1_FUNCTION takes effect after a restart', 'Servo outputs')
    useWriteFeedbackStore.getState().deferReboot()
    render(
      <CardHeadExtra.Provider value={useRebootReminder}>
        <LaCard title="Servo outputs" />
        <LaCard title="Output options" actions={<span>Write</span>} />
      </CardHeadExtra.Provider>,
    )
    const reminders = screen.getAllByText('Reboot required')
    expect(reminders).toHaveLength(1)
    expect(reminders[0]!.closest('.la-card')!.textContent).toContain('Servo outputs')
  })
})
