// The virtual flight controller: a Transport that is a simulated ArduPilot,
// emitting real MAVLink v2 bytes through the real encoder, so the UI runs
// with no hardware for demos, development and component tests. It validates
// the app's plumbing, not ArduPilot's behavior; SITL does that.
//
// Some ArduPilot rules are modeled, but only ones observed on SITL, using
// the vehicle's own wording: a vehicle more permissive than the real one
// hides app bugs, and an invented rule teaches the app something ArduPilot
// never does.
//
// Deliberately not modeled: flight dynamics (SITL's job), MAVFTP (its
// absence exercises the parameter stream fallback), and the full parameter set.
import { MavFramer, encodeFrame } from '../protocol/frames'
import { decodeFrameFields } from '../protocol/serializer'
import { SENSOR_BITS } from '../protocol/sensors'
import type { FieldValue } from '../protocol/types'
import type { Transport, TransportOptions } from './Transport'

/**
 * Modes that will not engage without a position estimate: Auto, Guided,
 * Loiter, RTL. SITL refuses each of them by name.
 */
const NEEDS_POSITION = new Set([3, 4, 5, 6])

const MODE_LABEL: Record<number, string> = {
  3: 'Auto',
  4: 'Guided',
  5: 'Loiter',
  6: 'RTL',
}

/** How long the simulated EKF takes to produce a position estimate. */
const POSITION_READY_MS = 4000

/** How long a Copter sits armed on the ground before disarming itself. */
const GROUND_DISARM_MS = 10000

/**
 * The on-screen transmitter for demo mode, so radio calibration can be
 * exercised without hardware. Module state rather than a transport method,
 * since only the simulated vehicle uses it. Axes are -1..1; until `active`,
 * the channels show the idle wiggle.
 */
export const demoSticks = {
  active: false,
  roll: 0,
  pitch: 0,
  throttle: -1,
  yaw: 0,
  aux: 0.75,
}

// The OSD panels this simulated firmware "implements", with screen 1's
// default layout: id, column, row, and whether screen 1 shows it.
//
// A subset, as on a real build, so the editor's handling of missing panels
// is exercised. Enabled positions do not collide on the 30x16 analog grid.
export const OSD_PANELS: [string, number, number, boolean][] = [
  ['RSSI', 1, 1, true],
  ['HOME', 14, 1, true],
  ['BAT_VOLT', 24, 1, true],
  ['HEADING', 13, 2, true],
  ['CURRENT', 24, 2, true],
  ['SATS', 1, 3, true],
  ['COMPASS', 9, 3, true],
  ['BATUSED', 23, 3, true],
  ['HORIZON', 7, 5, true],
  ['ALTITUDE', 24, 8, true],
  ['WIND', 1, 9, true],
  ['VSPEED', 24, 9, true],
  ['ASPEED', 2, 10, true],
  ['GSPEED', 2, 11, true],
  ['THROTTLE', 24, 11, true],
  ['FLTMODE', 2, 13, true],
  ['FLTIME', 24, 13, true],
  ['MESSAGE', 2, 14, true],
  // Present but off, with the positions ArduPilot would ship them at.
  ['SIDEBARS', 4, 5, false],
  ['CRSSHAIR', 14, 8, false],
  ['ROLL', 1, 5, false],
  ['PITCH', 1, 6, false],
  ['XTRACK', 1, 7, false],
  ['DIST', 22, 4, false],
  ['GPSLAT', 9, 15, false],
  ['GPSLONG', 9, 14, false],
  ['HDOP', 1, 4, false],
  ['WAYPOINT', 22, 5, false],
  ['TER_HGT', 22, 6, false],
  ['RNGF', 22, 7, false],
  ['FENCE', 6, 3, false],
  ['CLK', 24, 15, false],
  ['CALLSIGN', 1, 15, false],
  ['TEMP', 22, 12, false],
  ['BAT2_VLT', 19, 1, false],
  ['BAT2USED', 16, 3, false],
  ['RESTVOLT', 19, 2, false],
  ['AVGCELLV', 19, 3, false],
  ['CURRENT2', 16, 2, false],
  ['ESCRPM', 1, 12, false],
  ['ESCTEMP', 1, 13, false],
  ['EFF', 21, 10, false],
  ['CLIMBEFF', 21, 11, false],
  ['STATS', 8, 5, false],
  ['LINK_Q', 5, 1, false],
  ['RSSIDBM', 5, 2, false],
  ['VTX_PWR', 22, 13, false],
  ['RPM', 1, 10, false],
]

// Four screens, switched by an RC channel. Only the first is enabled, as on a
// fresh vehicle.
const OSD_SCREEN_PARAMS = [1, 2, 3, 4].flatMap((s) => [
  [`OSD${s}_ENABLE`, s === 1 ? 1 : 0, 2],
  [`OSD${s}_CHAN_MIN`, 900 + (s - 1) * 300, 4],
  [`OSD${s}_CHAN_MAX`, 1200 + (s - 1) * 300, 4],
  [`OSD${s}_TXT_RES`, 0, 2],
  [`OSD${s}_FONT`, 0, 2],
  [`OSD${s}_ESC_IDX`, 0, 2],
  ...OSD_PANELS.flatMap(([id, x, y, on]) => [
    [`OSD${s}_${id}_EN`, s === 1 && on ? 1 : 0, 2],
    [`OSD${s}_${id}_X`, x, 2],
    [`OSD${s}_${id}_Y`, y, 2],
  ]),
]) as [string, number, number][]

// A representative slice of an ArduCopter parameter set (name, value,
// MAV_PARAM_TYPE) so every configuration tab has real content in demo mode.
// Values are ArduCopter defaults where one exists. Broad rather than deep:
// enough of each family for the curated tabs, not all ~1400.
const SIM_PARAMS: [string, number, number][] = [
  // Identity and frame
  ['SYSID_THISMAV', 1, 2],
  ['SYSID_MYGCS', 255, 2],
  ['FRAME_CLASS', 1, 2],
  ['FRAME_TYPE', 1, 2],
  ['AHRS_ORIENTATION', 0, 2],
  ['AHRS_EKF_TYPE', 3, 2],
  ['AHRS_TRIM_X', 0.0, 9],
  ['AHRS_TRIM_Y', 0.0, 9],
  ['EK3_ENABLE', 1, 2],

  // Serial ports: telemetry on 1/2, GPS on 3, spare on 4/5
  ['SERIAL0_PROTOCOL', 2, 2],
  ['SERIAL0_BAUD', 115, 4],
  ['SERIAL0_OPTIONS', 0, 4],
  ['SERIAL1_PROTOCOL', 2, 2],
  ['SERIAL1_BAUD', 57, 4],
  ['SERIAL1_OPTIONS', 0, 4],
  ['SERIAL2_PROTOCOL', 2, 2],
  ['SERIAL2_BAUD', 57, 4],
  ['SERIAL2_OPTIONS', 0, 4],
  ['SERIAL3_PROTOCOL', 5, 2],
  ['SERIAL3_BAUD', 38, 4],
  ['SERIAL3_OPTIONS', 0, 4],
  ['SERIAL4_PROTOCOL', 5, 2],
  ['SERIAL4_BAUD', 38, 4],
  ['SERIAL4_OPTIONS', 0, 4],
  ['SERIAL5_PROTOCOL', -1, 2],
  ['SERIAL5_BAUD', 115, 4],
  ['SERIAL5_OPTIONS', 0, 4],

  // Sensors
  ['COMPASS_USE', 1, 2],
  ['COMPASS_USE2', 1, 2],
  ['COMPASS_USE3', 0, 2],
  ['COMPASS_ORIENT', 0, 2],
  ['COMPASS_AUTODEC', 1, 2],
  // Device IDs for Hardware ID, in ArduPilot's encoding
  // (`bus_type:3, bus:5, address:8, devtype:8`) with plausible demo parts.
  // uint32 parameters, so mavType 6 (MAV_PARAM_TYPE_UINT32).
  // 0x34 ICM42688, SPI bus 1, CS 1.
  ['INS_ACC_ID', 0x340102 | 0x0a, 6],
  ['INS_GYR_ID', 0x340102 | 0x0a, 6],
  // 0x0A IST8310 at 0x0e on I2C bus 0.
  ['COMPASS_DEV_ID', 0x0a0e00 | 0x01, 6],
  // 0x06 DPS310 at 0x76 on I2C bus 0.
  ['BARO1_DEVID', 0x067600 | 0x01, 6],
  // Enough of the tuning set for the Tuning screen, at ArduCopter's own
  // defaults rather than invented gains.
  ['ATC_RAT_RLL_P', 0.135, 9],
  ['ATC_RAT_RLL_I', 0.135, 9],
  ['ATC_RAT_RLL_D', 0.0036, 9],
  ['ATC_RAT_RLL_FLTD', 20, 9],
  ['ATC_RAT_PIT_P', 0.135, 9],
  ['ATC_RAT_PIT_I', 0.135, 9],
  ['ATC_RAT_PIT_D', 0.0036, 9],
  ['ATC_RAT_PIT_FLTD', 20, 9],
  ['ATC_RAT_YAW_P', 0.18, 9],
  ['ATC_RAT_YAW_I', 0.018, 9],
  ['ATC_RAT_YAW_D', 0, 9],
  ['ATC_ANG_RLL_P', 4.5, 9],
  ['ATC_ANG_PIT_P', 4.5, 9],
  ['ATC_ANG_YAW_P', 4.5, 9],
  ['ATC_ACCEL_R_MAX', 110000, 9],
  ['ATC_ACCEL_P_MAX', 110000, 9],
  ['PSC_ACCZ_P', 0.25, 9],
  ['PSC_ACCZ_I', 0.5, 9],
  ['PSC_POSZ_P', 1, 9],
  ['PSC_POSXY_P', 1, 9],
  ['WPNAV_SPEED', 1000, 9],
  ['WPNAV_SPEED_UP', 250, 9],
  ['WPNAV_SPEED_DN', 150, 9],
  ['WPNAV_ACCEL', 250, 9],
  ['PILOT_SPEED_UP', 250, 9],
  ['PILOT_SPEED_DN', 150, 9],
  ['ANGLE_MAX', 3000, 9],
  ['AUTOTUNE_AXES', 7, 6],
  ['AUTOTUNE_AGGR', 0.075, 9],
  ['AUTOTUNE_MIN_D', 0.0005, 9],
  ['INS_ACCEL_FILTER', 20, 9],
  ['INS_GYRO_FILTER', 20, 9],
  ['GPS_TYPE', 1, 2],

  // Radio: the full per-channel set, since calibration writes MIN, MAX, TRIM
  // and REVERSED for each channel.
  ...([1, 2, 3, 4, 5, 6, 7, 8].flatMap((n) => [
    [`RC${n}_MIN`, 1100, 4],
    [`RC${n}_MAX`, 1900, 4],
    [`RC${n}_TRIM`, n === 3 ? 1100 : 1500, 4],
    [`RC${n}_REVERSED`, 0, 2],
    [`RC${n}_DZ`, n === 3 ? 30 : 20, 4],
  ]) as [string, number, number][]),
  ['RCMAP_ROLL', 1, 2],
  ['RCMAP_PITCH', 2, 2],
  ['RCMAP_THROTTLE', 3, 2],
  ['RCMAP_YAW', 4, 2],
  ['RC_PROTOCOLS', 1, 6],
  ['RC_OPTIONS', 0, 4],
  ['RC5_OPTION', 0, 2],
  ['RC6_OPTION', 0, 2],
  ['RC7_OPTION', 7, 2],
  ['RC8_OPTION', 0, 2],
  ['RC9_OPTION', 0, 2],
  ['RC10_OPTION', 0, 2],

  // Flight modes: the six switch slots
  ['FLTMODE_CH', 5, 2],
  ['FLTMODE1', 0, 2],
  ['FLTMODE2', 2, 2],
  ['FLTMODE3', 5, 2],
  ['FLTMODE4', 6, 2],
  ['FLTMODE5', 3, 2],
  ['FLTMODE6', 9, 2],
  ['SIMPLE', 0, 2],
  ['SUPER_SIMPLE', 0, 2],
  ['INITIAL_MODE', 0, 2],

  // Outputs: four motors on 1-4, spare servos on 5-8
  ...([1, 2, 3, 4, 5, 6, 7, 8].flatMap((n) => [
    [`SERVO${n}_FUNCTION`, n <= 4 ? 32 + n : 0, 4],
    [`SERVO${n}_MIN`, 1000, 4],
    [`SERVO${n}_TRIM`, 1500, 4],
    [`SERVO${n}_MAX`, 2000, 4],
    [`SERVO${n}_REVERSED`, 0, 2],
  ]) as [string, number, number][]),
  ['MOT_SPIN_ARM', 0.1, 9],
  ['MOT_SPIN_MIN', 0.15, 9],
  ['MOT_SPIN_MAX', 0.95, 9],
  ['MOT_PWM_TYPE', 0, 2],
  ['MOT_PWM_MIN', 1000, 4],
  ['MOT_PWM_MAX', 2000, 4],
  ['MOT_THST_EXPO', 0.65, 9],

  // Power
  ['BATT_MONITOR', 4, 2],
  ['BATT_CAPACITY', 5000, 6],
  ['BATT_VOLT_PIN', 13, 2],
  ['BATT_CURR_PIN', 12, 2],
  ['BATT_VOLT_MULT', 18.0, 9],
  ['BATT_AMP_PERVLT', 24.0, 9],
  ['BATT_AMP_OFFSET', 0.0, 9],
  ['BATT_LOW_VOLT', 14.0, 9],
  ['BATT_LOW_MAH', 0, 9],
  ['BATT_FS_LOW_ACT', 2, 2],
  ['BATT_CRT_VOLT', 13.2, 9],
  ['BATT_CRT_MAH', 0, 9],
  ['BATT_FS_CRT_ACT', 1, 2],
  ['BATT_LOW_TIMER', 10, 2],

  // Failsafes
  ['FS_THR_ENABLE', 1, 2],
  ['FS_THR_VALUE', 975, 4],
  ['FS_OPTIONS', 0, 6],
  ['FS_GCS_ENABLE', 1, 2],
  ['FS_GCS_TIMEOUT', 5, 9],
  ['FS_EKF_ACTION', 1, 2],
  ['FS_EKF_THRESH', 0.8, 9],
  ['FS_CRASH_CHECK', 1, 2],
  ['FS_VIBE_ENABLE', 1, 2],
  ['RTL_ALT', 3000, 4],
  ['RTL_ALT_FINAL', 0, 4],
  ['RTL_LOIT_TIME', 5000, 4],
  ['RTL_CLIMB_MIN', 0, 4],
  ['FENCE_ENABLE', 0, 2],
  ['FENCE_TYPE', 7, 2],
  ['FENCE_ACTION', 1, 2],
  ['FENCE_ALT_MAX', 100, 9],
  ['FENCE_RADIUS', 300, 9],
  ['FENCE_MARGIN', 2, 9],
  ['ARMING_CHECK', 1, 6],
  ['ARMING_RUDDER', 2, 2],
  ['DISARM_DELAY', 10, 2],

  // Tuning
  ['ATC_RAT_RLL_P', 0.135, 9],
  ['ATC_RAT_RLL_I', 0.135, 9],
  ['ATC_RAT_RLL_D', 0.0036, 9],
  ['ATC_RAT_RLL_FLTD', 20, 9],
  ['ATC_RAT_PIT_P', 0.135, 9],
  ['ATC_RAT_PIT_I', 0.135, 9],
  ['ATC_RAT_PIT_D', 0.0036, 9],
  ['ATC_RAT_PIT_FLTD', 20, 9],
  ['ATC_RAT_YAW_P', 0.18, 9],
  ['ATC_RAT_YAW_I', 0.018, 9],
  ['ATC_RAT_YAW_D', 0.0, 9],
  ['ATC_ANG_RLL_P', 4.5, 9],
  ['ATC_ANG_PIT_P', 4.5, 9],
  ['ATC_ANG_YAW_P', 4.5, 9],
  ['ATC_ACCEL_R_MAX', 110000, 9],
  ['ATC_ACCEL_P_MAX', 110000, 9],
  ['PSC_ACCZ_P', 0.5, 9],
  ['PSC_ACCZ_I', 1.0, 9],
  ['PSC_POSZ_P', 1.0, 9],
  ['PSC_POSXY_P', 1.0, 9],
  ['WPNAV_SPEED', 1000, 9],
  ['WPNAV_SPEED_UP', 250, 9],
  ['WPNAV_SPEED_DN', 150, 9],
  ['WPNAV_ACCEL', 250, 9],
  ['PILOT_SPEED_UP', 250, 4],
  ['PILOT_SPEED_DN', 0, 4],
  ['ANGLE_MAX', 3000, 6],
  ['LOIT_SPEED', 1250, 9],
  ['AUTOTUNE_AXES', 7, 2],
  ['AUTOTUNE_AGGR', 0.1, 9],
  ['AUTOTUNE_MIN_D', 0.001, 9],

  // OSD
  ['OSD_TYPE', 1, 2], // MAX7456: an analog 30x16 screen, as most boards have
  ['OSD_UNITS', 0, 2],
  ['OSD_MSG_TIME', 10, 2],
  ['OSD_SW_METHOD', 0, 2],
  ['OSD_OPTIONS', 0, 4],
  ['OSD_W_BATVOLT', 14.4, 9],
  ['OSD_W_RSSI', 30, 2],
  ['OSD_W_NSAT', 9, 2],
  ...OSD_SCREEN_PARAMS,
]

// What a healthy simulated copter reports as fitted, enabled and well.
const SIM_SENSORS =
  SENSOR_BITS.gyro |
  SENSOR_BITS.accel |
  SENSOR_BITS.mag |
  SENSOR_BITS.baro |
  SENSOR_BITS.gps |
  SENSOR_BITS.rcReceiver |
  SENSOR_BITS.battery |
  SENSOR_BITS.ahrs |
  SENSOR_BITS.logging |
  SENSOR_BITS.prearm

// AP_AccelCal's prompts, verbatim, in the order the firmware asks.
const ACCEL_CAL_PROMPTS = [
  'Place vehicle level and press any key.',
  'Place vehicle on its LEFT side and press any key.',
  'Place vehicle on its RIGHT side and press any key.',
  'Place vehicle nose DOWN and press any key.',
  'Place vehicle nose UP and press any key.',
  'Place vehicle on its BACK and press any key.',
]

// SITL's default home (CMAC field, Canberra).
const HOME_LAT = -35.363262
const HOME_LON = 149.165237
const HOME_ALT_M = 584

/** Home, takeoff, a small box of waypoints, and RTL, as wire-shaped fields. */
function demoMission(): Record<string, FieldValue>[] {
  const wp = (
    seq: number,
    command: number,
    lat: number,
    lon: number,
    alt: number,
    over: Record<string, FieldValue> = {},
  ): Record<string, FieldValue> => ({
    seq,
    frame: seq === 0 ? 0 : 3,
    command,
    current: seq === 0 ? 1 : 0,
    autocontinue: 1,
    param1: 0,
    param2: 0,
    param3: 0,
    param4: 0,
    x: Math.round(lat * 1e7),
    y: Math.round(lon * 1e7),
    z: alt,
    missionType: 0,
    ...over,
  })
  const d = 0.0012
  return [
    wp(0, 16, HOME_LAT, HOME_LON, HOME_ALT_M),
    wp(1, 22, 0, 0, 40), // NAV_TAKEOFF
    wp(2, 16, HOME_LAT + d, HOME_LON - d, 50),
    wp(3, 16, HOME_LAT + d, HOME_LON + d, 60),
    wp(4, 16, HOME_LAT - d, HOME_LON + d, 60),
    wp(5, 16, HOME_LAT - d, HOME_LON - d, 50),
    wp(6, 20, 0, 0, 0), // NAV_RETURN_TO_LAUNCH
  ]
}

/**
 * A deterministic completion mask for a simulated calibration at `pct`,
 * scattered by a stride coprime with 80 so sections fill all over the sphere.
 */
function magCalMask(pct: number): number[] {
  const mask = new Array<number>(10).fill(0)
  const filled = Math.min(80, Math.round((80 * pct) / 100))
  for (let n = 0; n < filled; n++) {
    const section = (n * 31) % 80
    mask[Math.floor(section / 8)]! |= 1 << (section % 8)
  }
  return mask
}

export class VirtualFcTransport implements Transport {
  readonly kind = 'virtual' as const
  private dataCb: ((bytes: Uint8Array) => void) | null = null
  private timers: ReturnType<typeof setInterval>[] = []
  private seq = 0
  private t0 = 0
  private armed = false
  private mode = 0 // Stabilize, then Loiter once "flying"
  private rxFramer = new MavFramer()
  private params = new Map(SIM_PARAMS.map(([n, v, t]) => [n, { value: v, mavType: t }]))
  private magCalTimer: ReturnType<typeof setInterval> | null = null
  /** Running while an accelerometer calibration is waiting for a side. */
  private accelCalTimer: ReturnType<typeof setInterval> | null = null
  private accelCalPositions = 0
  private airborne = false
  // Stored mission (item 0 = home), fence and rally, keyed by mission_type,
  // so all three plan screens exercise the full transfer protocol in demo mode.
  private plans: Record<number, Record<string, FieldValue>[]> = {
    0: demoMission(),
    1: [],
    2: [],
  }
  /** Non-null while a GCS upload is in progress: items land here first. */
  private missionRx: {
    total: number
    missionType: number
    items: Record<string, FieldValue>[]
  } | null = null

  /**
   * Whether the EKF has a position estimate. Until then ArduPilot refuses
   * arming ("Arm: Need Position Estimate") and position modes ("Mode change
   * to Guided failed: requires position"). On SITL this takes most of a
   * minute; the demo compresses it to a few seconds.
   */
  private positionOk = false
  /** When the vehicle last became armed, for the ground disarm timer. */
  private armedAt = 0

  async open(_opts: TransportOptions): Promise<void> {
    this.t0 = Date.now()
    this.timers.push(setInterval(() => this.sendHeartbeat(), 1000))
    this.timers.push(setInterval(() => this.sendAttitude(), 100))
    this.timers.push(setInterval(() => this.sendPositionAndHud(), 250))
    this.timers.push(setInterval(() => this.sendStatusAndGps(), 1000))
    this.timers.push(setInterval(() => this.sendRcChannels(), 200))
    this.timers.push(setInterval(() => this.sendTraffic(), 1000))
    setTimeout(() => this.sendStatusText(6, 'Loft GCS virtual vehicle ready'), 300)
    // The EKF settling, compressed. Until then arming and position modes are refused.
    setTimeout(() => {
      this.positionOk = true
      this.sendStatusText(6, 'EKF3 IMU0 is using GPS')
    }, POSITION_READY_MS)
    // Scripted demo flight: arm and circle. Set directly rather than through
    // the command path, but only after the EKF has settled.
    setTimeout(() => {
      this.armed = true
      this.armedAt = Date.now()
      this.mode = 5 // Loiter
      this.sendStatusText(6, 'Arming motors')
    }, 5000)
    setTimeout(() => {
      if (this.armed) this.airborne = true
    }, 8000)
    // Copter disarms itself after sitting armed on the ground.
    this.timers.push(
      setInterval(() => {
        if (this.armed && !this.airborne && Date.now() - this.armedAt > GROUND_DISARM_MS) {
          this.armed = false
          this.sendStatusText(6, 'Disarming motors')
        }
      }, 500),
    )
  }

  async close(): Promise<void> {
    for (const t of this.timers) clearInterval(t)
    this.timers = []
    if (this.magCalTimer) clearInterval(this.magCalTimer)
    this.magCalTimer = null
    if (this.accelCalTimer) clearInterval(this.accelCalTimer)
    this.accelCalTimer = null
  }

  write(bytes: Uint8Array) {
    // Telemetry streams unconditionally; the parameter protocol is answered.
    // No MAVFTP, so the parameter stream fallback is exercised.
    for (const frame of this.rxFramer.push(bytes)) {
      const decoded = decodeFrameFields(frame.msgid, frame.payload)
      if (!decoded) continue
      if (decoded.msgName === 'PARAM_REQUEST_LIST') {
        let index = 0
        for (const [name, p] of this.params) this.sendParamValue(name, p, index++)
      } else if (decoded.msgName === 'PARAM_REQUEST_READ') {
        const name = (decoded.fields.paramId as string).trim()
        const p = this.params.get(name)
        if (p) this.sendParamValue(name, p, [...this.params.keys()].indexOf(name))
      } else if (decoded.msgName === 'PARAM_SET') {
        const name = (decoded.fields.paramId as string).trim()
        const p = this.params.get(name)
        if (p) {
          p.value = decoded.fields.paramValue as number
          this.sendParamValue(name, p, 65535)
        }
      } else if (decoded.msgName === 'COMMAND_LONG') {
        this.handleCommand(
          decoded.fields.command as number,
          decoded.fields._param1 as number,
          decoded.fields._param2 as number,
          decoded.fields._param5 as number,
        )
      } else if (
        decoded.msgName === 'MISSION_REQUEST_LIST' ||
        decoded.msgName === 'MISSION_REQUEST_INT' ||
        decoded.msgName === 'MISSION_COUNT' ||
        decoded.msgName === 'MISSION_ITEM_INT' ||
        decoded.msgName === 'MISSION_CLEAR_ALL' ||
        decoded.msgName === 'MISSION_ACK'
      ) {
        this.handleMission(decoded.msgName, decoded.fields)
      }
    }
  }

  /**
   * The vehicle side of mission transfer, for all three plans.
   *
   * Parameterized by mission_type, like MissionClient, so fence and rally
   * use the same count/request/ack exchange as the mission.
   */
  private handleMission(msgName: string, fields: Record<string, FieldValue>) {
    const missionType = (fields.missionType as number) ?? 0
    const ack = (type: number) =>
      this.emit('MISSION_ACK', {
        targetSystem: 255,
        targetComponent: 190,
        type,
        missionType,
      })
    const plan = this.plans[missionType]
    if (!plan) {
      if (msgName !== 'MISSION_ACK') ack(3) // MAV_MISSION_UNSUPPORTED
      return
    }

    if (msgName === 'MISSION_REQUEST_LIST') {
      this.emit('MISSION_COUNT', {
        targetSystem: 255,
        targetComponent: 190,
        count: plan.length,
        missionType,
      })
    } else if (msgName === 'MISSION_REQUEST_INT') {
      const item = plan[fields.seq as number]
      if (item) {
        this.emit('MISSION_ITEM_INT', {
          ...item,
          missionType,
          targetSystem: 255,
          targetComponent: 190,
        })
      } else ack(13) // MAV_MISSION_INVALID_SEQUENCE
    } else if (msgName === 'MISSION_COUNT') {
      const total = fields.count as number
      if (total === 0) {
        this.plans[missionType] = []
        ack(0)
        return
      }
      this.missionRx = { total, missionType, items: [] }
      this.emit('MISSION_REQUEST_INT', {
        targetSystem: 255,
        targetComponent: 190,
        seq: 0,
        missionType,
      })
    } else if (msgName === 'MISSION_ITEM_INT') {
      const rx = this.missionRx
      if (!rx || rx.missionType !== missionType) return
      if ((fields.seq as number) === rx.items.length) rx.items.push(fields)
      if (rx.items.length >= rx.total) {
        // The upload replaces the stored plan wholesale, as ArduPilot's does.
        this.plans[missionType] = rx.items
        this.missionRx = null
        ack(0)
      } else {
        this.emit('MISSION_REQUEST_INT', {
          targetSystem: 255,
          targetComponent: 190,
          seq: rx.items.length,
          missionType,
        })
      }
    } else if (msgName === 'MISSION_CLEAR_ALL') {
      this.plans[missionType] = []
      ack(0)
    }
    // MISSION_ACK from the GCS ends a download; nothing to do.
  }

  private handleCommand(command: number, param1: number, param2: number, param5: number) {
    const ack = (result = 0) =>
      this.emit('COMMAND_ACK', {
        command,
        result,
        progress: 0,
        resultParam2: 0,
        targetSystem: 255,
        targetComponent: 190,
      })

    switch (command) {
      case 42424: {
        // Start mag cal: scripted coverage climb, then a clean report.
        ack()
        let pct = 0
        if (this.magCalTimer) clearInterval(this.magCalTimer)
        this.magCalTimer = setInterval(() => {
          pct += 7
          if (pct < 100) {
            this.emit('MAG_CAL_PROGRESS', {
              compassId: 0,
              calMask: 1,
              calStatus: 3, // RUNNING_STEP_TWO
              attempt: 1,
              completionPct: pct,
              // ArduPilot derives the percentage from this coverage mask, so
              // it must be consistent with completionPct.
              completionMask: magCalMask(pct),
              // ArduPilot's `mavlink_msg_mag_cal_progress_send` passes 0.0f
              // for all three direction fields.
              directionX: 0,
              directionY: 0,
              directionZ: 0,
            })
          } else {
            if (this.magCalTimer) clearInterval(this.magCalTimer)
            this.magCalTimer = null
            this.emit('MAG_CAL_REPORT', {
              compassId: 0,
              calMask: 1,
              calStatus: 4, // SUCCESS
              autosaved: 1,
              fitness: 7.4,
              ofsX: 12.1,
              ofsY: -3.4,
              ofsZ: 8.8,
              diagX: 1,
              diagY: 1,
              diagZ: 1,
              offdiagX: 0,
              offdiagY: 0,
              offdiagZ: 0,
              orientationConfidence: 1,
              oldOrientation: 0,
              newOrientation: 0,
              scaleFactor: 1,
            })
          }
        }, 400)
        return
      }
      case 42426: // cancel mag cal
        if (this.magCalTimer) clearInterval(this.magCalTimer)
        this.magCalTimer = null
        return ack()
      case 241: // preflight calibration
        ack()
        if (param5 === 1) {
          // A start while one is running does nothing: `AP_AccelCal::start`
          // returns on `_started` and the handler acks anyway. There is no
          // MAVLink cancel.
          if (this.accelCalTimer) return
          // Walk the six sides in AP_AccelCal's order and wording.
          this.accelCalPositions = 0
          setTimeout(() => this.sendStatusText(6, ACCEL_CAL_PROMPTS[0]!), 300)
          // The text is sent once per side; the position request repeats
          // every second, which is what lets a GCS rejoin a run.
          this.accelCalTimer = setInterval(() => this.askAccelPosition(), 1000)
          setTimeout(() => this.askAccelPosition(), 300)
        } else if (param5 === 2) {
          setTimeout(() => this.sendStatusText(6, 'Level horizon set'), 200)
        }
        return
      case 42429: // accel cal position captured
        ack()
        this.accelCalPositions++
        setTimeout(() => {
          const next = ACCEL_CAL_PROMPTS[this.accelCalPositions]
          if (next) {
            this.sendStatusText(6, next)
            this.askAccelPosition()
          } else {
            if (this.accelCalTimer) clearInterval(this.accelCalTimer)
            this.accelCalTimer = null
            this.sendStatusText(6, 'Calibration successful')
          }
        }, 500)
        return
      case 176: {
        // DO_SET_MODE: param2 is the custom mode. Position modes are refused
        // until the EKF has a position, with ack 4 plus ArduPilot's STATUSTEXT.
        if (NEEDS_POSITION.has(param2) && !this.positionOk) {
          this.sendStatusText(
            4,
            `Mode change to ${MODE_LABEL[param2] ?? param2} failed: requires position`,
          )
          return ack(4)
        }
        this.mode = param2
        this.sendStatusText(6, 'Mode change')
        // Auto on the ground sits at the takeoff item: Copter waits for a
        // throttle raise before starting the mission.
        if (param2 === 3 && !this.airborne) this.sendStatusText(6, 'Mission: 1 Takeoff')
        return ack()
      }
      case 400: // ARM_DISARM
        if (param1 === 1) {
          if (!this.positionOk) {
            this.sendStatusText(4, 'Arm: Need Position Estimate')
            return ack(4)
          }
          this.armed = true
          this.armedAt = Date.now()
        } else {
          this.armed = false
          this.airborne = false
        }
        this.sendStatusText(6, this.armed ? 'Arming motors' : 'Disarming motors')
        return ack()
      case 22: // NAV_TAKEOFF
        if (!this.armed) return ack(4) // FAILED
        // Copter only accepts a takeoff command in Guided.
        if (this.mode !== 4) {
          this.sendStatusText(4, 'Takeoff failed: not in Guided')
          return ack(4)
        }
        this.airborne = true
        this.sendStatusText(6, 'Takeoff')
        return ack()
      default:
        return ack()
    }
  }

  /**
   * Two aircraft passing the field, as ADSB_VEHICLE. Rate, units and flags
   * follow SITL's SIM_ADSB (`npm run sitl -- --adsb`). The second aircraft
   * has no altitude or callsign, so the display's null paths are exercised.
   */
  private sendTraffic() {
    const t = this.t()
    // About a kilometer north of home, crossing in opposite directions, one
    // above and one below the demo vehicle's circuit.
    const send = (
      icao: number,
      bearingDeg: number,
      km: number,
      altM: number,
      callsign: string | null,
      headingDeg: number,
    ) => {
      const rad = (bearingDeg * Math.PI) / 180
      const north = km * 1000 * Math.cos(rad)
      const east = km * 1000 * Math.sin(rad)
      const latDeg = HOME_LAT + north / 111320
      const lonDeg = HOME_LON + east / (111320 * Math.cos((HOME_LAT * Math.PI) / 180))
      // VALID_COORDS | VALID_HEADING | VALID_VELOCITY | VERTICAL_VELOCITY,
      // plus altitude and callsign only for the aircraft that has them.
      const flags = 1 | 4 | 8 | 128 | (callsign ? 2 | 16 | 32 : 0)
      this.emit('ADSB_VEHICLE', {
        ICAOAddress: icao,
        lat: Math.round(latDeg * 1e7),
        lon: Math.round(lonDeg * 1e7),
        altitudeType: 0,
        // Millimeters.
        altitude: Math.round(altM * 1000),
        heading: Math.round(headingDeg * 100),
        horVelocity: 4000,
        verVelocity: 0,
        callsign: callsign ?? '',
        emitterType: callsign ? 1 : 7,
        tslc: 1,
        flags,
        squawk: 1200,
      })
    }
    // Moving targets, so the display has to keep up.
    const drift = (t * 0.6) % 360
    send(0xa1b2c3, (20 + drift) % 360, 1.2, HOME_ALT_M + 250, 'N172SP', (110 + drift) % 360)
    send(0x4ca1f0, (200 - drift + 360) % 360, 0.9, HOME_ALT_M + 40, null, (290 - drift + 360) % 360)
  }

  private sendRcChannels() {
    const t = this.t()
    const wiggle = (base: number, amp: number, f: number) =>
      Math.round(base + amp * Math.sin(t * f))
    // The on-screen sticks replace the idle wiggle, which would confuse radio
    // calibration's detection of the moved channel.
    const s = demoSticks.active ? demoSticks : null
    const stick = (axis: number, reversed = false) =>
      Math.round(1500 + (reversed ? -1 : 1) * 400 * axis)
    this.emit('RC_CHANNELS', {
      timeBootMs: Math.round(t * 1000),
      chancount: 8,
      chan1Raw: s ? stick(s.roll) : wiggle(1500, 60, 0.7),
      // Pitch reversed on purpose, as is common, so calibration has a
      // reversal to detect.
      chan2Raw: s ? stick(s.pitch, true) : wiggle(1500, 40, 0.9),
      chan3Raw: s ? stick(s.throttle) : this.flying() ? wiggle(1550, 30, 0.5) : 1100,
      chan4Raw: s ? stick(s.yaw) : wiggle(1500, 20, 1.1),
      chan5Raw: s ? stick(s.aux) : 1800,
      chan6Raw: 1100,
      chan7Raw: 1500,
      chan8Raw: 1500,
      chan9Raw: 0,
      chan10Raw: 0,
      chan11Raw: 0,
      chan12Raw: 0,
      chan13Raw: 0,
      chan14Raw: 0,
      chan15Raw: 0,
      chan16Raw: 0,
      chan17Raw: 0,
      chan18Raw: 0,
      rssi: 210,
    })
  }

  private sendParamValue(name: string, p: { value: number; mavType: number }, index: number) {
    this.emit('PARAM_VALUE', {
      paramId: name,
      paramValue: p.value,
      paramType: p.mavType,
      paramCount: this.params.size,
      paramIndex: index,
    })
  }

  onData(cb: (bytes: Uint8Array) => void) {
    this.dataCb = cb
  }

  onClose(_cb: (reason?: string) => void) {
    // The virtual vehicle never disconnects on its own.
  }

  private emit(msgName: string, fields: Record<string, FieldValue>) {
    this.dataCb?.(encodeFrame(msgName, fields, this.seq++ & 0xff, 1, 1))
  }

  /** Seconds since connect; drives every waveform so they stay coherent. */
  private t(): number {
    return (Date.now() - this.t0) / 1000
  }

  private flying(): boolean {
    return this.armed && this.airborne
  }

  private sendHeartbeat() {
    this.emit('HEARTBEAT', {
      type: 2, // MAV_TYPE_QUADROTOR
      autopilot: 3, // MAV_AUTOPILOT_ARDUPILOTMEGA
      baseMode: 81 | (this.armed ? 128 : 0), // custom mode + optionally SAFETY_ARMED
      customMode: this.mode,
      systemStatus: this.armed ? 4 : 3, // ACTIVE : STANDBY
      mavlinkVersion: 3,
    })
  }

  private sendAttitude() {
    const t = this.t()
    const bank = this.flying() ? 0.12 : 0.01
    this.emit('ATTITUDE', {
      timeBootMs: Math.round(t * 1000),
      roll: bank * Math.sin(t * 0.9),
      pitch: 0.04 * Math.sin(t * 0.6),
      yaw: this.flying() ? (t * 0.1) % (2 * Math.PI) : 0.3,
      rollspeed: 0,
      pitchspeed: 0,
      yawspeed: this.flying() ? 0.1 : 0,
    })
  }

  private sendPositionAndHud() {
    const t = this.t()
    // A 120 m radius circle at ~12 m/s once flying; parked before that.
    const r = this.flying() ? 120 : 0
    const angle = t * 0.1
    const latDeg = HOME_LAT + ((r * Math.cos(angle)) / 111320) * 1
    const lonDeg =
      HOME_LON + (r * Math.sin(angle)) / (111320 * Math.cos((HOME_LAT * Math.PI) / 180))
    const relAlt = this.flying() ? 50 + 5 * Math.sin(t * 0.3) : 0
    const heading = this.flying() ? ((((angle * 180) / Math.PI + 90) % 360) + 360) % 360 : 34
    this.emit('GLOBAL_POSITION_INT', {
      timeBootMs: Math.round(t * 1000),
      lat: Math.round(latDeg * 1e7),
      lon: Math.round(lonDeg * 1e7),
      alt: Math.round((HOME_ALT_M + relAlt) * 1000),
      relativeAlt: Math.round(relAlt * 1000),
      vx: 0,
      vy: 0,
      vz: 0,
      hdg: Math.round(heading * 100),
    })
    this.emit('VFR_HUD', {
      airspeed: this.flying() ? 12 : 0,
      groundspeed: this.flying() ? 12 : 0,
      heading: Math.round(heading),
      throttle: this.flying() ? 55 : 0,
      alt: HOME_ALT_M + relAlt,
      climb: this.flying() ? 5 * 0.3 * Math.cos(t * 0.3) : 0,
    })
  }

  private sendStatusAndGps() {
    const t = this.t()
    // 4S pack sagging gently under load; never below a plausible floor.
    const voltage = Math.max(13.8, 16.8 - t * 0.01 - (this.flying() ? 0.6 : 0))
    this.emit('SYS_STATUS', {
      // A healthy airframe's sensor set, so the Overview's sensor list has
      // something real to decode.
      onboardControlSensorsPresent: SIM_SENSORS,
      onboardControlSensorsEnabled: SIM_SENSORS,
      onboardControlSensorsHealth: SIM_SENSORS,
      load: 320,
      voltageBattery: Math.round(voltage * 1000),
      currentBattery: this.flying() ? 1450 : 80, // cA
      batteryRemaining: Math.max(0, Math.round(100 - t * 0.05)),
      dropRateComm: 0,
      errorsComm: 0,
      errorsCount1: 0,
      errorsCount2: 0,
      errorsCount3: 0,
      errorsCount4: 0,
    })
    this.emit('GPS_RAW_INT', {
      timeUsec: BigInt(Math.round(t * 1e6)),
      fixType: 3,
      lat: Math.round(HOME_LAT * 1e7),
      lon: Math.round(HOME_LON * 1e7),
      alt: Math.round(HOME_ALT_M * 1000),
      eph: 121,
      epv: 200,
      vel: 0,
      cog: 0,
      satellitesVisible: 14,
    })
  }

  private sendStatusText(severity: number, text: string) {
    this.emit('STATUSTEXT', { severity, text })
  }

  /**
   * Asks the GCS for the next side, as ArduPilot's
   * `send_accelcal_vehicle_position` does: a broadcast COMMAND_LONG carrying
   * MAV_CMD_ACCELCAL_VEHICLE_POS with the step in param1, repeated every
   * second while waiting.
   */
  private askAccelPosition() {
    this.emit('COMMAND_LONG', {
      targetSystem: 0,
      targetComponent: 0,
      command: 42429,
      confirmation: 0,
      // mavlink-mappings names it `_param1`. The encoder accepts any key, so
      // `param1` would silently send zero.
      _param1: this.accelCalPositions + 1,
      _param2: 0,
      _param3: 0,
      _param4: 0,
      _param5: 0,
      _param6: 0,
      _param7: 0,
    })
  }
}
