// What to say, decided from changes in the vehicle's state. Pure logic over
// snapshots and a clock passed in, so every rule is tested without a vehicle.
//
// The rules follow what Yaapu Telemetry and QGroundControl learned:
// - Say a crossing, never a running value. Battery steps only go down, and a
//   battery state is said only when it gets worse than what was last said.
// - Say a mode once it has held for half a second, so a flicked switch is
//   said where it landed.
// - Repeat only what is still true, at the user's interval, and only while
//   flying.
// - Never speak ArduPilot's PreArm repeats on their own schedule; a refused
//   arm says its reason once.

import type { AdsbTarget } from '../../protocol/adsb'
import { distanceM } from '../../protocol/adsb'
import { isPrearmMessage } from '../../protocol/prearm'
import { SENSOR_BITS } from '../../protocol/sensors'
import { vehicleClass } from '../../protocol/modes'
import type { StatusText, VehicleSnapshot } from '../../stores/vehicle-store'
import { isClose, relativeTo } from '../../stores/traffic-store'
import type { UnitPrefs } from '../../units'
import type { BeepKind, CalloutId } from './catalog'
import {
  clockWords,
  distanceWords,
  forSpeech,
  heightWords,
  modeWords,
  speedWords,
} from './speech-text'

export interface Emission {
  id: CalloutId
  text: string
  /** Queue key; defaults to the id, so one waiting copy of each callout. */
  key?: string
  /** A beep other than the row's own (a failed transfer warns). */
  beep?: BeepKind
}

export interface WatchInput {
  /** Whether the link is up; repeats and vehicle rules pause while it is not. */
  phase: string
  v: VehicleSnapshot
  traffic: readonly AdsbTarget[]
}

export interface WatchConfig {
  units: UnitPrefs
  /** A row's threshold, in the catalog's units. */
  value(id: CalloutId): number
  /** Seconds between repeats of an alert still true; 0 never. */
  repeatS: number
}

export type AppEvent =
  | { t: 'arm-refused' }
  | { t: 'mode-refused' }
  | { t: 'joystick' }
  | { t: 'params' }
  | { t: 'transfer'; what: string; dir: 'write' | 'read'; ok: boolean }
  | { t: 'video' }

/** How long a mode must hold before it is said. */
const MODE_SETTLE_MS = 500
/** How long a refused arm's reason may precede the refusal. */
const REASON_WINDOW_MS = 4000
/** The same message text is said at most once in this long. */
const MESSAGE_GAP_MS = 10000
/** A failsafe message this recent makes the failsafe state's own callout redundant. */
const FAILSAFE_TEXT_FRESH_MS = 5000
/** How long a value must stay past a cell-voltage or airspeed limit. */
const SUSTAIN_MS = { 'batt-cell': 4000, 'low-airspeed': 2000 } as const
/**
 * How long after connecting the state is taken as found rather than said.
 * The heartbeat arrives before the other messages, so for a moment a vehicle
 * with a 3D fix looks as if it had none.
 */
export const SETTLE_MS = 3000

const MAV_STATE_CRITICAL = 5
const LANDED = { onGround: 1, inAir: 2, takingOff: 3, landing: 4 } as const

/** Whether the vehicle is flying, from its landed state where it reports one. */
export function isFlying(v: VehicleSnapshot): boolean {
  if (!v.armed) return false
  if (v.landedState === LANDED.onGround) return false
  if (v.landedState >= LANDED.inAir) return true
  return v.relAltM > 3 || v.groundspeedMs > 4
}

interface Condition {
  id: CalloutId
  text: string
  lastSaid: number
}

export class CalloutWatcher {
  private seen = false
  private prev: VehicleSnapshot | null = null
  private phase = ''
  private connectedAt = 0

  private modeSaid = ''
  private modePending: { name: string; since: number } | null = null
  private readySince = 0
  private readySaid = false
  private gpsLostSaid = false
  private battLatch = new Map<number, number>()
  private chargeStateSeen = false
  private battPctSaid = Infinity
  private cells = 0
  private fenceSeen = false
  private armedSince = 0
  private timerSaid = 0
  private minAltArmed = false
  private readoutAt = 0
  private sustained = new Map<string, number>()
  private conditions = new Map<string, Condition>()
  private closeTraffic = new Set<number>()
  private messageSaid = new Map<string, number>()
  private reasons: { text: string; at: number }[] = []
  private failsafe: { id: CalloutId; text: string; at: number } | null = null
  /** When the vehicle last said a mode change failed, so the app's refusal is not said twice. */
  private modeRefusedAt = -Infinity

  reset(): void {
    Object.assign(this, new CalloutWatcher())
  }

  update(input: WatchInput, now: number, cfg: WatchConfig): Emission[] {
    const out: Emission[] = []
    this.linkRules(input.phase, now, out)
    const v = input.v
    if (input.phase !== 'connected' || !v.present) {
      if (input.phase === 'idle') this.reset()
      return out
    }
    const prev = this.prev
    this.prev = v
    if (!this.seen || !prev || now - this.connectedAt < SETTLE_MS) {
      this.seen = true
      this.firstLook(v, now)
      return out
    }

    this.stateRules(prev, v, now, out)
    this.batteryRules(v, now, cfg, out)
    this.gpsRules(prev, v, out)
    this.navRules(prev, v, input.traffic, cfg, out)
    this.limitRules(v, now, cfg, out)
    this.conditionRules(v, now, cfg, out)
    return out
  }

  /** A status message from the vehicle: which row it belongs to, if any. */
  message(st: StatusText, now: number): Emission[] {
    const text = st.text.trim()
    if (!text) return []
    // "Arm:" explains an attempt; "PreArm:" is the 30-second repeat. Both
    // are kept as a refused arm's reason.
    if (isPrearmMessage(text)) {
      this.reasons.push({ text, at: now })
      this.reasons = this.reasons.filter((r) => now - r.at < REASON_WINDOW_MS)
      if (/^Arm\s*:/i.test(text)) return []
      return this.once('prearm', text, now)
    }
    if (text.startsWith('#')) return this.once('hash', text, now)

    const battery = /^Battery \d+ is (low|critical)/i.exec(text)
    if (battery) {
      // BATTERY_STATUS says the same thing more reliably.
      if (this.chargeStateSeen) return []
      return this.once(
        battery[1]!.toLowerCase() === 'low' ? 'batt-low' : 'batt-crit',
        text,
        now,
        battery[1]!.toLowerCase() === 'low' ? 'Battery low' : 'Battery critical',
      )
    }
    if (/\bEKF\d?\b/i.test(text) && /\b(variance|failsafe)\b/i.test(text)) {
      this.failsafe = { id: 'ekf', text: forSpeech(text), at: now }
      return this.once('ekf', text, now)
    }
    if (/failsafe/i.test(text)) {
      this.failsafe = { id: 'failsafe', text: forSpeech(text), at: now }
      return this.once('failsafe', text, now)
    }
    if (/gps glitch/i.test(text)) return this.once('gps-glitch', text, now)
    if (/mission complete/i.test(text))
      return this.once('mission-done', text, now, 'Mission complete')
    const land = /^Land (descend|final) started/i.exec(text)
    if (land) return this.once('land-stages', text, now, `Land ${land[1]!.toLowerCase()}`)
    if (/^takeoff complete/i.test(text))
      return this.once('takeoff-done', text, now, 'Takeoff complete')
    if (/^transition/i.test(text)) return this.once('transition', text, now)
    const tune = /^autotune:?\s*(success|failed)/i.exec(text)
    if (tune) return this.once('autotune', text, now, `Autotune ${tune[1]!.toLowerCase()}`)
    if (/parachute/i.test(text) && /released/i.test(text)) {
      return this.once('parachute', text, now, 'Parachute released')
    }
    if (/mode change\b.*\bfailed/i.test(text)) {
      this.modeRefusedAt = now
      return this.once('mode-refused', text, now)
    }
    if (/fence/i.test(text) && /breach|triggered/i.test(text)) {
      // FENCE_STATUS, when the vehicle sends it, names the fence.
      if (this.fenceSeen) return []
      return this.once('fence-breach', text, now)
    }
    const id: CalloutId =
      st.severity <= 2
        ? 'sev-crit'
        : st.severity === 3
          ? 'sev-err'
          : st.severity === 4
            ? 'sev-warn'
            : 'sev-notice'
    return this.once(id, text, now)
  }

  /** Something the app itself did or saw. */
  event(e: AppEvent, now: number): Emission[] {
    switch (e.t) {
      case 'arm-refused': {
        const reason = [...this.reasons].reverse().find((r) => now - r.at < REASON_WINDOW_MS)
        const why = reason?.text.replace(/^(PreArm|Arm)\s*:\s*/i, '')
        return [
          { id: 'arm-refused', text: why ? `Arming refused. ${forSpeech(why)}` : 'Arming refused' },
        ]
      }
      case 'mode-refused':
        // The confirmed mode change waits seconds for the heartbeat; the
        // vehicle's own message has usually said it already.
        if (now - this.modeRefusedAt < 8000) return []
        return [{ id: 'mode-refused', text: 'Mode change refused' }]
      case 'joystick':
        return [{ id: 'joystick', text: 'Joystick released' }]
      case 'params':
        return [{ id: 'params', text: 'Parameters loaded' }]
      case 'transfer':
        return [
          e.ok
            ? { id: 'transfer', text: `${e.what} ${e.dir === 'write' ? 'written' : 'read'}` }
            : { id: 'transfer', text: `${e.what} ${e.dir} failed`, beep: 'warn' },
        ]
      case 'video':
        return [{ id: 'video', text: 'Video lost' }]
    }
  }

  // --- rules -------------------------------------------------------------

  private once(id: CalloutId, raw: string, now: number, say?: string): Emission[] {
    const last = this.messageSaid.get(raw)
    if (last !== undefined && now - last < MESSAGE_GAP_MS) return []
    for (const [t, at] of this.messageSaid)
      if (now - at >= MESSAGE_GAP_MS) this.messageSaid.delete(t)
    this.messageSaid.set(raw, now)
    return [{ id, text: say ?? forSpeech(raw), key: `msg:${raw}` }]
  }

  private firstLook(v: VehicleSnapshot, now: number) {
    this.modeSaid = v.modeName
    this.armedSince = v.armed ? now : 0
    this.readySaid = true
    this.fenceSeen = v.fence !== null
  }

  private linkRules(phase: string, now: number, out: Emission[]) {
    const was = this.phase
    this.phase = phase
    if (was === 'connected' && phase === 'linkLost')
      out.push({ id: 'link-lost', text: 'Telemetry lost' })
    if (was === 'linkLost' && phase === 'connected')
      out.push({ id: 'link-back', text: 'Telemetry regained' })
    if (phase === 'connected' && was !== 'connected' && was !== 'linkLost') this.connectedAt = now
  }

  private stateRules(prev: VehicleSnapshot, v: VehicleSnapshot, now: number, out: Emission[]) {
    // Mode, once settled.
    if (v.modeName !== this.modeSaid) {
      if (this.modePending?.name !== v.modeName) this.modePending = { name: v.modeName, since: now }
      else if (now - this.modePending.since >= MODE_SETTLE_MS && v.modeName) {
        out.push({ id: 'mode', text: `${modeWords(v.modeName)} mode`, key: `mode:${v.modeName}` })
        this.modeSaid = v.modeName
        this.modePending = null
      }
    } else this.modePending = null

    if (!prev.armed && v.armed) {
      out.push({ id: 'armed', text: 'Armed' })
      this.armedSince = now
      this.timerSaid = 0
      this.readySaid = false
      if ((v.sensorsEnabled & SENSOR_BITS.geofence) !== 0) {
        out.push({ id: 'fence-on', text: 'Fence enabled' })
      }
    }
    if (prev.armed && !v.armed) {
      out.push({ id: 'disarmed', text: 'Disarmed' })
      this.minAltArmed = false
      this.readySaid = false
      this.readySince = 0
    }

    // Ready to arm: checks passing for 3 s after failing, once per disarmed spell.
    const prearmKnown = (v.sensorsPresent & SENSOR_BITS.prearm) !== 0
    const ready = !v.armed && prearmKnown && (v.sensorsHealth & SENSOR_BITS.prearm) !== 0
    if (!ready) {
      this.readySince = 0
      if (!v.armed && prearmKnown) this.readySaid = false
    } else if (!this.readySaid) {
      this.readySince ||= now
      if (now - this.readySince >= 3000) {
        out.push({ id: 'ready', text: 'Ready to arm' })
        this.readySaid = true
      }
    }

    if (
      (prev.landedState === LANDED.inAir || prev.landedState === LANDED.landing) &&
      v.landedState === LANDED.onGround
    ) {
      out.push({ id: 'landed', text: 'Landing complete' })
    }

    if (v.fence) {
      const was = prev.fence?.breached ?? false
      this.fenceSeen = true
      if (v.fence.breached && !was) {
        const what =
          ['', 'minimum altitude', 'maximum altitude', 'boundary'][v.fence.breachType] ?? ''
        const text = what ? `Fence breached, ${what}` : 'Fence breached'
        out.push({ id: 'fence-breach', text })
        this.conditions.set('fence-breach', { id: 'fence-breach', text, lastSaid: now })
      }
      if (!v.fence.breached) this.conditions.delete('fence-breach')
    }

    // Failsafe: the vehicle's state, explained by its message where one came.
    if (v.systemStatus >= MAV_STATE_CRITICAL && v.armed) {
      if (!this.conditions.has('failsafe')) {
        const fresh = this.failsafe && now - this.failsafe.at < FAILSAFE_TEXT_FRESH_MS
        if (!fresh) out.push({ id: 'failsafe', text: 'Failsafe' })
        this.conditions.set('failsafe', {
          id: this.failsafe?.id ?? 'failsafe',
          text: this.failsafe?.text ?? 'Failsafe',
          lastSaid: now,
        })
      }
    } else this.conditions.delete('failsafe')
  }

  private batteryRules(v: VehicleSnapshot, now: number, cfg: WatchConfig, out: Emission[]) {
    const ids = Object.keys(v.batteries).map(Number)
    let critical = false
    for (const id of ids) {
      const cs = v.batteries[id]!.chargeState
      if (!cs) continue
      this.chargeStateSeen = true
      const name = ids.length > 1 ? `Battery ${id + 1}` : 'Battery'
      const said = this.battLatch.get(id) ?? 1
      if (cs <= 1) this.battLatch.delete(id)
      else if (cs > said) {
        this.battLatch.set(id, cs)
        if (cs === 2) out.push({ id: 'batt-low', text: `${name} low`, key: `batt:${id}` })
        else {
          const word = cs === 5 ? 'failed' : cs === 6 ? 'unhealthy' : 'critical'
          out.push({ id: 'batt-crit', text: `${name} ${word}`, key: `batt:${id}` })
        }
      }
      if (cs >= 3) critical = true
    }
    if (critical) {
      if (!this.conditions.has('batt-crit')) {
        this.conditions.set('batt-crit', {
          id: 'batt-crit',
          text: 'Battery critical',
          lastSaid: now,
        })
      }
    } else this.conditions.delete('batt-crit')

    // Percentage steps, only ever down. The first reading is the baseline,
    // so connecting to a half-flat pack says nothing.
    if (v.batteryPct >= 0) {
      if (this.battPctSaid === Infinity) this.battPctSaid = v.batteryPct
      let lowest = Infinity
      for (let level = cfg.value('batt-pct'); level > 0; level -= 10) {
        if (v.batteryPct <= level) lowest = level
      }
      if (lowest < this.battPctSaid) {
        out.push({ id: 'batt-pct', text: `Battery ${lowest} percent` })
        this.battPctSaid = lowest
      }
    }
  }

  private gpsRules(prev: VehicleSnapshot, v: VehicleSnapshot, out: Emission[]) {
    // From a reported no-fix (1) or 2D, not from 0, which is also what a
    // vehicle looks like before its first GPS report (on a slow link, many
    // seconds after the heartbeat, behind the parameter download).
    if (prev.gpsFix >= 1 && prev.gpsFix < 3 && v.gpsFix >= 3) {
      out.push({ id: 'gps-fix', text: 'GPS 3D fix' })
      this.gpsLostSaid = false
    }
    if (prev.gpsFix >= 3 && v.gpsFix < 3 && v.armed && !this.gpsLostSaid) {
      out.push({ id: 'gps-lost', text: 'GPS fix lost' })
      this.gpsLostSaid = true
    }
  }

  private navRules(
    prev: VehicleSnapshot,
    v: VehicleSnapshot,
    traffic: readonly AdsbTarget[],
    cfg: WatchConfig,
    out: Emission[],
  ) {
    if (v.home) {
      // A first report is usually a home set long ago, unless it comes as the
      // vehicle arms (Copter sets home then).
      const moved = prev.home && distanceM(prev.home, v.home) > 5
      if ((!prev.home && v.armed) || moved) {
        out.push({ id: 'home', text: 'Home set' })
      }
    }

    if (
      v.missionSeq !== null &&
      v.missionSeq !== prev.missionSeq &&
      v.missionSeq > 0 &&
      v.armed &&
      v.modeName === 'Auto'
    ) {
      out.push({ id: 'wp', text: `Waypoint ${v.missionSeq}`, key: `wp:${v.missionSeq}` })
    }

    // Traffic: each target once as it becomes close, again only after it has left.
    const own = v.gpsFix >= 3 ? { latDeg: v.latDeg, lonDeg: v.lonDeg, altMslM: v.altMslM } : null
    const close = new Set<number>()
    for (const t of relativeTo(traffic, own)) {
      if (!isClose(t)) continue
      close.add(t.icao)
      if (this.closeTraffic.has(t.icao)) continue
      const parts = ['Traffic']
      if (t.bearingDeg !== null) parts.push(clockWords(t.bearingDeg - v.headingDeg))
      if (t.rangeM !== null) parts.push(distanceWords(t.rangeM, cfg.units))
      if (t.relAltM !== null && Math.abs(t.relAltM) >= 15) {
        parts.push(
          `${heightWords(Math.abs(t.relAltM), cfg.units)} ${t.relAltM > 0 ? 'above' : 'below'}`,
        )
      }
      out.push({ id: 'traffic', text: parts.join(', '), key: `traffic:${t.icao}` })
    }
    this.closeTraffic = close
  }

  private limitRules(v: VehicleSnapshot, now: number, cfg: WatchConfig, out: Emission[]) {
    const flying = isFlying(v)
    const u = cfg.units
    const set = (id: CalloutId, active: boolean, clear: boolean, text: () => string) => {
      if (active && !this.conditions.has(id)) {
        const t = text()
        out.push({ id, text: t })
        this.conditions.set(id, { id, text: t, lastSaid: now })
      } else if (active) {
        this.conditions.get(id)!.text = text()
      } else if (clear || !flying) this.conditions.delete(id)
    }
    const held = (key: keyof typeof SUSTAIN_MS, past: boolean) => {
      if (!past) {
        this.sustained.delete(key)
        return false
      }
      const since = this.sustained.get(key) ?? now
      this.sustained.set(key, since)
      return now - since >= SUSTAIN_MS[key]
    }

    // RC link quality, as the receiver reports it (0-254).
    if (v.rcRssi >= 0) {
      const pct = Math.round((v.rcRssi * 100) / 254)
      const lim = cfg.value('rc-low')
      set('rc-low', flying && pct < lim, pct >= lim + 5, () => `Link quality ${pct} percent`)
    }

    // Cell voltage, with the cell count guessed from the first reading: no
    // lithium cell sits above 4.35 V, so this is right for any pack not
    // already drained below about 3.3 V a cell.
    if (v.batteryV > 1 && !this.cells) this.cells = Math.max(1, Math.ceil(v.batteryV / 4.35))
    if (this.cells && v.batteryV > 1) {
      const perCell = v.batteryV / this.cells
      const lim = cfg.value('batt-cell')
      set('batt-cell', flying && held('batt-cell', perCell < lim), perCell > lim + 0.1, () => {
        return `Battery ${perCell.toFixed(2)} volts per cell`
      })
    }

    if (vehicleClass(v.vehicleType) === 'plane') {
      const lim = cfg.value('low-airspeed')
      set(
        'low-airspeed',
        flying && held('low-airspeed', v.airspeedMs < lim),
        v.airspeedMs > lim + 1,
        () => 'Low airspeed',
      )
    }

    const maxAlt = cfg.value('max-alt')
    set(
      'max-alt',
      flying && v.relAltM > maxAlt,
      v.relAltM < maxAlt - 5,
      () => `Altitude limit, ${heightWords(v.relAltM, u)}`,
    )

    const minAlt = cfg.value('min-alt')
    if (flying && v.relAltM > minAlt + 5) this.minAltArmed = true
    const landing = v.landedState === LANDED.landing || /land/i.test(v.modeName)
    set(
      'min-alt',
      flying && this.minAltArmed && !landing && v.relAltM < minAlt,
      v.relAltM > minAlt + 2,
      () => `Low altitude, ${heightWords(Math.max(0, v.relAltM), u)}`,
    )

    const home = v.home
    const homeDist =
      home && v.gpsFix >= 3 ? distanceM(home, { latDeg: v.latDeg, lonDeg: v.lonDeg }) : null
    if (homeDist !== null) {
      const lim = cfg.value('max-dist')
      set(
        'max-dist',
        flying && homeDist > lim,
        homeDist < lim * 0.95,
        () => `Distance limit, ${distanceWords(homeDist, u)}`,
      )
    }

    const terrainBit = SENSOR_BITS.terrain
    const terrainBad =
      (v.sensorsPresent & terrainBit) !== 0 &&
      (v.sensorsEnabled & terrainBit) !== 0 &&
      (v.sensorsHealth & terrainBit) === 0
    set('terrain', flying && terrainBad, !terrainBad, () => 'No terrain data')

    // Flight timer, from arming.
    if (v.armed && this.armedSince) {
      const every = cfg.value('timer') * 60000
      const n = Math.floor((now - this.armedSince) / every)
      if (n > this.timerSaid) {
        this.timerSaid = n
        const min = Math.round((n * every) / 60000)
        out.push({ id: 'timer', text: `${min} minute${min === 1 ? '' : 's'}` })
      }
    }

    // Periodic readout.
    if (flying) {
      const every = cfg.value('readout') * 1000
      if (!this.readoutAt) this.readoutAt = now
      else if (now - this.readoutAt >= every) {
        this.readoutAt = now
        const parts = [`Altitude ${heightWords(v.relAltM, u)}`]
        if (homeDist !== null) parts.push(`Distance ${distanceWords(homeDist, u)}`)
        parts.push(`Speed ${speedWords(v.groundspeedMs, u)}`)
        out.push({ id: 'readout', text: parts.join('. ') })
      }
    } else this.readoutAt = 0
  }

  /** Alerts still true are said again at the user's interval, while flying. */
  private conditionRules(v: VehicleSnapshot, now: number, cfg: WatchConfig, out: Emission[]) {
    if (!cfg.repeatS || !isFlying(v)) return
    for (const c of this.conditions.values()) {
      if (now - c.lastSaid < cfg.repeatS * 1000) continue
      c.lastSaid = now
      out.push({ id: c.id, text: c.text, key: `repeat:${c.id}` })
    }
  }
}
