import { useEffect, useState } from 'react'
import { LaButton, LaHint, LaModal } from '../components/La'
import { boardForId, type ReceiverWiring } from '../../protocol/lofted-boards'
import { interruptedRun } from '../../protocol/elrs/usb-passthrough'
import { catalog } from '../../services/lofted-catalog'
import { restoreReceiverSettings } from '../../services/receiver-flash'
import { useBoardSetupStore } from '../../stores/board-setup-store'
import { useConnectionStore } from '../../stores/connection-store'
import { useParamStore } from '../../stores/param-store'
import { useVehicleStore } from '../../stores/vehicle-store'

// A Lofted Aero board whose receiver write stopped before its last step still
// has no RC input and relays on the receiver's BOOT and EN pins, which a
// switch or a mission item could pull in flight. This asks to put that right
// on connection, from any screen. It reads the board's own parameters, so it
// works whichever app or computer started the write.

interface Found {
  boardId: number
  wiring: ReceiverWiring
  passthroughProtocol: number
}

export default function ReceiverRestorePrompt() {
  const connected = useConnectionStore((s) => s.phase === 'connected')
  const ready = useParamStore((s) => s.loadState === 'ready')
  const entries = useParamStore((s) => s.entries)
  const boardId = useVehicleStore((s) => s.boardId)
  const busy = useBoardSetupStore((s) => s.busy)
  const [found, setFound] = useState<Found | null>(null)
  const [later, setLater] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')

  // "Later" lasts until the link goes.
  useEffect(() => {
    if (!connected) {
      setLater(false)
      setFound(null)
      setError('')
    }
  }, [connected])

  useEffect(() => {
    if (!connected || !ready || busy || boardId <= 0 || running) return
    // Most vehicles are not Lofted Aero boards; the catalog is fetched only
    // when something looks like a write's settings (a relay on a pin, or a
    // serial port on the Scripting protocol the writes use).
    const suspect = [...entries].some(
      ([name, e]) =>
        (/^RELAY\d+_PIN$/.test(name) && e.origValue >= 0) ||
        (/^SERIAL\d_PROTOCOL$/.test(name) && e.origValue === 28),
    )
    if (!suspect) {
      setFound(null)
      return
    }
    let live = true
    void catalog()
      .then((list) => {
        const entry = boardForId(list, boardId)
        const wiring = entry?.board.receiver
        if (!live || !entry || !wiring) return
        const protocols = new Set(
          entry.releases.flatMap((r) => r.board.firmware.map((f) => f.passthroughProtocol)),
        )
        const params = new Map([...entries].map(([name, e]) => [name, e.origValue]))
        setFound(
          interruptedRun(params, wiring, protocols)
            ? { boardId, wiring, passthroughProtocol: [...protocols][0] ?? 28 }
            : null,
        )
      })
      // Without the catalog there is no wiring to check against.
      .catch(() => {})
    return () => {
      live = false
    }
  }, [connected, ready, busy, boardId, entries, running])

  if (!found || later || busy) return null

  const restore = async () => {
    setRunning(true)
    setError('')
    try {
      await restoreReceiverSettings(found)
      setFound(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  return (
    <LaModal
      open
      narrow
      title="Partial receiver configuration detected, continue update?"
      actions={
        <>
          <LaButton variant="ghost" disabled={running} onClick={() => setLater(true)}>
            Later
          </LaButton>
          <LaButton variant="primary" disabled={running} onClick={() => void restore()}>
            {running ? 'Restoring…' : error ? 'Try again' : 'Restore'}
          </LaButton>
        </>
      }
    >
      <LaHint error>{error}</LaHint>
    </LaModal>
  )
}
