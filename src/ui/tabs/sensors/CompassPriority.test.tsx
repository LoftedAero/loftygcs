import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import CompassPriority from './CompassPriority'
import { useParamStore } from '../../../stores/param-store'
import { useWriteFeedbackStore } from '../../../stores/write-feedback-store'
import { connectionService } from '../../../services/connection'

// Device ids are SITL's own compass fixtures.

const entry = (value: number) => ({ value, origValue: value, mavType: 6, dirty: false })

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useParamStore.setState({ entries: new Map() } as never)
  useWriteFeedbackStore.setState({ rebootPending: null, rebootDeferred: false } as never)
})

function seed() {
  const names: Record<string, number> = {
    COMPASS_PRIO1_ID: 97539,
    COMPASS_PRIO2_ID: 131874,
    COMPASS_PRIO3_ID: 0,
    COMPASS_DEV_ID: 97539,
    COMPASS_DEV_ID2: 131874,
    COMPASS_USE: 1,
    COMPASS_USE2: 1,
    COMPASS_USE3: 1,
  }
  useParamStore.setState({
    entries: new Map(Object.entries(names).map(([k, v]) => [k, entry(v)])),
  } as never)
}

describe('compass priority', () => {
  it('swaps the pair on the vehicle and asks for the restart the order needs', async () => {
    const writes: [string, number][] = []
    vi.spyOn(connectionService, 'setParamNow').mockImplementation(async (p, v) => {
      writes.push([p, v])
      return v
    })
    seed()
    render(<CompassPriority />)
    fireEvent.click(screen.getByRole('button', { name: 'Move compass 1 down' }))
    await waitFor(() => expect(useWriteFeedbackStore.getState().rebootPending).toBeTruthy())
    expect(writes).toEqual([
      ['COMPASS_PRIO1_ID', 131874],
      ['COMPASS_PRIO2_ID', 97539],
    ])
  })

  it('carries no standing line about the restart', () => {
    seed()
    render(<CompassPriority />)
    expect(screen.queryByText(/takes effect when the vehicle reboots/)).toBeNull()
  })
})
