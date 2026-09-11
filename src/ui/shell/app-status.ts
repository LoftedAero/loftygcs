import type { ConnectionPhase } from '../../stores/connection-store'
import { SENSOR_BITS } from '../../protocol/sensors'
import type { FirmwareVersion } from '../../protocol/types'
import { armReadiness, isFailsafe } from '../tabs/flight/hud-draw'

// What the app bar says about the vehicle, as one word.
//
// This is QGroundControl's shape: link state, arm state and prearm health
// are one element, not three, because they answer one question and only one
// of them is ever the most important thing on screen. The precedence is
// theirs too -- link before arm before readiness -- with failsafe inserted
// above armed, since a vehicle declaring MAV_STATE_CRITICAL is not usefully
// described as "Armed".
//
// The words are shorter than the ones the HUD and the Preflight pane use
// ("Ready" against "Ready to arm") because a 52px bar is not where an
// explanation fits. The *states* are identical because both read
// `armReadiness`, so the bar cannot say something the pane contradicts.

export type StatusTone = 'ok' | 'warn' | 'bad' | 'idle'

export interface BarStatus {
  text: string
  tone: StatusTone
}

export interface VehicleStatusInput {
  phase: ConnectionPhase
  /** Whatever the connection service reported, for the error phase. */
  error: string | null
  present: boolean
  armed: boolean
  systemStatus: number
  sensorsPresent: number
  sensorsHealth: number
}

/**
 * The status word, or null when there is nothing to say.
 *
 * Null is the important return. Idle is the state where the Connect button
 * is already the whole story, and both references remove their status
 * entirely rather than render a placeholder into it -- QGC instantiates no
 * vehicle indicators at all, Betaflight hides the cluster outright. A box
 * reading "Not connected" is the thing they both avoid.
 *
 * A *failed* connection is not that state. "Connection refused" is the
 * difference between a simulator that is not running and a port typed
 * wrong, and it was the one genuinely load-bearing thing the readout this
 * replaced ever showed -- so it survives, as the one status that is words
 * from elsewhere rather than a word chosen here.
 */
export function barStatus(v: VehicleStatusInput): BarStatus | null {
  switch (v.phase) {
    case 'idle':
      return null
    case 'error':
      return { text: v.error ?? 'Connection failed', tone: 'bad' }
    case 'opening':
      return { text: 'Opening link', tone: 'idle' }
    case 'handshaking':
      return { text: 'Waiting for heartbeat', tone: 'idle' }
    case 'linkLost':
      return { text: 'Link lost', tone: 'bad' }
  }
  // Connected, but the vehicle has not identified itself yet.
  if (!v.present) return { text: 'Connected', tone: 'idle' }
  if (isFailsafe(v.systemStatus)) return { text: 'Failsafe', tone: 'bad' }
  const readiness = armReadiness(v.armed, v.sensorsPresent, v.sensorsHealth, SENSOR_BITS.prearm)
  if (readiness === 'armed') return { text: 'Armed', tone: 'ok' }
  if (readiness === 'ready') return { text: 'Ready', tone: 'ok' }
  if (readiness === 'notReady') return { text: 'Not ready', tone: 'warn' }
  // The vehicle does not report a prearm bit, so "ready" would be a claim
  // this build cannot support. It is connected and that is all we know.
  return { text: 'Connected', tone: 'idle' }
}

/**
 * Whether the vehicle says it has a given sensor.
 *
 * Used to tell "no monitor fitted" from "a monitor reading zero" -- 0 volts
 * is both, and they are not the same news. It is *not* used to decide
 * whether a reading is drawn: see the note on the three readings in
 * AppStatus.tsx.
 */
export function reports(sensorsPresent: number, bit: number): boolean {
  return (sensorsPresent & bit) !== 0
}

/**
 * How full to draw the battery, 0..1, or null when the vehicle has not said.
 *
 * MAVLink's battery_remaining is -1 for "no estimate", which is a different
 * answer from a flat pack and must not be drawn as one.
 */
export function batteryFill(pct: number): number | null {
  if (pct < 0) return null
  return Math.min(1, Math.max(0, pct / 100))
}

/**
 * How many of the four bars to light, from RC RSSI (0-254), or null when the
 * link does not report it.
 *
 * Quartered rather than thresholded: the bars are a picture of the number
 * beside them, not a judgement about it.
 */
export function signalBars(rcRssi: number): number | null {
  if (rcRssi < 0) return null
  const pct = (rcRssi / 254) * 100
  if (pct <= 0) return 0
  return Math.min(4, Math.ceil(pct / 25))
}

/**
 * Whether the pack is low, by the vehicle's *own* thresholds.
 *
 * `BATT_CRT_VOLT` and `BATT_LOW_VOLT` are what ArduPilot itself acts on, so
 * reading them is reporting the aircraft's configuration rather than
 * imposing a number this app made up -- which is the reason the battery
 * carried no color at all until these were wired in. Unset (0) or unknown
 * means no opinion, which is the honest answer for a pack nobody has
 * configured a failsafe for.
 */
export function batteryTone(
  volts: number,
  lowVolt: number | undefined,
  critVolt: number | undefined,
): 'warn' | 'bad' | undefined {
  // Also the guard for an unset threshold: the parameters default to 0, and
  // a pack the vehicle can actually see reads above that, so `volts <= 0`
  // is the only case either comparison could fire on spuriously.
  if (volts <= 0) return undefined
  if (critVolt !== undefined && volts <= critVolt) return 'bad'
  if (lowVolt !== undefined && volts <= lowVolt) return 'warn'
  return undefined
}

// The bar formats two of its own readings rather than borrowing the HUD's.
//
// Everywhere else this row deliberately shares `hud-draw`'s formatters so the
// two cannot describe one vehicle two ways, and the *vocabulary* still is
// shared -- `gpsKind` names a fix in both places. What differs is how much
// each surface has room to say. The HUD has a whole corner and no icons; this
// has a 52px bar and an icon that already carries the level, so the numbers
// the icon is a picture of do not need repeating in full.
//
// What is dropped is in the tooltip, not lost: pack current, and the packet
// rate when a receiver is reporting RSSI.

/** Volts and charge. Current is a HUD number; the fill shows the charge. */
export function barBattery(volts: number, pct: number): string {
  const parts: string[] = []
  if (volts > 0) parts.push(`${volts.toFixed(1)}V`)
  // -1 is "no estimate", which is not 0%.
  if (pct >= 0) parts.push(`${Math.round(pct)}%`)
  return parts.join('  ')
}

/**
 * Receiver RSSI where the vehicle reports it, else the packet rate.
 *
 * Never both, which is the one place this differs in substance rather than
 * length: they answer different questions -- how well the *aircraft* hears
 * its transmitter, and how well *this GCS* is hearing the aircraft -- and the
 * bars beside it are a picture of the first. The second is the useful answer
 * only when there is no receiver to ask about, which is exactly when it
 * appears.
 */
export function barLink(rcRssi: number, packetsPerSec: number | undefined): string {
  if (rcRssi >= 0) return `RSSI ${Math.round((rcRssi / 254) * 100)}%`
  if (packetsPerSec !== undefined && packetsPerSec > 0) return `${packetsPerSec.toFixed(0)} pkt/s`
  return ''
}

/**
 * What the vehicle is running: the firmware's vehicle type and version.
 *
 * The only value in this row that is not a live reading -- it is fixed for
 * the life of a connection -- which is why it sits beside the state chip
 * rather than among the gauges, and why it carries a reserved width with a
 * dash in it: AUTOPILOT_VERSION arrives a beat after the heartbeat, and a
 * slot that grows from nothing at that moment would shove four gauges
 * sideways just as someone starts reading them.
 *
 * The release type is shown only when it is *not* an official build.
 * FIRMWARE_VERSION_TYPE is 255 for a release and 0/64/128/192 for dev,
 * alpha, beta and rc, and "you are not on a stable build" is the one thing
 * about it worth a pilot's attention -- spelling out "official" on every
 * ordinary vehicle would be noise on a 52px bar.
 */
export function barFirmware(vehicleName: string, fw: FirmwareVersion | null): string {
  if (!fw) return '—'
  const v = `${fw.major}.${fw.minor}.${fw.patch}`
  const kind = FIRMWARE_KIND[fw.type]
  return `${vehicleName || 'Vehicle'} ${v}${kind ? `-${kind}` : ''}`
}

const FIRMWARE_KIND: Record<number, string> = {
  0: 'dev',
  64: 'alpha',
  128: 'beta',
  192: 'rc',
}
