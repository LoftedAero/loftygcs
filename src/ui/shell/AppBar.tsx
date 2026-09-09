import { BRAND } from '../../brand'
import { LaButton, LaSelect } from '../components/La'
import { useConnectionStore } from '../../stores/connection-store'
import { MODES, useUiStore } from '../../stores/ui-store'
import { connectionService } from '../../services/connection'
import AppStatus from './AppStatus'
import SimTray from './SimTray'
import ThemeToggle from './ThemeToggle'
import { hasIpLinks } from '../../env'
import type { TransportKind } from '../../transport/Transport'

// Top-level mode switch. Deliberately NOT orange: the bar already has one
// primary action (Connect), and the house rule is one per region. The active
// segment inverts to a light surface instead, which reads as "you are here"
// without competing for the eye.
function ModeSwitch() {
  const mode = useUiStore((s) => s.mode)
  const setMode = useUiStore((s) => s.setMode)
  return (
    <div className="app-modes" role="tablist" aria-label="Mode">
      {MODES.map((m) => (
        <button
          key={m.id}
          role="tab"
          aria-selected={m.id === mode}
          className={m.id === mode ? 'app-modes__item app-modes__item--active' : 'app-modes__item'}
          onClick={() => setMode(m.id)}
        >
          {m.label}
        </button>
      ))}
    </div>
  )
}

// The charcoal app bar: brand badge, title, mode switch, vehicle status,
// connection controls. Connect stays the one orange action in the bar
// (DESIGN.md color hierarchy) -- which is why the status indicators beside
// it are color-as-status only and never look pressable.
export default function AppBar() {
  const phase = useConnectionStore((s) => s.phase)
  const selectedKind = useConnectionStore((s) => s.selectedKind)
  const ipLinks = hasIpLinks()
  const setSelectedKind = useConnectionStore((s) => s.setSelectedKind)
  const setConnectModalOpen = useUiStore((s) => s.setConnectModalOpen)
  const setPreferencesOpen = useUiStore((s) => s.setPreferencesOpen)

  const busy = phase === 'opening' || phase === 'handshaking'

  const connect = () => {
    if (selectedKind === 'serial') {
      void connectionService.connect({ kind: 'serial', baudRate: 115200 })
    } else if (selectedKind === 'virtual') {
      void connectionService.connect({ kind: 'virtual' })
    } else {
      setConnectModalOpen(true)
    }
  }

  return (
    // Three bands, and the middle one is centered on the *window* rather
    // than on the space the other two leave. That needs three tracks: a
    // pair of spacers can only center between the groups, and this bar's
    // groups differ by about 230px, so the status sat visibly right of
    // center. `1fr auto 1fr` puts it on the window's midline whenever both
    // sides fit, and gives way gracefully when they do not.
    //
    // Grid rather than the sheet's flex row for the same reason -- and it
    // avoids a trap: `lofted-aero.css` sets `.la-appbar__spacer { flex: 1 1
    // auto }` and then `.la-appbar > * { flex: none }` twelve lines later,
    // at higher specificity, so its spacer has never actually sprung.
    <header className="la-appbar">
      <div className="app-bar__band">
        <img
          className="la-appbar__logo la-appbar__logo--badge"
          src={BRAND.iconPath}
          alt={BRAND.name}
        />
        <span className="la-appbar__title">{BRAND.name}</span>
        <ModeSwitch />
        <SimTray />
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

      {/* Always rendered, empty or not: it is the grid's middle track, and
          without it the connection controls would fall into it. */}
      <div className="app-bar__band app-bar__band--center">
        <AppStatus />
      </div>

      <div className="app-bar__band app-bar__band--right">
        <LaSelect
          value={selectedKind}
          disabled={busy || phase === 'connected' || phase === 'linkLost'}
          onChange={(e) => setSelectedKind(e.target.value as TransportKind)}
          title="Connection type"
        >
          <option value="serial">USB serial</option>
          {/* A browser tab cannot open a raw socket, so offering TCP and UDP
            there is offering two ways to fail. They are the first thing
            anyone opens this menu to look at, which made the web build read
            as broken before it had done anything. A WebSocket bridge is the
            browser's route to the same simulators and radios, and it stays. */}
          {ipLinks && <option value="tcp">TCP</option>}
          {ipLinks && <option value="udp">UDP</option>}
          <option value="ws">WebSocket</option>
          <option value="virtual">Demo</option>
        </LaSelect>
        <LaButton
          variant="primary"
          disabled={busy || phase === 'connected' || phase === 'linkLost'}
          onClick={connect}
        >
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

/** A gear, drawn rather than imported: eight teeth on a ring. */
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
