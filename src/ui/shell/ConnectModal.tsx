import { useState } from 'react'
import { LaButton, LaField, LaHint, LaInput, LaModal, LaSelect } from '../components/La'
import { useConnectionStore } from '../../stores/connection-store'
import { useUiStore } from '../../stores/ui-store'
import { connectionService } from '../../services/connection'
import type { TransportKind } from '../../transport/Transport'
import { useCompact } from '../compact'
import { ConnectionKindOptions } from './AppBar'

// Host/port entry for the network link kinds. Serial connects straight
// from the app bar; TCP, UDP, WebSocket and internal serial need something
// typed in.
// Defaults are the ArduPilot conventions: SITL listens on TCP 5760, GCSes
// listen on UDP 14550.
//
// All three share one layout: same card width, label-beside-control rows,
// and equal-width inputs (see `.connect-form` in app.css).
const TITLES: Record<string, string> = {
  tcp: 'Connect over TCP',
  udp: 'Listen on UDP',
  ws: 'Connect to WebSocket bridge',
  uart: 'Connect over internal serial',
}

export default function ConnectModal() {
  const open = useUiStore((s) => s.connectModalOpen)
  const setOpen = useUiStore((s) => s.setConnectModalOpen)
  const kind = useConnectionStore((s) => s.selectedKind)
  const setKind = useConnectionStore((s) => s.setSelectedKind)
  // Compact mode's app bar has no type menu, so the type is chosen here.
  const compact = useCompact()

  const [host, setHost] = useState('127.0.0.1')
  const [port, setPort] = useState('5760')
  const [localPort, setLocalPort] = useState('14550')
  const [wsUrl, setWsUrl] = useState('ws://127.0.0.1:5678')
  // The Radiomaster AX12's ELRS module.
  const [uartPath, setUartPath] = useState('/dev/ttyS1')
  const [baud, setBaud] = useState('460800')
  const [hint, setHint] = useState('')

  const connect = () => {
    setHint('')
    if (kind === 'serial') {
      void connectionService.connect({ kind: 'serial', baudRate: 115200 })
    } else if (kind === 'tcp') {
      const p = Number(port)
      if (!Number.isInteger(p) || p < 1 || p > 65535) {
        setHint('Port must be 1-65535.')
        return
      }
      void connectionService.connect({ kind: 'tcp', host, port: p })
    } else if (kind === 'udp') {
      const p = Number(localPort)
      if (!Number.isInteger(p) || p < 1 || p > 65535) {
        setHint('Port must be 1-65535.')
        return
      }
      void connectionService.connect({ kind: 'udp', localPort: p })
    } else if (kind === 'uart') {
      const b = Number(baud)
      if (!Number.isInteger(b) || b <= 0) {
        setHint('Baud rate must be a whole number.')
        return
      }
      void connectionService.connect({ kind: 'uart', path: uartPath, baudRate: b })
    } else if (kind === 'ws') {
      if (!/^wss?:\/\//.test(wsUrl)) {
        setHint('URL must start with ws:// or wss://.')
        return
      }
      void connectionService.connect({ kind: 'ws', url: wsUrl })
    }
    setOpen(false)
  }

  // Mount only while open, which keeps duplicate buttons out of the DOM.
  if (!open) return null

  return (
    <LaModal
      open={open}
      title={compact ? 'Connect' : (TITLES[kind] ?? 'Connect')}
      actions={
        <>
          <LaButton variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </LaButton>
          <LaButton variant="primary" onClick={connect}>
            Connect
          </LaButton>
        </>
      }
    >
      <div className="connect-form">
        {compact && (
          <LaField label="Connection" htmlFor="conn-kind">
            <LaSelect
              id="conn-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as TransportKind)}
            >
              <ConnectionKindOptions />
            </LaSelect>
          </LaField>
        )}
        {kind === 'tcp' && (
          <>
            <LaField label="Host" htmlFor="conn-host">
              <LaInput id="conn-host" value={host} onChange={(e) => setHost(e.target.value)} />
            </LaField>
            <LaField label="Port" htmlFor="conn-port">
              <LaInput id="conn-port" num value={port} onChange={(e) => setPort(e.target.value)} />
            </LaField>
          </>
        )}
        {kind === 'udp' && (
          <LaField label="Listen port" htmlFor="conn-lport">
            <LaInput
              id="conn-lport"
              num
              value={localPort}
              onChange={(e) => setLocalPort(e.target.value)}
            />
          </LaField>
        )}
        {kind === 'ws' && (
          <LaField label="URL" htmlFor="conn-ws">
            <LaInput id="conn-ws" value={wsUrl} onChange={(e) => setWsUrl(e.target.value)} />
          </LaField>
        )}
        {kind === 'uart' && (
          <>
            <LaField label="Port" htmlFor="conn-uart">
              <LaInput
                id="conn-uart"
                value={uartPath}
                onChange={(e) => setUartPath(e.target.value)}
              />
            </LaField>
            <LaField label="Baud rate" htmlFor="conn-baud">
              <LaInput id="conn-baud" num value={baud} onChange={(e) => setBaud(e.target.value)} />
            </LaField>
          </>
        )}
        <LaHint error>{hint}</LaHint>
      </div>
    </LaModal>
  )
}
