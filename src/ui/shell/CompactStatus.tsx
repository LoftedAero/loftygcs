import { useState } from 'react'
import { useConnectionStore } from '../../stores/connection-store'
import { useVehicleStore } from '../../stores/vehicle-store'
import { useParamStore } from '../../stores/param-store'
import { useUiStore } from '../../stores/ui-store'
import { connectionService } from '../../services/connection'
import { SENSOR_BITS } from '../../protocol/sensors'
import { LaButton } from '../components/La'
import BarPopover from './BarPopover'
import { BatteryIcon, GpsIcon, SignalIcon } from './AppStatus'
import { barStatus, batteryFill, batteryTone, reports, signalBars } from './app-status'
import { gpsKind, gpsUsable, HUD_MESSAGE_SEVERITY } from '../tabs/flight/hud-draw'
import PreflightPanel from '../tabs/flight/PreflightPanel'
import { useModeChange } from '../tabs/flight/useFlightActions'
import { useMissionStore } from '../../stores/mission-store'
import { useUnits } from '../../stores/preferences-store'
import { distanceLabel, formatDistance } from '../../units'
import { formatEta, missionProgress } from '../tabs/flight/mission-progress'

// Compact mode's app bar status, following QGroundControl's toolbar: short
// readings that each open a panel with the detail behind them, so the bar
// stays one row on a handheld. The desktop bar (AppStatus) shows the same
// readings inline.

/**
 * Shorter forms for the few mode names too long for the mode's slot; the full
 * name is in the hover text.
 */
const SHORT_MODE: Record<string, string> = { 'Loiter to QLand': 'Loiter QLand' }

/** How many recent messages the messages panel lists. */
const MESSAGE_LIST = 40

export default function CompactStatus() {
  const phase = useConnectionStore((s) => s.phase)
  const error = useConnectionStore((s) => s.error)
  const present = useVehicleStore((s) => s.present)
  const armed = useVehicleStore((s) => s.armed)
  const systemStatus = useVehicleStore((s) => s.systemStatus)
  const sensorsPresent = useVehicleStore((s) => s.sensorsPresent)
  const sensorsHealth = useVehicleStore((s) => s.sensorsHealth)

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

  const chip = (
    <>
      <span className="app-status__dot" aria-hidden="true" />
      <span className="app-status__word">{status.text}</span>
    </>
  )
  return (
    <div className="compact-status" role="group" aria-label="Vehicle status">
      {present ? (
        <BarPopover
          className={`compact-status__item app-status__state app-status__state--${status.tone}`}
          label="Preflight"
          button={chip}
        >
          {() => (
            <div className="bar-pop__preflight">
              <PreflightPanel />
            </div>
          )}
        </BarPopover>
      ) : status.detail ? (
        // The sentence would push the bar past a handheld's width, so it is
        // a tap away.
        <BarPopover
          className={`compact-status__item app-status__state app-status__state--${status.tone}`}
          label="Connection"
          button={chip}
        >
          {() => <p className="bar-pop__note bar-pop__detail">{status.detail}</p>}
        </BarPopover>
      ) : (
        <span
          className={`compact-status__item app-status__state app-status__state--${status.tone}`}
          title={status.text}
        >
          {chip}
        </span>
      )}
      {present && <ModeItem />}
      {present && <BatteryItem />}
      {present && <GpsItem />}
      {present && <MessagesItem />}
    </div>
  )
}

function ModeItem() {
  const m = useModeChange()
  // Mission progress: the desktop shows it beside the flight controls, which
  // compact Fly has no room for, so it rides on the mode while one is flown.
  const missionSeq = useVehicleStore((s) => s.missionSeq)
  const wpDistM = useVehicleStore((s) => s.wpDistM)
  const groundspeedMs = useVehicleStore((s) => s.groundspeedMs)
  const planItems = useMissionStore((s) => s.plan.items)
  const units = useUnits()
  const progress = missionProgress(missionSeq, planItems, wpDistM, groundspeedMs)
  const name = m.modeName ? (SHORT_MODE[m.modeName] ?? m.modeName) : '—'
  return (
    <BarPopover
      className="compact-status__item compact-status__mode"
      label="Flight mode"
      title={m.modeName || 'Flight mode'}
      button={progress.position !== null ? `${name} · ${progress.position}` : name}
    >
      {(close) => (
        <>
          {progress.position !== null && (
            <p className="bar-pop__progress">
              Item {progress.position}
              {progress.commandName && ` ${progress.commandName}`}
              {wpDistM !== null &&
                ` · ${formatDistance(wpDistM, units.distance, 0)} ${distanceLabel(units.distance)}`}
              {progress.etaS !== null && ` · ${formatEta(progress.etaS)}`}
            </p>
          )}
          <div className="bar-pop__modes">
            {Object.entries(m.modes).map(([num, mode]) => (
              <button
                key={num}
                type="button"
                className={`bar-pop__mode${mode === m.modeName ? ' is-current' : ''}`}
                disabled={!m.connected || mode === m.modeName}
                onClick={() => {
                  close()
                  m.setMode(Number(num), mode)
                }}
              >
                {mode}
              </button>
            ))}
          </div>
        </>
      )}
    </BarPopover>
  )
}

function BatteryItem() {
  const volts = useVehicleStore((s) => s.batteryV)
  const amps = useVehicleStore((s) => s.batteryA)
  const pct = useVehicleStore((s) => s.batteryPct)
  const sensorsPresent = useVehicleStore((s) => s.sensorsPresent)
  const lowVolt = useParamStore((s) => s.entries.get('BATT_LOW_VOLT')?.value)
  const critVolt = useParamStore((s) => s.entries.get('BATT_CRT_VOLT')?.value)
  const tone = batteryTone(volts, lowVolt, critVolt)
  // The icon shows the level, so the bar gives one number: charge, else volts.
  const value = pct >= 0 ? `${Math.round(pct)}%` : volts > 0 ? `${volts.toFixed(1)}V` : '—'
  return (
    <BarPopover
      className={`compact-status__item compact-status__battery${tone ? ` app-status__item--${tone}` : ''}`}
      label="Battery"
      title="Battery"
      button={
        <>
          <BatteryIcon fill={batteryFill(pct)} />
          <span className="app-status__val">{value}</span>
        </>
      }
    >
      {() =>
        reports(sensorsPresent, SENSOR_BITS.battery) ? (
          <Rows
            rows={[
              ['Voltage', volts > 0 ? `${volts.toFixed(2)}V` : '—'],
              ['Current', amps >= 0 ? `${amps.toFixed(1)}A` : '—'],
              ['Remaining', pct >= 0 ? `${Math.round(pct)}%` : '—'],
              ['Low at', lowVolt ? `${lowVolt}V` : '—'],
              ['Critical at', critVolt ? `${critVolt}V` : '—'],
            ]}
          />
        ) : (
          <p className="bar-pop__note">No battery monitor</p>
        )
      }
    </BarPopover>
  )
}

function GpsItem() {
  const fix = useVehicleStore((s) => s.gpsFix)
  const sats = useVehicleStore((s) => s.gpsSats)
  const hdop = useVehicleStore((s) => s.gpsHdop)
  const lat = useVehicleStore((s) => s.latDeg)
  const lon = useVehicleStore((s) => s.lonDeg)
  return (
    <BarPopover
      className={`compact-status__item compact-status__gps${gpsUsable(fix) ? '' : ' app-status__item--warn'}`}
      label="GPS"
      title="GPS"
      button={
        <>
          <GpsIcon />
          <span className="app-status__val">{sats > 0 ? sats : gpsKind(fix)}</span>
        </>
      }
    >
      {() => (
        <Rows
          rows={[
            ['Fix', gpsKind(fix)],
            ['Satellites', sats > 0 ? String(sats) : '—'],
            ['HDOP', hdop > 0 ? hdop.toFixed(2) : '—'],
            ['Position', lat !== 0 || lon !== 0 ? `${lat.toFixed(6)}, ${lon.toFixed(6)}` : '—'],
          ]}
        />
      )}
    </BarPopover>
  )
}

function MessagesItem() {
  const texts = useVehicleStore((s) => s.statusTexts)
  // Messages since the panel was last opened.
  const [seenAt, setSeenAt] = useState(() => Date.now())
  const unread = texts.filter((t) => t.at > seenAt)
  const warn = unread.some((t) => t.severity <= HUD_MESSAGE_SEVERITY)
  return (
    <BarPopover
      className={`compact-status__item compact-status__messages${warn ? ' app-status__item--warn' : ''}`}
      label="Messages"
      title="Messages"
      // Opening the panel reads what is there, and closing it reads what
      // arrived while it was open.
      onToggle={() => setSeenAt(Date.now())}
      button={
        <>
          <MessageIcon />
          {unread.length > 0 && <span className="compact-status__badge">{unread.length}</span>}
          <span className="app-sr-only">Messages</span>
        </>
      }
    >
      {() => {
        const recent = texts.slice(-MESSAGE_LIST).reverse()
        return recent.length === 0 ? (
          <p className="bar-pop__note">No messages</p>
        ) : (
          <ol className="bar-pop__messages">
            {recent.map((t, i) => (
              <li
                key={`${t.at}-${i}`}
                className={t.severity <= HUD_MESSAGE_SEVERITY ? 'is-warn' : undefined}
              >
                {t.text}
              </li>
            ))}
          </ol>
        )
      }}
    </BarPopover>
  )
}

/**
 * The bar's connection control: Connect with no link, otherwise the link's
 * signal, opening its detail and Disconnect.
 */
export function CompactLink() {
  const phase = useConnectionStore((s) => s.phase)
  const stats = useConnectionStore((s) => s.linkStats)
  const rcRssi = useVehicleStore((s) => s.rcRssi)
  const setConnectModalOpen = useUiStore((s) => s.setConnectModalOpen)

  if (phase === 'idle' || phase === 'error') {
    return (
      <LaButton variant="primary" onClick={() => setConnectModalOpen(true)}>
        Connect
      </LaButton>
    )
  }
  const connected = phase === 'connected'
  const value = !connected
    ? '…'
    : rcRssi >= 0
      ? `${Math.round((rcRssi / 254) * 100)}%`
      : stats
        ? `${stats.rxCount}/s`
        : '—'
  return (
    <BarPopover
      className={`compact-status__item compact-status__link${phase === 'linkLost' ? ' app-status__item--bad' : ''}`}
      label="Link"
      title="Link"
      button={
        <>
          <SignalIcon bars={connected ? signalBars(rcRssi) : null} />
          <span className="app-status__val">{value}</span>
        </>
      }
    >
      {(close) => (
        <>
          <Rows
            rows={[
              ['Receiver signal', rcRssi >= 0 ? `${Math.round((rcRssi / 254) * 100)}%` : '—'],
              ['Messages', stats ? `${stats.rxCount}/s` : '—'],
              ['Round trip', stats?.rttMs != null ? `${Math.round(stats.rttMs)} ms` : '—'],
              [
                'Last heartbeat',
                stats && stats.heartbeatAgeMs >= 0
                  ? `${(stats.heartbeatAgeMs / 1000).toFixed(1)} s ago`
                  : '—',
              ],
              ['Bad frames', stats ? String(stats.badFrames) : '—'],
            ]}
          />
          <div className="bar-pop__actions">
            <LaButton
              variant="ghost"
              onClick={() => {
                close()
                void connectionService.disconnect()
              }}
            >
              Disconnect
            </LaButton>
          </div>
        </>
      )}
    </BarPopover>
  )
}

function Rows({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="bar-pop__rows">
      {rows.map(([k, v]) => (
        <div key={k} className="bar-pop__row">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

/** A speech bubble, on the status icons' 20x20 grid. */
function MessageIcon() {
  return (
    <svg className="app-status__icon" viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M3 4.5 H17 V13.5 H8.5 L5 16.5 V13.5 H3 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  )
}
