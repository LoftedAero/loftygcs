import { useState } from 'react'
import { LaButton, LaField, LaHint, LaInput } from '../../components/La'
import { rallyDirty, useMissionStore } from '../../../stores/mission-store'
import { useConnectionStore } from '../../../stores/connection-store'
import { readRally, writeRally } from '../../../services/geofence'

// Rally points: the places a vehicle is sent instead of home.
//
// Simpler than the fence in every way -- one item each on the wire, one
// marker each on the map, and the only thing to set is how high to arrive.
// There is no tool to arm: while this is the plan being edited, a map click
// adds a point, the same way a click adds a waypoint in Mission.

export default function RallyPanel() {
  const connected = useConnectionStore((s) => s.phase === 'connected')
  const rally = useMissionStore((s) => s.rally)
  const synced = useMissionStore((s) => s.rallySynced)
  const dirty = useMissionStore(rallyDirty)
  const selected = useMissionStore((s) => s.selectedShape)
  const update = useMissionStore((s) => s.updateRally)
  const remove = useMissionStore((s) => s.removeRally)
  const select = useMissionStore((s) => s.selectShape)
  const setRally = useMissionStore((s) => s.setRally)
  const transfer = useMissionStore((s) => s.transfer)
  const [busy, setBusy] = useState(false)

  const working = busy || transfer.kind === 'busy'

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } catch {
      // The store carries the message; the hint below shows it.
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <section className="app-col__group">
        <div className="app-col__headrow">
          <h3 className="app-col__head">Rally</h3>
          <span className={`mission-badge${dirty ? ' is-dirty' : synced ? ' is-synced' : ''}`}>
            {!synced ? 'Not on vehicle' : dirty ? 'Modified' : 'Matches vehicle'}
          </span>
        </div>

        <LaButton
          variant="secondary"
          size="block"
          disabled={working || !connected}
          onClick={() => void run(readRally)}
        >
          Read from vehicle
        </LaButton>
        <LaButton
          variant="primary"
          size="block"
          disabled={working || !connected}
          onClick={() => void run(writeRally)}
        >
          Write to vehicle
        </LaButton>
        {!connected && <LaHint>Connect a vehicle to read or write.</LaHint>}
        {transfer.kind === 'error' && <LaHint error>{transfer.text}</LaHint>}
        {transfer.kind === 'done' && <p className="app-col__note">{transfer.text}</p>}

        <LaButton
          variant="ghost"
          size="block"
          disabled={working || rally.length === 0}
          onClick={() => setRally([])}
        >
          Clear rally points
        </LaButton>
      </section>

      <section className="app-col__group">
        <h3 className="app-col__head">Points</h3>
        {rally.length === 0 && <LaHint>Click the map to add a rally point.</LaHint>}
        {rally.map((p, i) => (
          <div
            key={p.uid}
            className={`fence-item${selected === p.uid ? ' is-selected' : ''}`}
            onClick={() => select(p.uid)}
          >
            <div className="fence-item__head">
              <span className="fence-dot is-rally" />
              <span className="fence-item__name">Rally {i + 1}</span>
              <button
                type="button"
                className="fence-item__x"
                aria-label={`Remove rally point ${i + 1}`}
                onClick={(e) => {
                  e.stopPropagation()
                  remove(p.uid)
                }}
              >
                ✕
              </button>
            </div>
            {/* Relative to home, always: ArduPilot stores rally altitudes
                that way, and an AMSL number typed here would arrive as a
                very different height. */}
            <LaField label="Altitude above home" unit="m" htmlFor={`ra-${p.uid}`} stacked>
              <LaInput
                num
                id={`ra-${p.uid}`}
                type="number"
                min={0}
                value={p.altM}
                onChange={(e) => update(p.uid, { altM: Number(e.target.value) })}
              />
            </LaField>
          </div>
        ))}
      </section>
    </>
  )
}
