import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import FlightControls from './FlightControls'
import { useVehicleStore } from '../../../stores/vehicle-store'
import { useMissionStore } from '../../../stores/mission-store'
import { useConnectionStore } from '../../../stores/connection-store'
import { usePreferencesStore } from '../../../stores/preferences-store'

// The progress strip, given data the demo vehicle cannot produce.
//
// The virtual FC has no flight dynamics on purpose, so it never flies a
// mission and never sends MISSION_CURRENT; SITL proves the data path and
// this proves the rendering. Between them the feature is covered end to end
// without either pretending to be the other.

const setPlan = (count: number) => {
  useMissionStore.getState().clear()
  for (let i = 0; i < count; i++) {
    useMissionStore.getState().addItem(16, { x: 515000000 + i * 2000, y: -1200000 })
  }
}

beforeEach(() => {
  usePreferencesStore.getState().reset()
  useVehicleStore.getState().reset()
  useConnectionStore.setState({ phase: 'connected' })
  useMissionStore.getState().clear()
})

afterEach(() => {
  cleanup()
  useConnectionStore.setState({ phase: 'idle' })
})

const strip = () => document.querySelector('.flight-progress')

describe('mission progress on the Fly screen', () => {
  it('shows nothing until the vehicle reports an item', () => {
    setPlan(3)
    render(<FlightControls onVideo={() => {}} />)
    // A vehicle in Loiter is not flying a mission, and an empty "WP —" would
    // be a readout claiming to know something it does not.
    expect(strip()).toBeNull()
  })

  it('names the item, the command and the distance once it does', () => {
    setPlan(4)
    render(<FlightControls onVideo={() => {}} />)
    act(() => useVehicleStore.setState({ missionSeq: 2, wpDistM: 150, groundspeedMs: 10 }))
    const text = strip()!.textContent!
    expect(text).toContain('2 of 3')
    expect(text).toContain('Waypoint')
    expect(text).toContain('150 m')
    // 150 m at 10 m/s.
    expect(text).toContain('0:15')
  })

  it('follows the unit preference', () => {
    setPlan(4)
    render(<FlightControls onVideo={() => {}} />)
    act(() => {
      usePreferencesStore.getState().setDistanceUnit('ft')
      useVehicleStore.setState({ missionSeq: 1, wpDistM: 150, groundspeedMs: 10 })
    })
    expect(strip()!.textContent).toContain('492 ft')
  })

  it('drops the ETA when the vehicle is not moving, keeping the rest', () => {
    setPlan(4)
    render(<FlightControls onVideo={() => {}} />)
    act(() => useVehicleStore.setState({ missionSeq: 2, wpDistM: 150, groundspeedMs: 0 }))
    const text = strip()!.textContent!
    expect(text).toContain('2 of 3')
    expect(text).not.toMatch(/\d+:\d\d/)
  })

  it('still reports the item with no plan loaded here', () => {
    // The vehicle may be flying a mission this GCS never uploaded.
    render(<FlightControls onVideo={() => {}} />)
    act(() => useVehicleStore.setState({ missionSeq: 5, wpDistM: 80, groundspeedMs: 8 }))
    expect(strip()!.textContent).toContain('5')
  })
})
