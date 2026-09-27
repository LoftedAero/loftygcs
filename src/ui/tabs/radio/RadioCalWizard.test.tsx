import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import RadioCalWizard from './RadioCalWizard'
import { useVehicleStore } from '../../../stores/vehicle-store'
import { useParamStore } from '../../../stores/param-store'
import { useWriteFeedbackStore } from '../../../stores/write-feedback-store'
import { connectionService } from '../../../services/connection'

// A whole calibration against a simulated transmitter: channel 1 roll, 2
// pitch (reversed: back is the lower pulse), 3 throttle, 4 yaw, 5 a switch.

const entry = (value: number) => ({ value, origValue: value, mavType: 9, dirty: false })

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useVehicleStore.setState({ rcChannels: [] } as never)
  useParamStore.setState({ entries: new Map() } as never)
  useWriteFeedbackStore.setState({ rebootPending: null, rebootDeferred: false } as never)
})

let sticks = [1500, 1500, 1000, 1500, 1000]
function move(changes: Record<number, number>) {
  sticks = sticks.slice()
  for (const [ch, v] of Object.entries(changes)) sticks[Number(ch) - 1] = v
  act(() => useVehicleStore.setState({ rcChannels: sticks } as never))
}
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))
const next = () => click('Next')

function start(rcmap: Record<string, number>) {
  sticks = [1500, 1500, 1000, 1500, 1000]
  useVehicleStore.setState({ rcChannels: sticks } as never)
  useParamStore.setState({
    entries: new Map(Object.entries(rcmap).map(([k, v]) => [k, entry(v)])),
  } as never)
  const onClose = vi.fn()
  const onSaved = vi.fn()
  render(<RadioCalWizard open onClose={onClose} onSaved={onSaved} />)
  click('Start')
  click('Sticks are centered')
  return { onClose, onSaved }
}

/** Every stick both ways, in the wizard's order. */
function walkSticks() {
  move({ 3: 2000 }) // throttle up, and it stays up for yaw
  next()
  move({ 4: 2000 }) // yaw right
  next()
  move({ 4: 1000 }) // yaw left
  next()
  move({ 4: 1500, 3: 1000 }) // throttle down
  next()
  move({ 1: 2000 }) // roll right
  next()
  move({ 1: 1000 }) // roll left
  next()
  move({ 1: 1500, 2: 1000 }) // pitch back: reversed
  next()
  move({ 2: 2000 }) // pitch forward
  next()
  move({ 2: 1500 })
}

describe('the radio calibration', () => {
  it('walks every stick both ways, sweeps the switch, writes, and hands back', async () => {
    const writes: [string, number][] = []
    vi.spyOn(connectionService, 'setParamNow').mockImplementation(async (p, v) => {
      writes.push([p, v])
      return v
    })
    // Roll and pitch swapped on the vehicle, so the mapping changes.
    const { onClose, onSaved } = start({
      RCMAP_ROLL: 2,
      RCMAP_PITCH: 1,
      RCMAP_THROTTLE: 3,
      RCMAP_YAW: 4,
    })
    walkSticks()
    expect(screen.getByText('Move each switch and dial through its range')).toBeTruthy()
    move({ 5: 2000 })
    move({ 5: 1000 })
    expect(screen.getByText('Channels swept: 1, 2, 3, 4, 5')).toBeTruthy()
    click('Next')

    // The results are the parameters Save will send, the switch's included,
    // each name with its value beside it.
    const params = [...document.querySelectorAll('.rc-review .la-field__param')].map(
      (e) => e.textContent,
    )
    expect(params).toEqual(
      expect.arrayContaining(['RCMAP_ROLL', 'RC2_REVERSED', 'RC5_MIN', 'RC5_MAX', 'RC5_TRIM']),
    )
    const row5 = [...document.querySelectorAll('.rc-review tbody tr')].find(
      (r) => r.firstElementChild?.textContent === '5',
    )
    expect(row5?.textContent).toContain('RC5_MIN1000')
    // The raw value as the parameter will hold it, not a word for it.
    expect(document.querySelector('.rc-review')?.textContent).toContain('RC2_REVERSED1')
    click('Save calibration')

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onSaved).toHaveBeenCalled()
    expect(Object.fromEntries(writes)).toMatchObject({
      RCMAP_ROLL: 1,
      RCMAP_PITCH: 2,
      RC2_REVERSED: 1,
      RC3_MIN: 1000,
      RC3_MAX: 2000,
      RC3_TRIM: 1000,
      RC5_MAX: 2000,
    })
    expect(useWriteFeedbackStore.getState().rebootPending).toBeTruthy()
  })

  it('asks for no restart when the mapping did not change', async () => {
    vi.spyOn(connectionService, 'setParamNow').mockImplementation(async (_p, v) => v)
    const { onClose } = start({ RCMAP_ROLL: 1, RCMAP_PITCH: 2, RCMAP_THROTTLE: 3, RCMAP_YAW: 4 })
    walkSticks()
    click('Next')
    click('Save calibration')
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(useWriteFeedbackStore.getState().rebootPending).toBeFalsy()
  })

  it('stays open on a refusal and retries only what was refused', async () => {
    let refuse = true
    const spy = vi.spyOn(connectionService, 'setParamNow').mockImplementation(async (p, v) => {
      if (p === 'RC3_MAX' && refuse) throw new Error('refused')
      return v
    })
    const { onClose } = start({ RCMAP_ROLL: 1, RCMAP_PITCH: 2, RCMAP_THROTTLE: 3, RCMAP_YAW: 4 })
    walkSticks()
    click('Next')
    click('Save calibration')
    await screen.findByText('The vehicle refused RC3_MAX.')
    expect(onClose).not.toHaveBeenCalled()

    refuse = false
    spy.mockClear()
    click('Retry')
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(spy.mock.calls.map((c) => c[0])).toEqual(['RC3_MAX'])
  })

  it('says so when a different stick moves on the way back, and Back asks again', () => {
    start({})
    move({ 3: 2000 })
    next()
    move({ 1: 2000 }) // roll moved when yaw right was asked for: caught as yaw
    next()
    move({ 1: 1500, 4: 1000 }) // yaw left: the real yaw, not the channel it caught
    expect(screen.getByText('Channel 4 moved, not 1. Wrong stick? Go back.')).toBeTruthy()
    click('Back')
    expect(screen.getByText('Move the yaw stick all the way right')).toBeTruthy()
  })
})
