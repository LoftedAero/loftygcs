// The virtual flight controller: a Transport that IS a simulated ArduPilot,
// emitting genuine MAVLink v2 bytes through the real encoder. It exists so
// the whole UI runs with no hardware -- demos, development, and component
// tests all drive exactly the code path a real vehicle does. It is NOT a
// substitute for SITL validation: it proves the app's plumbing, not
// ArduPilot's behavior.
import { MavFramer, encodeFrame } from '../protocol/frames'
import { decodeFrameFields } from '../protocol/serializer'
import { SENSOR_BITS } from '../protocol/sensors'
import type { FieldValue } from '../protocol/types'
import type { Transport, TransportOptions } from './Transport'

// A representative slice of an ArduCopter parameter set (name, value,
// MAV_PARAM_TYPE) so every configuration tab has real content in demo mode.
// Values are ArduCopter defaults where one exists. This is deliberately
// broad rather than deep: enough of each family that the curated tabs look
// like they will on hardware, without pretending to be all ~1400.
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
  ['INS_ACCEL_FILTER', 20, 9],
  ['INS_GYRO_FILTER', 20, 9],
  ['GPS_TYPE', 1, 2],

  // Radio
  ['RC1_MIN', 1100, 4],
  ['RC1_MAX', 1900, 4],
  ['RC1_TRIM', 1500, 4],
  ['RC2_MIN', 1100, 4],
  ['RC2_MAX', 1900, 4],
  ['RC3_MIN', 1100, 4],
  ['RC3_MAX', 1900, 4],
  ['RC4_MIN', 1100, 4],
  ['RC4_MAX', 1900, 4],
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
  ['OSD_TYPE', 0, 2],
  ['OSD_UNITS', 0, 2],
  ['OSD_MSG_TIME', 10, 2],
  ['OSD_W_BATVOLT', 14.4, 9],
  ['OSD_W_RSSI', 30, 2],
  ['OSD_W_NSAT', 9, 2],
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

// SITL's default home (CMAC field, Canberra) so numbers look familiar to
// anyone who has flown SITL.
const HOME_LAT = -35.363262
const HOME_LON = 149.165237
const HOME_ALT_M = 584

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
  private accelCalPositions = 0
  private airborne = false

  async open(_opts: TransportOptions): Promise<void> {
    this.t0 = Date.now()
    this.timers.push(setInterval(() => this.sendHeartbeat(), 1000))
    this.timers.push(setInterval(() => this.sendAttitude(), 100))
    this.timers.push(setInterval(() => this.sendPositionAndHud(), 250))
    this.timers.push(setInterval(() => this.sendStatusAndGps(), 1000))
    this.timers.push(setInterval(() => this.sendRcChannels(), 200))
    setTimeout(() => this.sendStatusText(6, 'Loft GCS virtual vehicle ready'), 300)
    // A little scripted life: arm and lift off into a lazy circle.
    setTimeout(() => {
      this.armed = true
      this.mode = 5 // Loiter
      this.sendStatusText(6, 'Arming motors')
    }, 5000)
    setTimeout(() => {
      if (this.armed) this.airborne = true
    }, 8000)
  }

  async close(): Promise<void> {
    for (const t of this.timers) clearInterval(t)
    this.timers = []
    if (this.magCalTimer) clearInterval(this.magCalTimer)
    this.magCalTimer = null
  }

  write(bytes: Uint8Array) {
    // The demo vehicle streams telemetry unconditionally but answers the
    // parameter protocol, so the Parameters tab is real in demo mode. It
    // deliberately has NO MAVFTP -- exercising the stream fallback path.
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
      }
    }
  }

  private handleCommand(command: number, param1: number, param2: number, param5: number) {
    const ack = (result = 0) =>
      this.emit('COMMAND_ACK', { command, result, progress: 0, resultParam2: 0, targetSystem: 255, targetComponent: 190 })

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
              completionMask: new Array(10).fill(0),
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
          // Walk the six sides the way AP_AccelCal does, in its wording --
          // the GCS is meant to read these prompts rather than assume an
          // order, so the demo has to actually speak them.
          this.accelCalPositions = 0
          setTimeout(() => this.sendStatusText(6, ACCEL_CAL_PROMPTS[0]!), 300)
        } else if (param5 === 2) {
          setTimeout(() => this.sendStatusText(6, 'Level horizon set'), 200)
        }
        return
      case 42429: // accel cal position captured
        ack()
        this.accelCalPositions++
        setTimeout(() => {
          const next = ACCEL_CAL_PROMPTS[this.accelCalPositions]
          if (next) this.sendStatusText(6, next)
          else this.sendStatusText(6, 'Calibration successful')
        }, 500)
        return
      case 176: // DO_SET_MODE: param2 is the custom mode
        this.mode = param2
        this.sendStatusText(6, `Mode change`)
        return ack()
      case 400: // ARM_DISARM
        this.armed = param1 === 1
        if (!this.armed) this.airborne = false
        this.sendStatusText(6, this.armed ? 'Arming motors' : 'Disarming motors')
        return ack()
      case 22: // NAV_TAKEOFF
        if (!this.armed) return ack(4) // FAILED, like the real thing
        this.airborne = true
        this.sendStatusText(6, 'Takeoff')
        return ack()
      default:
        return ack()
    }
  }

  private sendRcChannels() {
    const t = this.t()
    const wiggle = (base: number, amp: number, f: number) => Math.round(base + amp * Math.sin(t * f))
    this.emit('RC_CHANNELS', {
      timeBootMs: Math.round(t * 1000),
      chancount: 8,
      chan1Raw: wiggle(1500, 60, 0.7),
      chan2Raw: wiggle(1500, 40, 0.9),
      chan3Raw: this.flying() ? wiggle(1550, 30, 0.5) : 1100,
      chan4Raw: wiggle(1500, 20, 1.1),
      chan5Raw: 1800,
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
    const lonDeg = HOME_LON + (r * Math.sin(angle)) / (111320 * Math.cos((HOME_LAT * Math.PI) / 180))
    const relAlt = this.flying() ? 50 + 5 * Math.sin(t * 0.3) : 0
    const heading = this.flying() ? (((angle * 180) / Math.PI + 90) % 360 + 360) % 360 : 34
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
}
