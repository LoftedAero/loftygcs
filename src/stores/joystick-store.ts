import { create } from 'zustand'
import { DEFAULT_CONFIG, type JoystickConfig } from '../protocol/joystick'

// The gamepad's settings and its live state.
//
// `active` is never persisted and never starts true. Everything else about
// this feature is a preference; that one is a decision someone has to make
// again every session, because it is the difference between a station that
// is watching an aircraft and one that is flying it.

const STORAGE_KEY = 'loftgcs.joystick'

function load(): JoystickConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_CONFIG
    const saved = JSON.parse(raw) as Partial<JoystickConfig>
    // Merged rather than trusted: a saved config from an older version is
    // missing whatever was added since, and a half-built axis map is a
    // stick that does nothing.
    return {
      axes: Array.isArray(saved.axes) && saved.axes.length > 0 ? saved.axes : DEFAULT_CONFIG.axes,
      buttons: Array.isArray(saved.buttons) ? saved.buttons : [],
      deadzone:
        typeof saved.deadzone === 'number' && saved.deadzone >= 0 && saved.deadzone < 0.5
          ? saved.deadzone
          : DEFAULT_CONFIG.deadzone,
    }
  } catch {
    return DEFAULT_CONFIG
  }
}

export interface PadInfo {
  index: number
  id: string
}

interface JoystickState {
  config: JoystickConfig
  /** The pad being read, or null when none is connected. */
  pad: PadInfo | null
  /** Live axis values, for the setup screen's bars. */
  axes: number[]
  buttons: boolean[]
  /** What would be sent, or is being sent. */
  channels: number[]
  /** True only while overrides are actually going out. */
  active: boolean
  /** Why control was refused or dropped, for the panel to show. */
  message: string | null

  setConfig(patch: Partial<JoystickConfig>): void
  setPad(pad: PadInfo | null): void
  setLive(axes: number[], buttons: boolean[], channels: number[]): void
  setActive(active: boolean): void
  setMessage(message: string | null): void
}

export const useJoystickStore = create<JoystickState>((set, get) => ({
  config: load(),
  pad: null,
  axes: [],
  buttons: [],
  channels: [],
  active: false,
  message: null,

  setConfig(patch) {
    const config = { ...get().config, ...patch }
    set({ config })
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
    } catch {
      // Not remembering the mapping is a nuisance, never a failure.
    }
  },
  setPad(pad) {
    set({ pad })
  },
  setLive(axes, buttons, channels) {
    set({ axes, buttons, channels })
  },
  setActive(active) {
    set({ active })
  },
  setMessage(message) {
    set({ message })
  },
}))
