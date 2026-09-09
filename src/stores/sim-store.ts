import { create } from 'zustand'
import type { SimBuildChoice, SimParams, SimPhysics, SimStatus } from '../types/loftgcs'

// State of the locally managed ArduPilot SITL. Only meaningful in the
// desktop build; the browser has no way to run a process.

export type SimPhase = 'idle' | 'installing' | 'starting' | 'running' | 'error'

interface SimState {
  status: SimStatus | null
  phase: SimPhase
  progress: { file: string; done: number; total: number } | null
  error: string | null
  log: string[]
  setStatus: (s: SimStatus) => void
  setPhase: (p: SimPhase) => void
  setProgress: (p: SimState['progress']) => void
  fail: (error: string) => void
  /**
   * The simulator is up but RealFlight was not there to talk to.
   *
   * Not an error: SITL retries the connection for as long as it runs, so
   * this clears itself the moment RealFlight appears and the user connects.
   */
  waitingForRealFlight: boolean
  setWaitingForRealFlight: (waiting: boolean) => void
  appendLog: (chunk: string) => void
  /**
   * Where the next simulator boots, one remembered place per physics.
   *
   * Two slots rather than one because the two simulators fly different
   * ground: a home chosen for RealFlight belongs to RealFlight's scenery
   * and means nothing to SITL's own model, and vice versa. Sharing one
   * value made choosing a field for one silently move the other, so
   * switching physics quietly relocated the aircraft.
   *
   * An empty slot means "that physics' default" -- CMAC or Eli Field -- so
   * the defaults stay defaults and are never written in as if chosen.
   */
  homes: Record<HomeSlot, string>
  /** Writes the slot the current physics uses. */
  setHomeText: (text: string) => void

  /**
   * Where the next file dialog opens.
   *
   * One folder for both pickers rather than one each, because they are the
   * same folder in practice: an aircraft ships as an executable beside its
   * `<model>/eeprom.bin`, so picking the build is what tells the app where
   * the parameters live. Remembered, because the second session at the same
   * aircraft should not start at the top of the disk again.
   */
  browseDir: string
  setBrowseDir: (dir: string) => void

  /**
   * How the next simulator is launched.
   *
   * Remembered across sessions, because this is a rig rather than a
   * setting: someone who flies a custom build against RealFlight does it
   * every time, and rebuilding the three choices at each launch is the
   * whole cost of the feature.
   */
  build: SimBuildChoice | null
  setBuild: (build: SimBuildChoice | null) => void
  physics: SimPhysics
  setPhysics: (physics: SimPhysics) => void
  params: SimParams
  setParams: (params: SimParams) => void
}

const LOG_CAP = 200
// One home, remembered, rather than a named collection of them.
//
// Fields could be saved by name and picked back from a dropdown. That was
// built when home was four numbers someone had typed and would not want to
// type again; picking it off a map takes a few seconds, so the library was
// carrying more than it earned -- a select, a text box, a save and a forget,
// for a value most people set once. The heading is still the point of it:
// with FlightAxis, ArduPilot sets its origin to home and maps RealFlight's
// local coordinates around it, so home decides both where the field sits on
// Earth and which way its runway points.
const HOME_KEY = 'loftgcs.sim.home'
const RIG_KEY = 'loftgcs.sim.rig'
const BROWSE_KEY = 'loftgcs.sim.browseDir'

/** Which remembered home a physics choice uses. */
export type HomeSlot = 'builtin' | 'flightaxis'

export function homeSlot(physicsKind: string): HomeSlot {
  return physicsKind === 'flightaxis' ? 'flightaxis' : 'builtin'
}

interface Rig {
  build: SimBuildChoice | null
  physics: SimPhysics
  params: SimParams
}

/**
 * The launch setup, remembered.
 *
 * Defaults are what someone gets who just presses Start: the managed
 * download, its own physics, and a wipe -- the behavior before any of this
 * was choosable.
 */
const DEFAULT_RIG: Rig = { build: null, physics: { kind: 'builtin' }, params: { kind: 'wipe' } }

function loadRig(): Rig {
  try {
    const raw = localStorage.getItem(RIG_KEY)
    if (!raw) return DEFAULT_RIG
    const parsed = JSON.parse(raw) as Partial<Rig>
    return {
      build: parsed.build ?? null,
      physics: parsed.physics ?? DEFAULT_RIG.physics,
      params: parsed.params ?? DEFAULT_RIG.params,
    }
  } catch {
    return DEFAULT_RIG
  }
}

function saveRig(rig: Rig): void {
  try {
    localStorage.setItem(RIG_KEY, JSON.stringify(rig))
  } catch {
    // Not remembering the rig is a nuisance, never a failure.
  }
}

const NO_HOMES: Record<HomeSlot, string> = { builtin: '', flightaxis: '' }

/**
 * The homes are remembered as text rather than parsed: the string is what
 * was chosen, altitude and heading included, and it survives a build that
 * parses differently.
 *
 * Older builds stored a bare string here, for the one home there was. It is
 * migrated into the slot for whichever physics was selected at the time,
 * which the rig records -- assuming `builtin` would silently move a
 * RealFlight user's field onto ground it was not measured against.
 */
function loadHomes(): Record<HomeSlot, string> {
  try {
    const raw = localStorage.getItem(HOME_KEY)
    if (!raw) return NO_HOMES
    if (raw.startsWith('{')) {
      const parsed = JSON.parse(raw) as Partial<Record<HomeSlot, string>>
      return {
        builtin: typeof parsed.builtin === 'string' ? parsed.builtin : '',
        flightaxis: typeof parsed.flightaxis === 'string' ? parsed.flightaxis : '',
      }
    }
    return { ...NO_HOMES, [homeSlot(loadRig().physics.kind)]: raw }
  } catch {
    return NO_HOMES
  }
}

function saveHomes(homes: Record<HomeSlot, string>): void {
  try {
    localStorage.setItem(HOME_KEY, JSON.stringify(homes))
  } catch {
    // Not remembering the field is a nuisance, never a failure.
  }
}

/**
 * The home in force, given what is selected.
 *
 * A function rather than a field, so there is one source of truth: a stored
 * `homeText` kept alongside `homes` would be a second copy to forget to
 * update the moment physics changed, which is exactly the bug the slots
 * exist to fix.
 */
export function currentHomeText(s: Pick<SimState, 'homes' | 'physics'>): string {
  return s.homes[homeSlot(s.physics.kind)]
}

/** The same, as a hook -- a string, so it re-renders only when it changes. */
export const useHomeText = (): string => useSimStore(currentHomeText)

export const useSimStore = create<SimState>((set, get) => ({
  status: null,
  phase: 'idle',
  progress: null,
  error: null,
  waitingForRealFlight: false,
  setWaitingForRealFlight: (waitingForRealFlight) => set({ waitingForRealFlight }),
  log: [],
  setStatus: (status) => set({ status }),
  setPhase: (phase) =>
    set({
      phase,
      ...(phase === 'idle' ? { error: null, waitingForRealFlight: false } : {}),
    }),
  setProgress: (progress) => set({ progress }),
  fail: (error) => set({ phase: 'error', error }),
  ...loadRig(),
  setBuild: (build) => {
    set({ build })
    saveRig({ build, physics: get().physics, params: get().params })
  },
  setPhysics: (physics) => {
    set({ physics })
    saveRig({ build: get().build, physics, params: get().params })
  },
  setParams: (params) => {
    set({ params })
    saveRig({ build: get().build, physics: get().physics, params })
  },

  browseDir: (() => {
    try {
      return localStorage.getItem(BROWSE_KEY) ?? ''
    } catch {
      return ''
    }
  })(),
  setBrowseDir: (browseDir) => {
    set({ browseDir })
    try {
      localStorage.setItem(BROWSE_KEY, browseDir)
    } catch {
      // Starting the next dialog at the top of the disk is a nuisance,
      // never a failure.
    }
  },

  homes: loadHomes(),
  setHomeText: (text) => {
    const homes = { ...get().homes, [homeSlot(get().physics.kind)]: text }
    set({ homes })
    saveHomes(homes)
  },
  appendLog: (chunk) =>
    set((s) => ({
      log: [...s.log, ...chunk.split(/\r?\n/).filter(Boolean)].slice(-LOG_CAP),
    })),
}))
