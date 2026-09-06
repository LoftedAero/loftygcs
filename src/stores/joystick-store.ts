import { create } from 'zustand'
import { DEFAULT_CONFIG, type JoystickConfig } from '../protocol/joystick'

// The gamepad's settings and its live state.
//
// `active` is never persisted and never starts true. Everything else about
// this feature is a preference; that one is a decision someone has to make
// again every session, because it is the difference between a station that
// is watching an aircraft and one that is flying it.

const STORAGE_KEY = 'loftgcs.joystick'
/**
 * Which device, remembered by the id the browser reports rather than by
 * its index.
 *
 * Indices shuffle between sessions -- a wheel plugged in before the pad
 * takes index 0 today and index 1 tomorrow -- so a remembered index is a
 * remembered *different device*, which on this feature means the sticks
 * are somewhere other than where the picture says they are.
 */
const DEVICE_KEY = 'loftgcs.joystick.device'

function loadDevice(): string | null {
  try {
    return localStorage.getItem(DEVICE_KEY)
  } catch {
    return null
  }
}

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
  /** Every gamepad the browser can see, in its own index order. */
  pads: PadInfo[]
  /** The pad being read, or null when none is chosen or connected. */
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
  /** The chosen device's id, or null for "whichever is the only one". */
  deviceId: string | null

  setConfig(patch: Partial<JoystickConfig>): void
  setPads(pads: PadInfo[], pad: PadInfo | null): void
  /** Choose which device to read, by its reported id. */
  chooseDevice(deviceId: string | null): void
  setLive(axes: number[], buttons: boolean[], channels: number[]): void
  setActive(active: boolean): void
  setMessage(message: string | null): void
}

export const useJoystickStore = create<JoystickState>((set, get) => ({
  config: load(),
  pads: [],
  pad: null,
  axes: [],
  buttons: [],
  channels: [],
  active: false,
  message: null,
  deviceId: loadDevice(),

  setConfig(patch) {
    const config = { ...get().config, ...patch }
    set({ config })
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
    } catch {
      // Not remembering the mapping is a nuisance, never a failure.
    }
  },
  setPads(pads, pad) {
    // Compared before writing: this runs thirty times a second, and a new
    // array every tick re-renders the whole panel for nothing.
    const now = get()
    const samePads =
      now.pads.length === pads.length && now.pads.every((p, i) => p.id === pads[i]?.id)
    const samePad = now.pad?.id === pad?.id && now.pad?.index === pad?.index
    if (samePads && samePad) return
    set({ pads, pad })
  },
  chooseDevice(deviceId) {
    set({ deviceId })
    try {
      if (deviceId === null) localStorage.removeItem(DEVICE_KEY)
      else localStorage.setItem(DEVICE_KEY, deviceId)
    } catch {
      // The choice just will not persist.
    }
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
