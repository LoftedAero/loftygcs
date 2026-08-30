import { create } from 'zustand'

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
  sensorsPresent: number
  sensorsEnabled: number
  sensorsHealth: number
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
  sensorsPresent: 0,
  sensorsEnabled: 0,
  sensorsHealth: 0,
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
    set((s) => ({ statusTexts: [...s.statusTexts.slice(-(STATUSTEXT_CAP - 1)), st] })),
  reset: () => set({ ...EMPTY, statusTexts: [] }),
}))
