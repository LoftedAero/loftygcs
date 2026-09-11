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

// The app bar's vehicle status: a row of indicators, one per thing worth
// glancing at, rather than one sentence.
//
// What it replaced was a single `.la-readout` inherited from the other
// Lofted Aero apps, where that element is the app's own main live value and
// earning the bar's slack is right. Here it held `Name · Mode · Armed` and
// still absorbed every spare pixel: measured at 691px in a 1600px window and
// 1651px at 2560, against a longest-ever string of 203px. Two thirds of the
// bar to say one short thing, and the wrong short thing -- mode and armed
// state are also in the flight controls two inches below, while battery,
// GPS, link and prearm were only ever drawn on the HUD canvas, behind an
// overlays toggle, on one screen out of three.
//
// The shape is QGroundControl's and so is the rule that matters most:
// **an indicator that has nothing to say is not drawn**. QGC instantiates no
// vehicle indicators at all without a vehicle; Betaflight sets its whole
// status cluster to `display: none`. Neither has a box reading "Not
// connected", which is exactly what this bar used to show. Whether a subject
// exists is read from SYS_STATUS's present mask rather than from its value,
// because a value cannot separate "no battery monitor" from "a monitor
// reading zero".
//
// Every string comes from the same helpers the HUD paints with, so the bar
// and the HUD cannot drift into describing one vehicle two ways.
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

  // The one clickable indicator, and it goes where the reason is. "Not
  // ready" is a question -- which check? -- and the Preflight pane is the
  // screen that answers it, so the word is the route to it rather than a
  // dead end that has to be looked up somewhere else. Opening the pane as
  // well as selecting it: with the lower pane switched off, changing which
  // tab is active would do nothing anyone could see.
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
      {/* A button only while there is a vehicle to explain. Offering a route
          to the preflight checks of an aircraft that is not there is a
          control that cannot do what it says -- so opening a link, a failed
          connect and a lost link render the same chip as plain text. */}
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
          /* The error phase puts the transport's own words here, and they can
             be long. The row clips them; the tooltip does not. */
          title={status.text}
        >
          <span className="app-status__dot" aria-hidden="true" />
          <span className="app-status__word">{status.text}</span>
        </span>
      )}

      {/* Not a reading: what the vehicle is running, fixed for the life of
          the connection. It sits with the state rather than among the
          gauges because those three change and this does not, and it keeps
          a reserved width with a dash in it so the moment
          AUTOPILOT_VERSION lands is not the moment the gauges jump. */}
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

      {/* The three readings are always drawn while a vehicle is connected,
          whether or not it has the hardware. That is a deliberate reversal:
          they were gated on the SYS_STATUS present mask, and a flight
          controller with no GPS then had no GPS reading at all -- which
          tells a pilot nothing, and reads as a layout fault rather than as
          news. "No GPS" is itself a reading, and the one that decides
          whether the position modes can be flown. Betaflight draws all six
          of its sensor cells for the same reason.

          The rule that stands is the one above it: with no *vehicle* the
          whole row is absent. What changed is that inside a connected
          vehicle the set is fixed, which also means the row is one width
          for every aircraft rather than one per sensor fit. */}
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
          // Three is ArduPilot's own threshold: below it the vehicle refuses
          // Loiter, Auto and RTL, so it is a fact about what can be flown
          // rather than a comfort level chosen here.
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

      {/* Last, and the only reading without a reserved width. A mode name is
          the one value here whose length is set by firmware rather than by
          this app -- "Loiter to QLand" and "Heli_Autorotate" are the longest
          ArduPilot ships today and a future one could be longer -- so it
          goes on the end, where growing simply extends the row instead of
          pushing four gauges sideways. */}
      {present && <Item slot="mode" cap="Mode" value={modeName || '—'} />}
    </div>
  )
}

/**
 * One reading in a slot of its own fixed width.
 *
 * The slot is the point: a value that resizes as it changes drags every
 * reading after it sideways, and a row of gauges that shuffles while you
 * read it is worse than no row. Each width is measured against the longest
 * string that reading can actually produce (see app.css), so the number
 * changes and nothing moves.
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
      {/* The icon is what the reading is labelled with on screen; the word
          is still here for anyone reading the page rather than looking at
          it, and it is what the tooltip says. */}
      <span className="app-sr-only">{cap}</span>
      <span className="app-status__val">{value}</span>
    </div>
  )
}

// Drawn rather than imported, the way the app bar's gear already is: three
// glyphs is not a reason to take on an icon set, and these have to sit on a
// permanently dark ground and take `currentColor` so a warning tone reaches
// them. All 16px on the same 0 0 16 16 grid so they share a baseline.

/**
 * A cell, its terminal, and how full it is.
 *
 * The fill is `battery_remaining` drawn as a picture of itself, not a
 * judgement about it -- null (MAVLink's -1, "no estimate") draws an empty
 * cell rather than a flat one, which are very different pieces of news. Any
 * *color* comes from the item's tone, which is set from the vehicle's own
 * BATT_LOW_VOLT and BATT_CRT_VOLT rather than from a threshold invented
 * here.
 */
function BatteryIcon({ fill }: { fill: number | null }) {
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
 * A globe: latitude, longitude and a meridian.
 *
 * A satellite is the conventional glyph here and three attempts at one --
 * dish on a mast, dish with a feed horn, body with solar panels -- were all
 * illegible at 16px, which is the only size this is ever drawn at. Rendered
 * at 96px they were fine; that is not the test. A globe survives the size,
 * says "where on Earth" (which is the reading), and cannot be confused with
 * the link bars beside it, which matters more than matching a convention
 * nobody can make out.
 */
function GpsIcon() {
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
 * Unlit bars stay drawn at low opacity rather than disappearing: the shape
 * is what says "four bars, one lit", and bars that vanish read as a smaller
 * icon rather than as a weak signal. `null` -- the link does not report RSSI
 * at all -- lights none of them, and the value beside it falls back to the
 * packet rate.
 */
function SignalIcon({ bars }: { bars: number | null }) {
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
