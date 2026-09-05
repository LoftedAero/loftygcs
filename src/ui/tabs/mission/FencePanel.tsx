import { useState } from 'react'
import { useUnits } from '../../../stores/preferences-store'
import { distanceLabel, fromDistance, toDistance } from '../../../units'
import { LaButton, LaField, LaHint, LaInput } from '../../components/La'
import { fenceDirty, useMissionStore, type FenceTool } from '../../../stores/mission-store'
import { useConnectionStore } from '../../../stores/connection-store'
import { readFence, writeFence } from '../../../services/geofence'
import { polygonAreaM2 } from '../../../protocol/survey'
import { validateFence } from '../../../protocol/geofence'

// The geofence column: transfer at the top, then the tools that draw, then
// the shapes that exist.
//
// Ordered the way the actions column is ordered everywhere else -- what you
// do to the vehicle, then what you do to the plan, then what you set. Write
// is the one orange action, because it is the one that changes what the
// aircraft will refuse to fly past.

const TOOLS: { id: FenceTool; label: string; hint: string }[] = [
  { id: 'inclusionPolygon', label: 'Inclusion area', hint: 'Stay inside this' },
  { id: 'exclusionPolygon', label: 'Exclusion area', hint: 'Stay out of this' },
  { id: 'inclusionCircle', label: 'Inclusion circle', hint: 'Stay within a radius' },
  { id: 'exclusionCircle', label: 'Exclusion circle', hint: 'Stay clear by a radius' },
  { id: 'returnPoint', label: 'Return point', hint: 'Where a breach sends it' },
]

export default function FencePanel() {
  const units = useUnits()
  const connected = useConnectionStore((s) => s.phase === 'connected')
  const fence = useMissionStore((s) => s.fence)
  const synced = useMissionStore((s) => s.fenceSynced)
  const dirty = useMissionStore(fenceDirty)
  const tool = useMissionStore((s) => s.fenceTool)
  const draft = useMissionStore((s) => s.fenceDraft)
  const selected = useMissionStore((s) => s.selectedShape)
  const setTool = useMissionStore((s) => s.setFenceTool)
  const finish = useMissionStore((s) => s.finishFenceShape)
  const removeShape = useMissionStore((s) => s.removeShape)
  const updateShape = useMissionStore((s) => s.updateShape)
  const selectShape = useMissionStore((s) => s.selectShape)
  const setReturn = useMissionStore((s) => s.setFenceReturn)
  const setFence = useMissionStore((s) => s.setFence)
  const transfer = useMissionStore((s) => s.transfer)
  const [busy, setBusy] = useState(false)

  const working = busy || transfer.kind === 'busy'
  const drawingPolygon = tool === 'inclusionPolygon' || tool === 'exclusionPolygon'
  const problems = validateFence(fence)

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
          <h3 className="app-col__head">Fence</h3>
          <span className={`mission-badge${dirty ? ' is-dirty' : synced ? ' is-synced' : ''}`}>
            {!synced ? 'Not on vehicle' : dirty ? 'Modified' : 'Matches vehicle'}
          </span>
        </div>

        <LaButton
          variant="secondary"
          size="block"
          disabled={working || !connected}
          onClick={() => void run(readFence)}
        >
          Read from vehicle
        </LaButton>
        <LaButton
          variant="primary"
          size="block"
          disabled={working || !connected || problems.length > 0}
          onClick={() => void run(writeFence)}
        >
          Write to vehicle
        </LaButton>
        {!connected && <LaHint>Connect a vehicle to read or write.</LaHint>}
        {transfer.kind === 'error' && <LaHint error>{transfer.text}</LaHint>}
        {transfer.kind === 'done' && <p className="app-col__note">{transfer.text}</p>}

        <LaButton
          variant="ghost"
          size="block"
          disabled={working || (fence.shapes.length === 0 && !fence.returnPoint)}
          onClick={() => setFence({ shapes: [], returnPoint: null })}
        >
          Clear fence
        </LaButton>
        {/* Writing an empty fence is how a fence is removed, so say it --
            clearing the screen alone leaves the vehicle still enforcing. */}
        <LaHint>
          Clearing only changes the screen. Write to remove the fence from the vehicle.
        </LaHint>
      </section>

      <section className="app-col__group">
        <h3 className="app-col__head">Add</h3>
        {TOOLS.map((t) => (
          <LaButton
            key={t.id}
            variant={tool === t.id ? 'primary' : 'secondary'}
            size="block"
            title={t.hint}
            onClick={() => setTool(tool === t.id ? null : t.id)}
          >
            {t.label}
          </LaButton>
        ))}
        {drawingPolygon && (
          <>
            <p className="app-col__note">
              {draft.length} {draft.length === 1 ? 'corner' : 'corners'} — click the map to add.
            </p>
            <LaButton variant="primary" size="block" disabled={draft.length < 3} onClick={finish}>
              Finish shape
            </LaButton>
            <LaButton variant="ghost" size="block" onClick={() => setTool(null)}>
              Cancel
            </LaButton>
          </>
        )}
        {tool && !drawingPolygon && <LaHint>Click the map to place it.</LaHint>}
      </section>

      <section className="app-col__group">
        <h3 className="app-col__head">Shapes</h3>
        {fence.shapes.length === 0 && !fence.returnPoint && (
          <LaHint>No fence yet. Add an inclusion area to keep the aircraft inside it.</LaHint>
        )}

        {fence.shapes.map((s, i) => (
          <div
            key={s.uid}
            className={`fence-item${selected === s.uid ? ' is-selected' : ''}`}
            onClick={() => selectShape(s.uid)}
          >
            <div className="fence-item__head">
              <span className={`fence-dot${s.inclusive ? ' is-inclusive' : ' is-exclusive'}`} />
              <span className="fence-item__name">
                {s.inclusive ? 'Inclusion' : 'Exclusion'} {s.kind}
              </span>
              <button
                type="button"
                className="fence-item__x"
                aria-label={`Remove shape ${i + 1}`}
                onClick={(e) => {
                  e.stopPropagation()
                  removeShape(s.uid)
                }}
              >
                ✕
              </button>
            </div>
            {s.kind === 'circle' ? (
              <LaField
                label="Radius"
                unit={distanceLabel(units.distance)}
                htmlFor={`r-${s.uid}`}
                stacked
              >
                <LaInput
                  num
                  id={`r-${s.uid}`}
                  type="number"
                  min={1}
                  value={Math.round(toDistance(s.radiusM, units.distance))}
                  onChange={(e) =>
                    updateShape(s.uid, {
                      radiusM: fromDistance(Number(e.target.value), units.distance),
                    })
                  }
                />
              </LaField>
            ) : (
              <p className="app-col__note">
                {s.points.length} corners · {formatArea(polygonAreaM2(s.points))}
              </p>
            )}
          </div>
        ))}

        {fence.returnPoint && (
          <div className="fence-item">
            <div className="fence-item__head">
              <span className="fence-dot is-return" />
              <span className="fence-item__name">Return point</span>
              <button
                type="button"
                className="fence-item__x"
                aria-label="Remove return point"
                onClick={() => setReturn(null)}
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Named before upload, because the vehicle's rejection is a single
            error code that does not say which shape it disliked. */}
        {problems.map((p) => (
          <LaHint key={p} error>
            {p}
          </LaHint>
        ))}
      </section>
    </>
  )
}

function formatArea(m2: number): string {
  if (m2 >= 1e6) return `${(m2 / 1e6).toFixed(2)} km²`
  if (m2 >= 10000) return `${(m2 / 10000).toFixed(2)} ha`
  return `${Math.round(m2)} m²`
}
