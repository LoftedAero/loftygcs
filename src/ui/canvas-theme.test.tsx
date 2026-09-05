import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import LogPlot from './tabs/logs/LogPlot'
import AltitudeProfile from './tabs/mission/AltitudeProfile'
import { useLogStore } from '../stores/log-store'
import { useMissionStore } from '../stores/mission-store'
import { useThemeStore } from '../stores/theme-store'

// Canvases and the theme.
//
// A canvas holds its last paint until something repaints it, and the palette
// reaches it as resolved strings rather than as var() -- so a component that
// draws from tokens has to redraw when the theme changes, or it keeps the
// other theme's colors. Nothing about that is visible in a type or caught by
// a lint: the plot kept a white background on a dark window until the mouse
// moved over it, because moving the mouse was the only thing left that
// changed a dependency.
//
// The instruments and the flight plot are safe by accident -- they redraw on
// every animation frame -- so this covers the two that draw once and stop.

/** A 2D context that records which calls a draw made. */
function recordingContext(calls: string[]) {
  return new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === 'canvas') return undefined
        // Property reads that must answer with something usable.
        if (prop === 'measureText') return () => ({ width: 10 })
        if (prop === 'createLinearGradient') return () => ({ addColorStop() {} })
        if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) })
        return (...args: unknown[]) => {
          calls.push(prop)
          return args
        }
      },
      set() {
        return true
      },
    },
  )
}

let calls: string[] = []
const size = { w: 800, h: 400 }

beforeEach(() => {
  calls = []
  HTMLCanvasElement.prototype.getContext = (() =>
    recordingContext(calls)) as unknown as HTMLCanvasElement['getContext']
  // jsdom has no layout, and both components refuse to draw into a zero-sized
  // canvas -- correctly, so the stub gives them one.
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => size.w,
  })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => size.h,
  })
  useThemeStore.setState({ choice: 'light', resolved: 'light' })
})

afterEach(() => {
  cleanup()
  useThemeStore.setState({ choice: 'light', resolved: 'light' })
})

const drawCount = () => calls.filter((c) => c === 'setTransform').length

const flipTheme = () =>
  act(() => {
    document.documentElement.setAttribute('data-theme', 'dark')
    useThemeStore.setState({ choice: 'dark', resolved: 'dark' })
  })

describe('the log plot', () => {
  beforeEach(() => {
    const bytes = new Uint8Array(gunzipSync(readFileSync('src/test-fixtures/copter-sitl.bin.gz')))
    useLogStore.getState().clear()
    useLogStore.getState().loadBytes('flight.bin', bytes)
    useLogStore.getState().toggleField({ message: 'ATT', field: 'Roll' })
  })

  it('repaints when the theme changes, with nothing else touched', () => {
    render(<LogPlot />)
    const before = drawCount()
    expect(before).toBeGreaterThan(0)
    flipTheme()
    // The bug this guards: the old background survived until an unrelated
    // redraw fired, which in practice meant moving the mouse over the plot.
    expect(drawCount()).toBeGreaterThan(before)
  })
})

describe('the mission altitude profile', () => {
  beforeEach(() => {
    // 16 is NAV_WAYPOINT; positions are the scaled integers the wire uses.
    useMissionStore.getState().clear()
    useMissionStore.getState().addItem(16, { x: 515000000, y: -1200000 })
    useMissionStore.getState().addItem(16, { x: 515100000, y: -1300000 })
  })

  it('repaints when the theme changes', () => {
    render(<AltitudeProfile />)
    const before = drawCount()
    expect(before).toBeGreaterThan(0)
    flipTheme()
    expect(drawCount()).toBeGreaterThan(before)
  })
})
