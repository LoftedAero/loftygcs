import { create } from 'zustand'
import { DEFAULT_CONFIG, sanitizeConfig, type JoystickConfig } from '../protocol/joystick'

// The gamepad's settings and its live state.
//
// `active` is never persisted and never starts true. Everything else about
// this feature is a preference; that one is a decision someone has to make
// again every session, because it is the difference between a station that
// is watching an aircraft and one that is flying it.
//
// **A mapping belongs to a device.** A gamepad, a HOTAS and a wheel have
// nothing in common but the word "axis", so each device the browser reports
// keeps its own mapping, and choosing it -- or plugging it in -- brings that
// mapping back. Named profiles sit beside that: a mapping saved under a name
// can be loaded onto any device, and written to or read from a file to move
// it between machines. Everything read back, from storage or from a file, is
// passed through `sanitizeConfig` before it is used.

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
/** Each device's own mapping, by its reported id. */
const DEVICES_KEY = 'loftgcs.joystick.devices'
/** Named mappings, loadable onto any device. */
const PROFILES_KEY = 'loftgcs.joystick.profiles'
/** The single mapping older builds kept; read once, as the starting point. */
const LEGACY_KEY = 'loftgcs.joystick'

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value))
  } catch {
    // Not remembering is a nuisance, never a failure.
  }
}

function readConfigs(key: string): Record<string, JoystickConfig> {
  const raw = read<unknown>(key, {})
  const out: Record<string, JoystickConfig> = {}
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [name, cfg] of Object.entries(raw)) out[name] = sanitizeConfig(cfg)
  }
  return out
}

function readDevice(): string | null {
  try {
    return localStorage.getItem(DEVICE_KEY)
  } catch {
    return null
  }
}

/** Where a device with no mapping of its own starts: the old single mapping, or the default. */
function startingConfig(): JoystickConfig {
  const legacy = read<unknown>(LEGACY_KEY, null)
  return legacy ? sanitizeConfig(legacy) : DEFAULT_CONFIG
}

export interface PadInfo {
  index: number
  id: string
}

interface JoystickState {
  /** The mapping in use: the current device's own, or the starting one. */
  config: JoystickConfig
  /** Each device's mapping, by its reported id. */
  devices: Record<string, JoystickConfig>
  /** Named mappings. */
  profiles: Record<string, JoystickConfig>
  /** The device `config` belongs to, or null before any is known. */
  configFor: string | null
  /** Every gamepad the browser can see, in its own index order. */
  pads: PadInfo[]
  /** The pad being read, or null when none is chosen or connected. */
  pad: PadInfo | null
  /** Live values, for the setup screen and the channel bars. */
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

  /** Change the current mapping; it is kept as the current device's own. */
  setConfig(patch: Partial<JoystickConfig>): void
  /** Replace the current mapping wholesale, as loading a profile does. */
  replaceConfig(config: JoystickConfig): void
  setPads(pads: PadInfo[], pad: PadInfo | null): void
  /** Choose which device to read, by its reported id. */
  chooseDevice(deviceId: string | null): void
  saveProfile(name: string): void
  loadProfile(name: string): void
  deleteProfile(name: string): void
  /** Add a profile from outside -- a file -- after sanitizing it. */
  importProfile(name: string, config: unknown): void
  setLive(axes: number[], buttons: boolean[], channels: number[]): void
  setActive(active: boolean): void
  setMessage(message: string | null): void
}

export const useJoystickStore = create<JoystickState>((set, get) => ({
  config: startingConfig(),
  devices: readConfigs(DEVICES_KEY),
  profiles: readConfigs(PROFILES_KEY),
  configFor: null,
  pads: [],
  pad: null,
  axes: [],
  buttons: [],
  channels: [],
  active: false,
  message: null,
  deviceId: readDevice(),

  setConfig(patch) {
    get().replaceConfig(sanitizeConfig({ ...get().config, ...patch }))
  },
  replaceConfig(config) {
    const { configFor, devices } = get()
    const next = configFor ? { ...devices, [configFor]: config } : devices
    set({ config, devices: next })
    if (configFor) write(DEVICES_KEY, next)
  },
  setPads(pads, pad) {
    // Compared before writing: this runs thirty times a second, and a new
    // array every tick re-renders the whole panel for nothing.
    const now = get()
    const samePads =
      now.pads.length === pads.length && now.pads.every((p, i) => p.id === pads[i]?.id)
    const samePad = now.pad?.id === pad?.id && now.pad?.index === pad?.index
    if (samePads && samePad) return
    // A different device brings its own mapping. Never while flying: a
    // mapping that changed under the hands mid-flight is worse than a stale
    // one, and the service releases control on a device change anyway.
    const switching = pad && pad.id !== now.configFor && !now.active
    if (switching) {
      const own = now.devices[pad.id]
      // A device seen for the first time starts from the Mode 2 default, not
      // from whatever the last device used -- a HOTAS has nothing in common
      // with a gamepad's axis numbers. The very first device takes over the
      // single mapping older builds kept, so an upgrade loses nothing.
      const first = Object.keys(now.devices).length === 0
      const config = own ?? (first ? now.config : DEFAULT_CONFIG)
      const devices = own ? now.devices : { ...now.devices, [pad.id]: config }
      set({ pads, pad, configFor: pad.id, config, devices })
      if (!own) write(DEVICES_KEY, devices)
      return
    }
    set({ pads, pad })
  },
  chooseDevice(deviceId) {
    set({ deviceId })
    write(DEVICE_KEY, deviceId)
  },
  saveProfile(name) {
    const profiles = { ...get().profiles, [name]: get().config }
    set({ profiles })
    write(PROFILES_KEY, profiles)
  },
  loadProfile(name) {
    const profile = get().profiles[name]
    if (profile && !get().active) get().replaceConfig(profile)
  },
  deleteProfile(name) {
    const profiles = { ...get().profiles }
    delete profiles[name]
    set({ profiles })
    write(PROFILES_KEY, profiles)
  },
  importProfile(name, config) {
    const profiles = { ...get().profiles, [name]: sanitizeConfig(config) }
    set({ profiles })
    write(PROFILES_KEY, profiles)
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
