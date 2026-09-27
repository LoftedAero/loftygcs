import { useUnits } from '../../../stores/preferences-store'
import { distanceLabel, fromDistance, toDistance } from '../../../units'
import { LaField, LaHint, LaInput } from '../../components/La'
import { useMissionStore } from '../../../stores/mission-store'
import { polygonAreaM2 } from '../../../protocol/survey'
import { validateFence } from '../../../protocol/geofence'

// The shapes a fence is made of.
//
// Only the list: read, write and clear live in PlanActions, and the drawing
// tools in FencePalette on the map. It sits at the foot of the column because
// it grows, and the buttons above it should not move as shapes are added.
export default function FencePanel() {
  const units = useUnits()
  const fence = useMissionStore((s) => s.fence)
  const selected = useMissionStore((s) => s.selectedShape)
  const removeShape = useMissionStore((s) => s.removeShape)
  const updateShape = useMissionStore((s) => s.updateShape)
  const selectShape = useMissionStore((s) => s.selectShape)
  const setReturn = useMissionStore((s) => s.setFenceReturn)
  const problems = validateFence(fence)

  return (
    <section className="app-col__group">
      <h3 className="app-col__head">Shapes</h3>
      {fence.shapes.length === 0 && !fence.returnPoint && (
        <LaHint>No fence yet. Draw an inclusion area with the tools on the map.</LaHint>
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

      {/* Checked before upload: the vehicle rejects a bad fence with one
            error code that does not name the shape. */}
      {problems.map((p) => (
        <LaHint key={p} error>
          {p}
        </LaHint>
      ))}
    </section>
  )
}

function formatArea(m2: number): string {
  if (m2 >= 1e6) return `${(m2 / 1e6).toFixed(2)} km²`
  if (m2 >= 10000) return `${(m2 / 10000).toFixed(2)} ha`
  return `${Math.round(m2)} m²`
}
