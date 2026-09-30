import { BRAND } from '../../brand'
import { LaButton, LaSelect } from '../components/La'
import { useConnectionStore } from '../../stores/connection-store'
import { MODES, useUiStore } from '../../stores/ui-store'
import { connectionService } from '../../services/connection'
import AppStatus from './AppStatus'
import CompactStatus, { CompactLink } from './CompactStatus'
import { SetupScreenPicker } from './NavRail'
import JoystickChip from './JoystickChip'
import ParamProgress from './ParamProgress'
import SimTray from './SimTray'
import ThemeToggle from './ThemeToggle'
import { hasIpLinks, hasUart, isNativeApp } from '../../env'
import { useCompact } from '../compact'
import type { TransportKind } from '../../transport/Transport'

// Top-level mode switch. Not orange: Connect is the bar's one primary action.
// The active segment inverts to a light surface instead.
/** In compact mode, Setup's button also picks the screen (see SetupScreenPicker). */
function ModeSwitch({ compact = false }: { compact?: boolean }) {
  const mode = useUiStore((s) => s.mode)
  const setMode = useUiStore((s) => s.setMode)
  return (
    <div className="app-modes" role="tablist" aria-label="Mode">
      {MODES.map((m) =>
        compact && m.id === 'setup' && mode === 'setup' ? (
          <SetupScreenPicker key={m.id} />
        ) : (
          <button
            key={m.id}
            role="tab"
            aria-selected={m.id === mode}
            className={
              m.id === mode ? 'app-modes__item app-modes__item--active' : 'app-modes__item'
            }
            onClick={() => setMode(m.id)}
          >
            {m.label}
          </button>
        ),
      )}
    </div>
  )
}

/** The connection types this build can open. */
export function ConnectionKindOptions() {
  const ipLinks = hasIpLinks()
  return (
    <>
      {/* The Android WebView has no Web Serial. */}
      {!isNativeApp() && <option value="serial">USB serial</option>}
      {hasUart() && <option value="uart">Internal serial</option>}
      {/* A browser cannot open raw sockets, so TCP and UDP are desktop
        only. WebSocket is the browser's route to the same targets. */}
      {ipLinks && <option value="tcp">TCP</option>}
      {ipLinks && <option value="udp">UDP</option>}
      <option value="ws">WebSocket</option>
    </>
  )
}

// The app bar: brand, mode switch, vehicle status, connection controls.
// Connect is the one orange action; the status indicators use color for
// status only and never look pressable.
export default function AppBar() {
  const phase = useConnectionStore((s) => s.phase)
  const selectedKind = useConnectionStore((s) => s.selectedKind)
  const compact = useCompact()
  const setSelectedKind = useConnectionStore((s) => s.setSelectedKind)
  const setConnectModalOpen = useUiStore((s) => s.setConnectModalOpen)
  const setPreferencesOpen = useUiStore((s) => s.setPreferencesOpen)

  const busy = phase === 'opening' || phase === 'handshaking'
  // During a reboot wait the service is already reopening the port, and a
  // second Connect would race it. The wait times out on its own
  // (REBOOT_RETURN_MS), and Disconnect stays live to give up sooner.
  const linked = busy || phase === 'connected' || phase === 'linkLost' || phase === 'rebooting'

  const connect = () => {
    if (selectedKind === 'serial') {
      void connectionService.connect({ kind: 'serial', baudRate: 115200 })
    } else {
      setConnectModalOpen(true)
    }
  }

  // Compact mode's bar, after QGroundControl's: the logo opens Preferences
  // (theme included), the readings open their detail, and one control shows
  // the link. The SITL tray is desktop-sized; the Layout preference restores
  // it.
  if (compact) {
    return (
      <header className="la-appbar">
        <div className="app-bar__band">
          <button
            type="button"
            className="app-bar__logo-btn"
            aria-label="Preferences"
            title="Preferences"
            onClick={() => setPreferencesOpen(true)}
          >
            <img className="la-appbar__logo la-appbar__logo--badge" src={BRAND.iconPath} alt="" />
          </button>
          <ModeSwitch compact />
        </div>
        <div className="app-bar__band app-bar__band--center">
          <CompactStatus />
          <JoystickChip />
        </div>
        <ParamProgress />
        <div className="app-bar__band app-bar__band--right">
          <CompactLink />
        </div>
      </header>
    )
  }

  return (
    // A three-track grid (`1fr auto 1fr`) centers the status on the window
    // rather than between the two side groups, which differ in width.
    //
    // Spacers would not work anyway: `lofted-aero.css` sets
    // `.la-appbar__spacer { flex: 1 1 auto }` and then overrides it with
    // `.la-appbar > * { flex: none }` at higher specificity.
    <header className="la-appbar">
      <div className="app-bar__band">
        <img
          className="la-appbar__logo la-appbar__logo--badge"
          src={BRAND.iconPath}
          alt={BRAND.name}
        />
        <span className="la-appbar__title">{BRAND.name}</span>
        <ModeSwitch />
        {/* SITL runs on a desktop; the Android app cannot start it. */}
        {!isNativeApp() && <SimTray />}
        <button
          type="button"
          className="app-theme-toggle"
          title="Preferences — units, appearance"
          aria-label="Preferences"
          onClick={() => setPreferencesOpen(true)}
        >
          <GearIcon />
        </button>
        <ThemeToggle />
      </div>

      {/* Always rendered: it holds the grid's middle track. */}
      <div className="app-bar__band app-bar__band--center">
        <AppStatus />
        <JoystickChip />
      </div>

      {/* Absolutely positioned along the bar's bottom edge, outside the grid. */}
      <ParamProgress />

      <div className="app-bar__band app-bar__band--right">
        <LaSelect
          value={selectedKind}
          disabled={linked}
          onChange={(e) => setSelectedKind(e.target.value as TransportKind)}
          title="Connection type"
        >
          <ConnectionKindOptions />
        </LaSelect>
        <LaButton variant="primary" disabled={linked} onClick={connect}>
          Connect
        </LaButton>
        <LaButton
          variant="ghost"
          disabled={phase === 'idle' || phase === 'error'}
          onClick={() => void connectionService.disconnect()}
        >
          Disconnect
        </LaButton>
      </div>
    </header>
  )
}

/** A gear: eight teeth on a ring. */
function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="-12 -12 24 24" aria-hidden="true">
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
        <rect
          key={a}
          x="-1.7"
          y="-9.6"
          width="3.4"
          height="4.2"
          rx="0.8"
          fill="currentColor"
          transform={`rotate(${a})`}
        />
      ))}
      <circle r="6.4" fill="none" stroke="currentColor" strokeWidth="2.6" />
      <circle r="2.2" fill="currentColor" />
    </svg>
  )
}
