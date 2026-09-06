import { create } from 'zustand'
import { frameName, knownAirframe, type KnownAirframe } from '../protocol/airframe'
import type { FirmwareVersion } from '../protocol/types'

// Throttled snapshot of vehicle state for ordinary React components (mode
// label, battery readout, GPS badge). The connection service pushes here at
// a few Hz; anything that needs full rate reads the telemetry rings instead.

export interface StatusText {
  severity: number
  text: string
  at: number
}

export interface VehicleSnapshot {
  present: boolean
  sysid: number
  vehicleName: string
  vehicleType: number
  modeName: string
  customMode: number
  armed: boolean
  /** MAV_STATE from the heartbeat; CRITICAL/EMERGENCY mean failsafe. */
  systemStatus: number
  rollRad: number
  pitchRad: number
  yawRad: number
  latDeg: number
  lonDeg: number
  relAltM: number
  altMslM: number
  headingDeg: number
  groundspeedMs: number
  airspeedMs: number
  throttlePct: number
  climbMs: number
  batteryV: number
  batteryA: number
  batteryPct: number
  gpsFix: number
  gpsSats: number
  gpsHdop: number
  rcChannels: number[]
  /** RC receiver RSSI, 0-254. 255 (or -1 here) means the link does not report it. */
  rcRssi: number
  /** Raw SYS_STATUS masks; decoded for display by protocol/sensors.ts. */
  /**
   * The airframe the vehicle announced, when it is one we can draw.
   *
   * Part of the snapshot rather than a separate store because it is reset
   * with everything else: a different vehicle is a different aircraft.
   */
  airframe: KnownAirframe | null
  /**
   * Mission progress, as reported rather than inferred.
   *
   * The vehicle is the authority on which item it is flying: a plan uploaded
   * from this GCS can differ from the one aboard, and guessing from position
   * would be wrong exactly when it matters. Null means it has not said.
   */
  missionSeq: number | null
  wpDistM: number | null
  altErrorM: number | null
  sensorsPresent: number
  sensorsEnabled: number
  sensorsHealth: number
  /**
   * What the vehicle said about itself, once, in AUTOPILOT_VERSION.
   *
   * Null until it answers, and for anything that never does. The version
   * picks matching parameter metadata and decides which generation of the
   * mount protocol to speak.
   *
   * The capability bits are kept but deliberately not acted on. A real
   * flight controller reported no MAVFTP bit while serving files happily,
   * so a screen that believed them told someone their working feature did
   * not exist. What an operation actually answers is the only thing worth
   * gating on.
   */
  firmware: FirmwareVersion | null
  capabilities: number
  /**
   * Where the camera mount says it is pointed, or null when there is none.
   *
   * Null is the useful state: it is how the Fly screen tells a vehicle with
   * no gimbal from one whose gimbal is not answering.
   */
  gimbal: { rollDeg: number; pitchDeg: number; yawDeg: number } | null
  statusTexts: StatusText[]
}

const EMPTY: VehicleSnapshot = {
  present: false,
  sysid: 0,
  vehicleName: '',
  vehicleType: 0,
  modeName: '',
  customMode: 0,
  armed: false,
  systemStatus: 0,
  rollRad: 0,
  pitchRad: 0,
  yawRad: 0,
  latDeg: 0,
  lonDeg: 0,
  relAltM: 0,
  altMslM: 0,
  headingDeg: 0,
  groundspeedMs: 0,
  airspeedMs: 0,
  throttlePct: 0,
  climbMs: 0,
  batteryV: 0,
  batteryA: 0,
  batteryPct: -1,
  gpsFix: 0,
  gpsSats: 0,
  gpsHdop: 0,
  rcChannels: [],
  rcRssi: -1,
  airframe: null,
  missionSeq: null,
  wpDistM: null,
  altErrorM: null,
  sensorsPresent: 0,
  sensorsEnabled: 0,
  sensorsHealth: 0,
  firmware: null,
  capabilities: 0,
  gimbal: null,
  statusTexts: [],
}

interface VehicleStore extends VehicleSnapshot {
  apply: (patch: Partial<VehicleSnapshot>) => void
  appendStatusText: (st: StatusText) => void
  reset: () => void
}

const STATUSTEXT_CAP = 200

export const useVehicleStore = create<VehicleStore>((set) => ({
  ...EMPTY,
  apply: (patch) => set(patch),
  appendStatusText: (st) =>
    set((s) => ({
      statusTexts: [...s.statusTexts.slice(-(STATUSTEXT_CAP - 1)), st],
      // Latched rather than searched for later: the frame line arrives once,
      // in the boot banner, and the status feed is a capped ring that it
      // scrolls out of within a minute of a talkative vehicle.
      airframe: s.airframe ?? knownAirframe(frameName([st.text])),
    })),
  reset: () => set({ ...EMPTY, statusTexts: [] }),
}))
