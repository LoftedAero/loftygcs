// Every callout the app can make, and its default. The defaults were chosen
// row by row by the project's owner (2026-10-02), starting from Yaapu
// Telemetry and QGroundControl: speak what you need to know without looking,
// beep for what the screen already explains, and leave the rest silent.

/** How a callout is delivered. */
export type CalloutMode = 'voice' | 'beep' | 'off'

/**
 * How urgent a callout is. Critical interrupts whatever is playing; warning
 * goes ahead of information; information waits and is dropped if stale.
 */
export type CalloutPriority = 'crit' | 'warn' | 'info'

/** The two beeps. A row's beep follows its priority unless it says otherwise. */
export type BeepKind = 'info' | 'warn'

/** What a threshold measures, which decides how it is shown and entered. */
export type ThresholdUnit =
  'distance' | 'speed' | 'percent' | 'seconds' | 'minutes' | 'voltsPerCell'

export interface CalloutThreshold {
  /** In SI (meters, m/s, volts) or the unit named; converted only for display. */
  default: number
  unit: ThresholdUnit
  min: number
  max: number
  step: number
  /** How the threshold reads beside the value: "below 50 %". */
  relation: string
}

export const CALLOUT_GROUPS = [
  { id: 'state', label: 'Flight state' },
  { id: 'link', label: 'Link' },
  { id: 'power', label: 'Battery' },
  { id: 'nav', label: 'Position and navigation' },
  { id: 'mission', label: 'Mission' },
  { id: 'safety', label: 'Failsafes and safety' },
  { id: 'messages', label: 'Messages from the aircraft' },
  { id: 'periodic', label: 'Periodic and limit callouts' },
  { id: 'app', label: 'Lofty itself' },
] as const

export type CalloutGroup = (typeof CALLOUT_GROUPS)[number]['id']

export interface CalloutDef {
  id: string
  group: CalloutGroup
  label: string
  pri: CalloutPriority
  mode: CalloutMode
  beep?: BeepKind
  /** The modes offered, when not all three make sense. */
  modes?: readonly CalloutMode[]
  threshold?: CalloutThreshold
}

const pct = (d: number, relation: string): CalloutThreshold => ({
  default: d,
  unit: 'percent',
  min: 5,
  max: 95,
  step: 5,
  relation,
})
const dist = (d: number, relation: string, max = 100000): CalloutThreshold => ({
  default: d,
  unit: 'distance',
  min: 1,
  max,
  step: 1,
  relation,
})

export const CALLOUTS = [
  // Flight state
  { id: 'mode', group: 'state', label: 'Flight mode change', pri: 'warn', mode: 'voice' },
  { id: 'armed', group: 'state', label: 'Armed', pri: 'warn', mode: 'voice' },
  { id: 'disarmed', group: 'state', label: 'Disarmed', pri: 'warn', mode: 'voice' },
  { id: 'arm-refused', group: 'state', label: 'Arming refused', pri: 'warn', mode: 'beep' },
  { id: 'ready', group: 'state', label: 'Ready to arm', pri: 'info', mode: 'off' },
  { id: 'takeoff-done', group: 'state', label: 'Takeoff complete', pri: 'info', mode: 'off' },
  { id: 'transition', group: 'state', label: 'VTOL transition', pri: 'info', mode: 'voice' },
  { id: 'landed', group: 'state', label: 'Landing complete', pri: 'info', mode: 'off' },
  { id: 'mode-refused', group: 'state', label: 'Mode change refused', pri: 'warn', mode: 'beep' },

  // Link
  { id: 'link-lost', group: 'link', label: 'Telemetry lost', pri: 'crit', mode: 'voice' },
  { id: 'link-back', group: 'link', label: 'Telemetry regained', pri: 'warn', mode: 'voice' },
  {
    id: 'rc-low',
    group: 'link',
    label: 'Low RC link quality',
    pri: 'warn',
    mode: 'off',
    threshold: pct(50, 'below'),
  },

  // Battery
  { id: 'batt-low', group: 'power', label: 'Battery low', pri: 'warn', mode: 'voice' },
  { id: 'batt-crit', group: 'power', label: 'Battery critical', pri: 'crit', mode: 'voice' },
  {
    id: 'batt-pct',
    group: 'power',
    label: 'Battery percentage steps',
    pri: 'info',
    mode: 'off',
    threshold: pct(50, 'from'),
  },
  {
    id: 'batt-cell',
    group: 'power',
    label: 'Cell voltage alert',
    pri: 'warn',
    mode: 'off',
    threshold: {
      default: 3.5,
      unit: 'voltsPerCell',
      min: 3,
      max: 4.2,
      step: 0.05,
      relation: 'below',
    },
  },

  // Position and navigation
  { id: 'gps-fix', group: 'nav', label: 'GPS 3D fix', pri: 'info', mode: 'voice' },
  { id: 'gps-lost', group: 'nav', label: 'GPS fix lost', pri: 'warn', mode: 'voice' },
  { id: 'gps-glitch', group: 'nav', label: 'GPS glitch', pri: 'warn', mode: 'voice' },
  { id: 'home', group: 'nav', label: 'Home set', pri: 'info', mode: 'off' },
  { id: 'traffic', group: 'nav', label: 'ADS-B traffic close', pri: 'warn', mode: 'voice' },
  { id: 'terrain', group: 'nav', label: 'No terrain data', pri: 'warn', mode: 'off' },

  // Mission
  { id: 'wp', group: 'mission', label: 'Next waypoint', pri: 'info', mode: 'voice' },
  { id: 'mission-done', group: 'mission', label: 'Mission complete', pri: 'warn', mode: 'voice' },
  { id: 'land-stages', group: 'mission', label: 'Landing stages', pri: 'info', mode: 'voice' },

  // Failsafes and safety
  { id: 'failsafe', group: 'safety', label: 'Failsafe', pri: 'crit', mode: 'voice' },
  { id: 'ekf', group: 'safety', label: 'EKF failsafe or variance', pri: 'crit', mode: 'beep' },
  { id: 'fence-breach', group: 'safety', label: 'Fence breach', pri: 'crit', mode: 'voice' },
  { id: 'fence-on', group: 'safety', label: 'Fence enabled on arming', pri: 'info', mode: 'beep' },
  { id: 'parachute', group: 'safety', label: 'Parachute released', pri: 'crit', mode: 'off' },
  {
    id: 'low-airspeed',
    group: 'safety',
    label: 'Low airspeed',
    pri: 'warn',
    mode: 'off',
    threshold: { default: 12, unit: 'speed', min: 1, max: 100, step: 1, relation: 'below' },
  },

  // Messages from the aircraft
  {
    id: 'sev-crit',
    group: 'messages',
    label: 'Emergency, alert and critical messages',
    pri: 'crit',
    mode: 'voice',
  },
  { id: 'sev-err', group: 'messages', label: 'Error messages', pri: 'warn', mode: 'voice' },
  {
    id: 'sev-warn',
    group: 'messages',
    label: 'Warning messages',
    pri: 'info',
    mode: 'beep',
    beep: 'warn',
  },
  {
    id: 'sev-notice',
    group: 'messages',
    label: 'Notice and info messages',
    pri: 'info',
    mode: 'off',
  },
  { id: 'hash', group: 'messages', label: 'Messages starting with #', pri: 'warn', mode: 'off' },
  {
    id: 'prearm',
    group: 'messages',
    label: 'PreArm messages while disarmed',
    pri: 'info',
    mode: 'off',
  },
  { id: 'autotune', group: 'messages', label: 'AutoTune result', pri: 'info', mode: 'voice' },

  // Periodic and limit callouts
  {
    id: 'timer',
    group: 'periodic',
    label: 'Flight timer',
    pri: 'info',
    mode: 'off',
    threshold: { default: 5, unit: 'minutes', min: 1, max: 60, step: 1, relation: 'every' },
  },
  {
    id: 'max-alt',
    group: 'periodic',
    label: 'Altitude limit',
    pri: 'warn',
    mode: 'off',
    threshold: dist(120, 'above', 10000),
  },
  {
    id: 'min-alt',
    group: 'periodic',
    label: 'Low altitude',
    pri: 'warn',
    mode: 'off',
    threshold: dist(10, 'below', 1000),
  },
  {
    id: 'max-dist',
    group: 'periodic',
    label: 'Distance limit',
    pri: 'warn',
    mode: 'off',
    threshold: dist(1000, 'beyond'),
  },
  {
    id: 'readout',
    group: 'periodic',
    label: 'Periodic readout',
    pri: 'info',
    mode: 'off',
    modes: ['voice', 'off'],
    threshold: { default: 30, unit: 'seconds', min: 10, max: 600, step: 5, relation: 'every' },
  },

  // Lofty itself
  { id: 'joystick', group: 'app', label: 'Joystick control released', pri: 'crit', mode: 'off' },
  { id: 'params', group: 'app', label: 'Parameters loaded', pri: 'info', mode: 'off' },
  { id: 'transfer', group: 'app', label: 'Plan written or read', pri: 'info', mode: 'off' },
  { id: 'video', group: 'app', label: 'Video lost', pri: 'info', mode: 'off', beep: 'warn' },
] as const satisfies readonly CalloutDef[]

export type CalloutId = (typeof CALLOUTS)[number]['id']

const BY_ID = new Map<string, CalloutDef>(CALLOUTS.map((c) => [c.id, c]))

export function calloutDef(id: CalloutId): CalloutDef {
  return BY_ID.get(id)!
}

export function isCalloutId(id: string): id is CalloutId {
  return BY_ID.has(id)
}

/** The beep a row gets: its own, or by priority so each sound keeps one meaning. */
export function beepKindOf(def: CalloutDef): BeepKind {
  return def.beep ?? (def.pri === 'info' ? 'info' : 'warn')
}

export function modesOf(def: CalloutDef): readonly CalloutMode[] {
  return def.modes ?? ['voice', 'beep', 'off']
}

/** How often an alert that is still true is said again; 0 never. */
export const REPEAT_CHOICES_S = [0, 10, 20, 30, 60] as const
export const DEFAULT_REPEAT_S = 30
