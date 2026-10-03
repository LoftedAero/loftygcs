import type { ReactNode } from 'react'
import { useConnectionStore } from '../../stores/connection-store'
import { useVehicleStore } from '../../stores/vehicle-store'
import { useUiStore } from '../../stores/ui-store'
import { useFlightLayoutStore } from '../../stores/flight-layout-store'
import { SENSOR_BITS } from '../../protocol/sensors'
import { batteryLabel, gpsKind, gpsUsable, linkLabel } from '../tabs/flight/hud-draw'
import { useParamStore } from '../../stores/param-store'
import {
  barBattery,
  barFirmware,
  barLink,
  barStatus,
  batteryFill,
  batteryTone,
  reports,
  signalBars,
} from './app-status'

// The app bar's vehicle status: a row of indicators rather than one sentence.
//
// Following QGroundControl, nothing is drawn without a vehicle (no "Not
// connected" box). Strings come from the same helpers the HUD uses, so the
// two cannot describe one vehicle differently.
export default function AppStatus() {
  const phase = useConnectionStore((s) => s.phase)
  const error = useConnectionStore((s) => s.error)
  const rxCount = useConnectionStore((s) => s.linkStats?.rxCount)

  const present = useVehicleStore((s) => s.present)
  const armed = useVehicleStore((s) => s.armed)
  const systemStatus = useVehicleStore((s) => s.systemStatus)
  const sensorsPresent = useVehicleStore((s) => s.sensorsPresent)
  const sensorsHealth = useVehicleStore((s) => s.sensorsHealth)
  const vehicleName = useVehicleStore((s) => s.vehicleName)
  const modeName = useVehicleStore((s) => s.modeName)
  const firmware = useVehicleStore((s) => s.firmware)
  const batteryV = useVehicleStore((s) => s.batteryV)
  const batteryA = useVehicleStore((s) => s.batteryA)
  const batteryPct = useVehicleStore((s) => s.batteryPct)
  const gpsFix = useVehicleStore((s) => s.gpsFix)
  const gpsSats = useVehicleStore((s) => s.gpsSats)
  const rcRssi = useVehicleStore((s) => s.rcRssi)
  const lowVolt = useParamStore((s) => s.entries.get('BATT_LOW_VOLT')?.value)
  const critVolt = useParamStore((s) => s.entries.get('BATT_CRT_VOLT')?.value)

  const setMode = useUiStore((s) => s.setMode)
  const setLogPane = useFlightLayoutStore((s) => s.setLogPane)
  const toggle = useFlightLayoutStore((s) => s.toggle)
  const showMessages = useFlightLayoutStore((s) => s.showMessages)

  const status = barStatus({
    phase,
    error,
    present,
    armed,
    systemStatus,
    sensorsPresent,
    sensorsHealth,
  })
  if (!status) return null

  // The status word opens the Preflight pane, which says why the vehicle is
  // not ready. The lower pane is shown too, in case it was switched off.
  const explain = () => {
    setMode('fly')
    setLogPane('preflight')
    if (!showMessages) toggle('showMessages')
  }

  const battery = barBattery(batteryV, batteryPct)
  const link = barLink(rcRssi, rxCount)
  const hasBattery = reports(sensorsPresent, SENSOR_BITS.battery)

  return (
    <div className="app-status" role="group" aria-label="Vehicle status">
      {/* A button only while there is a vehicle; otherwise (connecting,
          failed or lost link) the same chip as plain text. */}
      {present ? (
        <button
          type="button"
          className={`app-status__state app-status__state--${status.tone}`}
          onClick={explain}
          title={`${vehicleName} — open the preflight checks`}
        >
          <span className="app-status__dot" aria-hidden="true" />
          <span className="app-status__word">{status.text}</span>
        </button>
      ) : (
        <span
          className={`app-status__state app-status__state--${status.tone}`}
          /* Error text can be long; the row clips it, the tooltip does not. */
          title={status.detail ?? status.text}
        >
          <span className="app-status__dot" aria-hidden="true" />
          <span className="app-status__word">{status.detail ?? status.text}</span>
        </span>
      )}

      {/* Firmware is fixed for the connection, so it sits with the state
          rather than the gauges. Its width is reserved so the gauges do not
          shift when AUTOPILOT_VERSION arrives. */}
      {present && (
        <Item
          slot="firmware"
          cap="Firmware"
          value={barFirmware(vehicleName, firmware)}
          title={
            firmware
              ? `Firmware — ${barFirmware(vehicleName, firmware)}`
              : 'Firmware — the vehicle has not reported its version'
          }
        />
      )}

      {/* The three readings are always drawn while connected, whether or not
          the hardware is fitted: "No GPS" is itself a reading, and it decides
          whether the position modes can be flown. It also keeps the row one
          width for every aircraft. */}
      {present && (
        <Item
          slot="battery"
          cap="Battery"
          icon={<BatteryIcon fill={batteryFill(batteryPct)} />}
          value={battery || '—'}
          tone={batteryTone(batteryV, lowVolt, critVolt)}
          title={
            hasBattery
              ? `Battery — ${batteryLabel(batteryV, batteryA, batteryPct) || 'nothing reported'}`
              : 'Battery — the vehicle reports no monitor'
          }
        />
      )}

      {present && (
        <Item
          slot="gps"
          cap="GPS"
          icon={<GpsIcon />}
          value={gpsSats > 0 ? `${gpsKind(gpsFix)} · ${gpsSats}` : gpsKind(gpsFix)}
          // ArduPilot's own threshold: below a 3D fix it refuses Loiter, Auto
          // and RTL.
          tone={gpsUsable(gpsFix) ? undefined : 'warn'}
          title={`GPS — ${gpsSats} satellites`}
        />
      )}

      {present && (
        <Item
          slot="link"
          cap="Link"
          icon={<SignalIcon bars={signalBars(rcRssi)} />}
          value={link || '—'}
          title={`Link — ${linkLabel(rcRssi, rxCount) || 'nothing reported'}`}
        />
      )}

      {/* Last and without a reserved width: mode names come from firmware
          ("Loiter to QLand" is among the longest), so growing only extends
          the row. */}
      {present && <Item slot="mode" cap="Mode" value={modeName || '—'} />}
    </div>
  )
}

/**
 * One reading in a fixed-width slot, sized in app.css to the longest string
 * it can produce, so a changing value does not shift its neighbors.
 */
function Item({
  slot,
  cap,
  icon,
  value,
  tone,
  title,
}: {
  slot: 'mode' | 'firmware' | 'battery' | 'gps' | 'link'
  cap: string
  icon?: ReactNode
  value: string
  tone?: 'warn' | 'bad' | undefined
  title?: string | undefined
}) {
  const cls = [
    'app-status__item',
    `app-status__item--${slot}`,
    tone ? `app-status__item--${tone}` : '',
  ]
  return (
    <div className={cls.filter(Boolean).join(' ')} title={title ?? cap}>
      {icon}
      {/* The icon labels the reading on screen; this labels it for screen
          readers. */}
      <span className="app-sr-only">{cap}</span>
      <span className="app-status__val">{value}</span>
    </div>
  )
}

// Inline SVG rather than an icon set; they use `currentColor` so a warning
// tone reaches them. All on the same 20x20 grid so they share a baseline.

/**
 * A cell filled to `battery_remaining`. Null (MAVLink's -1, "no estimate")
 * draws an empty cell. Color comes from the item's tone, which follows the
 * vehicle's BATT_LOW_VOLT and BATT_CRT_VOLT.
 */
export function BatteryIcon({ fill }: { fill: number | null }) {
  return (
    <svg className="app-status__icon" viewBox="0 0 20 20" aria-hidden="true">
      <rect
        x="1"
        y="5"
        width="14.6"
        height="10"
        rx="2.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <rect x="16.8" y="7.7" width="2.2" height="4.6" rx="0.9" fill="currentColor" />
      {fill !== null && fill > 0 && (
        <rect
          x="2.8"
          y="6.8"
          width={Math.max(1.2, 11 * fill)}
          height="6.4"
          rx="1.1"
          fill="currentColor"
        />
      )}
    </svg>
  )
}

/**
 * A globe rather than the conventional satellite, which is illegible at the
 * small size this is drawn at.
 */
export function GpsIcon() {
  return (
    <svg className="app-status__icon" viewBox="0 0 20 20" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="10" cy="10" r="7.9" />
        <ellipse cx="10" cy="10" rx="3.3" ry="7.9" />
        <path d="M2.5 7.4 H17.5 M2.5 12.6 H17.5" />
      </g>
    </svg>
  )
}

/**
 * Four ascending bars, lit to the receiver's RSSI.
 *
 * Unlit bars stay at low opacity so the shape still reads as four bars.
 * `null` (no RSSI reported) lights none; the value beside it then shows the
 * packet rate.
 */
export function SignalIcon({ bars }: { bars: number | null }) {
  return (
    <svg className="app-status__icon" viewBox="0 0 20 20" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => {
        const h = 3.4 + i * 4
        return (
          <rect
            key={i}
            x={1.2 + i * 4.9}
            y={17 - h}
            width="3.3"
            height={h}
            rx="0.9"
            fill="currentColor"
            opacity={bars !== null && i < bars ? 1 : 0.26}
          />
        )
      })}
    </svg>
  )
}
