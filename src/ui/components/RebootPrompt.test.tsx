import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import RebootPrompt from './RebootPrompt'
import { useWriteFeedbackStore } from '../../stores/write-feedback-store'

// One dialog for the whole app, and a reminder on each card after Later. Every
// card used to carry the whole prompt, which stacked three dialogs on a
// three-card screen and showed none on a screen without cards.

afterEach(() => {
  cleanup()
  useWriteFeedbackStore.setState({ rebootPending: null, rebootDeferred: false } as never)
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
})
