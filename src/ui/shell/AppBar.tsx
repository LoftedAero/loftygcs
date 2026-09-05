import { BRAND } from '../../brand'
import { LaButton, LaReadout, LaSelect } from '../components/La'
import { useConnectionStore } from '../../stores/connection-store'
import { useVehicleStore } from '../../stores/vehicle-store'
import { MODES, useUiStore } from '../../stores/ui-store'
import { connectionService } from '../../services/connection'
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

// The charcoal app bar: brand badge, title, link status, connection
// controls. Connect stays the one orange action in the bar (DESIGN.md
// color hierarchy).
export default function AppBar() {
  const phase = useConnectionStore((s) => s.phase)
  const error = useConnectionStore((s) => s.error)
  const selectedKind = useConnectionStore((s) => s.selectedKind)
  const ipLinks = hasIpLinks()
  const setSelectedKind = useConnectionStore((s) => s.setSelectedKind)
  const vehicleName = useVehicleStore((s) => s.vehicleName)
  const vehicleMode = useVehicleStore((s) => s.modeName)
  const vehicleArmed = useVehicleStore((s) => s.armed)
  const vehiclePresent = useVehicleStore((s) => s.present)
  const setConnectModalOpen = useUiStore((s) => s.setConnectModalOpen)

  const busy = phase === 'opening' || phase === 'handshaking'

  const status = (() => {
    switch (phase) {
      case 'idle':
        return undefined // readout shows its placeholder
      case 'opening':
        return 'Opening link…'
      case 'handshaking':
        return 'Waiting for heartbeat…'
      case 'linkLost':
        return 'Link lost — no heartbeat'
      case 'error':
        return error ?? 'Connection failed'
      case 'connected':
        return vehiclePresent
          ? `${vehicleName} · ${vehicleMode} · ${vehicleArmed ? 'ARMED' : 'Disarmed'}`
          : 'Connected'
    }
  })()

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
    <header className="la-appbar">
      <img
        className="la-appbar__logo la-appbar__logo--badge"
        src={BRAND.iconPath}
        alt={BRAND.name}
      />
      <span className="la-appbar__title">{BRAND.name}</span>
      <ModeSwitch />
      <span className="la-appbar__spacer"></span>
      <SimTray />
      <ThemeToggle />
      <LaReadout wide placeholder="Not connected" value={status} />
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
    </header>
  )
}
