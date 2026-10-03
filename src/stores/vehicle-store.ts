import { create } from 'zustand'
import { frameName, knownAirframe, type KnownAirframe } from '../protocol/airframe'
import { boardNameFromBanner, parseRcoutBanner, type RcoutBanner } from '../protocol/rcout-banner'
import type { FirmwareVersion } from '../protocol/types'

// Throttled snapshot of vehicle state for ordinary React components (mode
// label, battery readout, GPS badge). The connection service pushes here at
// a few Hz; anything that needs full rate reads the telemetry rings instead.

export interface StatusText {
  severity: number
  text: string
  at: number
}

/** One monitor's reading: volts or null, amps and percent with -1 for unmeasured. */
export interface BatteryReading {
  voltageV: number | null
  currentA: number
  remainingPct: number
  /** MAV_BATTERY_CHARGE_STATE; 0 when the vehicle does not set it. */
  chargeState: number
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
  /**
   * Each monitor's reading from BATTERY_STATUS, keyed by instance (0 is
   * BATT_, 1 is BATT2_). The three fields above are SYS_STATUS's primary,
   * which the app bar and HUD read.
   */
  batteries: Record<number, BatteryReading>
  gpsFix: number
  gpsSats: number
  gpsHdop: number
  rcChannels: number[]
  /** RC receiver RSSI, 0-254. 255 (or -1 here) means the link does not report it. */
  rcRssi: number
  /**
   * Output values from SERVO_OUTPUT_RAW, index 0 is SERVO1. Empty until the
   * message first arrives, then 32 long; 0 is an output with nothing on it.
   */
  servoOutputsUs: number[]
  /** The airframe the vehicle announced, when it is one we can draw. */
  airframe: KnownAirframe | null
  /**
   * Which outputs the board drives and how, from the boot banner. Only
   * ChibiOS builds print it, so SITL leaves it null.
   */
  rcout: RcoutBanner | null
  /**
   * `CHIBIOS_SHORT_BOARD_NAME`, from the boot banner. This, not
   * `APJ_BOARD_ID`, identifies the output timer groups: 44 board ids are
   * shared by boards with different pinouts.
   */
  boardName: string | null
  /**
   * Mission progress as the vehicle reports it; the plan aboard can differ
   * from the one on screen. Null until reported.
   */
  missionSeq: number | null
  wpDistM: number | null
  altErrorM: number | null
  /** Raw SYS_STATUS masks; decoded for display by protocol/sensors.ts. */
  sensorsPresent: number
  sensorsEnabled: number
  sensorsHealth: number
  /**
   * From AUTOPILOT_VERSION; null until the vehicle answers. The version
   * selects parameter metadata and the mount protocol generation.
   *
   * Capability bits are kept but not acted on: real flight controllers have
   * served MAVFTP without setting the FTP bit.
   */
  firmware: FirmwareVersion | null
  capabilities: number
  /**
   * ArduPilot's `APJ_BOARD_ID`, or 0 when not reported (SITL never reports
   * it; it is a ChibiOS build constant).
   */
  boardId: number
  /**
   * Where the camera mount says it is pointed, or null when there is none.
   * Lets the Fly screen tell a vehicle with no gimbal from one whose gimbal
   * is not answering.
   */
  gimbal: { rollDeg: number; pitchDeg: number; yawDeg: number } | null
  /** Where the vehicle will return to, or null until it reports one. */
  home: { latDeg: number; lonDeg: number; altMslM: number } | null
  /** MAV_LANDED_STATE (0 unknown, 1 on the ground, 2 in the air, 3 taking off, 4 landing). */
  landedState: number
  /** The fence's state, or null when the vehicle has sent none (no fence enabled). */
  fence: { breached: boolean; breachType: number } | null
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
  batteries: {},
  gpsFix: 0,
  gpsSats: 0,
  gpsHdop: 0,
  rcChannels: [],
  rcRssi: -1,
  servoOutputsUs: [],
  airframe: null,
  rcout: null,
  boardName: null,
  missionSeq: null,
  wpDistM: null,
  altErrorM: null,
  sensorsPresent: 0,
  sensorsEnabled: 0,
  sensorsHealth: 0,
  firmware: null,
  capabilities: 0,
  boardId: 0,
  gimbal: null,
  home: null,
  landedState: 0,
  fence: null,
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
      // Latched: the frame line arrives once, in the boot banner, and soon
      // scrolls out of the capped status ring.
      airframe: s.airframe ?? knownAirframe(frameName([st.text])),
      // Replaced rather than latched: a reboot re-sends it and may change the
      // output modes. Other lines parse to null and leave it alone.
      rcout: parseRcoutBanner(st.text) ?? s.rcout,
      boardName: boardNameFromBanner(st.text) ?? s.boardName,
    })),
  reset: () => set({ ...EMPTY, statusTexts: [] }),
}))
