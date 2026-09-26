import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import FailsafesTab from './FailsafesTab'
import { useParamStore } from '../../../stores/param-store'
import { useConnectionStore } from '../../../stores/connection-store'

// The same cards on Copter, Plane and a quadplane, each listing the names its
// vehicle reports. Every name below was read off a running 4.7.1 SITL.

const entry = (value: number) => ({ value, origValue: value, mavType: 9, dirty: false })

function seed(names: Record<string, number>, metadata: Record<string, unknown> = {}) {
  useConnectionStore.setState({ phase: 'connected' } as never)
  useParamStore.setState({
    entries: new Map(Object.entries(names).map(([k, v]) => [k, entry(v)])),
    loadState: 'ready',
    metadata,
  } as never)
}

afterEach(() => {
  cleanup()
  useParamStore.setState({ entries: new Map(), loadState: 'idle', metadata: {} } as never)
  useConnectionStore.setState({ phase: 'idle' } as never)
})

const titles = () => [...document.querySelectorAll('.la-card__title')].map((e) => e.textContent)
const shown = () => [...document.querySelectorAll('.la-field__param')].map((e) => e.textContent)

describe('the Failsafe page', () => {
  it('draws Copter 4.7’s renamed return altitudes and its skipped-checks mask', () => {
    seed({
      FS_THR_ENABLE: 1,
      FS_GCS_ENABLE: 0,
      RTL_ALT_M: 15,
      RTL_ALT_FINAL_M: 0,
      RTL_CLIMB_MIN_M: 0,
      FS_EKF_ACTION: 1,
      FENCE_ENABLE: 0,
      ARMING_SKIPCHK: 0,
      DISARM_DELAY: 10,
    })
    render(<FailsafesTab />)
    expect(shown()).toEqual(
      expect.arrayContaining(['RTL_ALT_M', 'RTL_ALT_FINAL_M', 'RTL_CLIMB_MIN_M', 'ARMING_SKIPCHK']),
    )
    expect(titles()).not.toContain('VTOL assist')
  })

  it('draws Plane’s own spellings: FS_GCS_ENABL, the two-stage radio failsafe, crash detection', () => {
    seed({
      THR_FAILSAFE: 1,
      FS_SHORT_ACTN: 0,
      FS_LONG_ACTN: 0,
      FS_LONG_TIMEOUT: 5,
      FS_GCS_ENABL: 0,
      RTL_ALTITUDE: 100,
      CRASH_DETECT: 0,
      FENCE_ENABLE: 0,
      ARMING_SKIPCHK: 0,
    })
    render(<FailsafesTab />)
    expect(shown()).toEqual(
      expect.arrayContaining(['FS_GCS_ENABL', 'FS_SHORT_ACTN', 'FS_LONG_ACTN', 'CRASH_DETECT']),
    )
    // The same six cards as a Copter, in the same order.
    expect(titles()).toEqual([
      'Arming',
      'Radio failsafe',
      'Ground station failsafe',
      'Return to launch',
      'Fence',
      'EKF and crash',
    ])
  })

  it('adds VTOL assist, and the VTOL return, on a quadplane', () => {
    seed({
      THR_FAILSAFE: 1,
      RTL_ALTITUDE: 100,
      Q_RTL_MODE: 0,
      Q_ASSIST_SPEED: 0,
      Q_TRANS_FAIL: 0,
      ARMING_SKIPCHK: 0,
    })
    render(<FailsafesTab />)
    expect(titles()).toContain('VTOL assist')
    expect(shown()).toEqual(expect.arrayContaining(['Q_RTL_MODE', 'Q_ASSIST_SPEED']))
  })
})

describe('compact values', () => {
  it('shortens ArduPilot’s sentence-length names, keeping the full one on hover', () => {
    seed(
      { ARMING_REQUIRE: 1, ARMING_SKIPCHK: 3 },
      {
        ARMING_REQUIRE: {
          values: {
            0: 'Disabled',
            1: 'Yes(minimum PWM when disarmed)',
            2: 'Yes(0 PWM when disarmed)',
          },
        },
        ARMING_SKIPCHK: { bitmask: { 0: 'All', 1: 'Barometer', 2: 'Compass' } },
      },
    )
    render(<FailsafesTab />)
    const select = document.querySelector('select') as HTMLSelectElement
    expect([...select.options].map((o) => o.textContent)).toEqual([
      'Disabled',
      'Yes, min PWM',
      'Yes, 0 PWM',
    ])
    expect(select.title).toBe('Yes(minimum PWM when disarmed)')
    expect(document.querySelector('.param-bitmask')?.textContent).toBe('2 selected')
  })
})
