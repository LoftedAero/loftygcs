import type { ConnectionPhase } from '../../stores/connection-store'
import { SENSOR_BITS } from '../../protocol/sensors'
import type { FirmwareVersion } from '../../protocol/types'
import { armReadiness, isFailsafe } from '../tabs/flight/hud-draw'

// What the app bar says about the vehicle, as one word.
//
// Following QGroundControl, link state, arm state and prearm health are
// fused into one element, with precedence link, then failsafe, then armed,
// then readiness. The states come from `armReadiness`, shared with the
// Preflight pane, so the two cannot disagree; only the wording is shorter.

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
 * The status word, or null when idle (the Connect button says enough).
 *
 * A failed connection shows the error text itself, since "connection
 * refused" distinguishes a simulator that is not running from a mistyped
 * port.
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
    case 'rebooting':
      // Not a fault: the app requested the reboot.
      return { text: 'Rebooting', tone: 'idle' }
  }
  // Connected, but the vehicle has not identified itself yet.
  if (!v.present) return { text: 'Connected', tone: 'idle' }
  if (isFailsafe(v.systemStatus)) return { text: 'Failsafe', tone: 'bad' }
  const readiness = armReadiness(v.armed, v.sensorsPresent, v.sensorsHealth, SENSOR_BITS.prearm)
  if (readiness === 'armed') return { text: 'Armed', tone: 'ok' }
  if (readiness === 'ready') return { text: 'Ready', tone: 'ok' }
  if (readiness === 'notReady') return { text: 'Not ready', tone: 'warn' }
  // The vehicle does not report a prearm bit, so readiness is unknown.
  return { text: 'Connected', tone: 'idle' }
}

/**
 * Whether the vehicle says it has a given sensor. Used to tell "no monitor
 * fitted" from "a monitor reading zero", not to decide whether a reading is
 * drawn.
 */
export function reports(sensorsPresent: number, bit: number): boolean {
  return (sensorsPresent & bit) !== 0
}

/**
 * How full to draw the battery, 0..1, or null when the vehicle has not said.
 * MAVLink's battery_remaining is -1 for "no estimate", not a flat pack.
 */
export function batteryFill(pct: number): number | null {
  if (pct < 0) return null
  return Math.min(1, Math.max(0, pct / 100))
}

/**
 * How many of the four bars to light, from RC RSSI (0-254), or null when the
 * link does not report it. Quartered rather than thresholded.
 */
export function signalBars(rcRssi: number): number | null {
  if (rcRssi < 0) return null
  const pct = (rcRssi / 254) * 100
  if (pct <= 0) return 0
  return Math.min(4, Math.ceil(pct / 25))
}

/**
 * Whether the pack is low, by the vehicle's own `BATT_CRT_VOLT` and
 * `BATT_LOW_VOLT`, so the app does not impose thresholds of its own. Unset
 * (0) or unknown means no color.
 */
export function batteryTone(
  volts: number,
  lowVolt: number | undefined,
  critVolt: number | undefined,
): 'warn' | 'bad' | undefined {
  // Also guards unset thresholds, which default to 0.
  if (volts <= 0) return undefined
  if (critVolt !== undefined && volts <= critVolt) return 'bad'
  if (lowVolt !== undefined && volts <= lowVolt) return 'warn'
  return undefined
}

// The bar formats its battery and link readings itself, shorter than the
// HUD's, because the icon already shows the level. Pack current and the
// packet rate (when RSSI is reported) go in the tooltip.

/** Volts and charge. Current is a HUD number; the fill shows the charge. */
export function barBattery(volts: number, pct: number): string {
  const parts: string[] = []
  if (volts > 0) parts.push(`${volts.toFixed(1)}V`)
  // -1 is "no estimate", which is not 0%.
  if (pct >= 0) parts.push(`${Math.round(pct)}%`)
  return parts.join('  ')
}

/**
 * Receiver RSSI where the vehicle reports it, else the packet rate. RSSI is
 * how well the aircraft hears its transmitter (what the bars show); the
 * packet rate is how well this GCS hears the aircraft.
 */
export function barLink(rcRssi: number, packetsPerSec: number | undefined): string {
  if (rcRssi >= 0) return `RSSI ${Math.round((rcRssi / 254) * 100)}%`
  if (packetsPerSec !== undefined && packetsPerSec > 0) return `${packetsPerSec.toFixed(0)} pkt/s`
  return ''
}

/**
 * The firmware's vehicle type and version, or a dash until
 * AUTOPILOT_VERSION arrives (shortly after the heartbeat).
 *
 * The release type is shown only for non-official builds:
 * FIRMWARE_VERSION_TYPE is 255 for a release and 0/64/128/192 for dev,
 * alpha, beta and rc.
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
