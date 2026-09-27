import { useMissionStore } from '../../../stores/mission-store'
import { useUnits } from '../../../stores/preferences-store'
import { distanceLabel, fromDistance, toDistance } from '../../../units'
import { LaField, LaHint, LaInput } from '../../components/La'

// Rally points: places a vehicle is sent instead of home. One item each on
// the wire; while rally is being edited, a map click adds a point.
//
// Read, write and clear live in the shared PlanActions, so this is only the
// list, placed last in the column so it grows without moving the buttons.

export default function RallyPanel() {
  const units = useUnits()
  const rally = useMissionStore((s) => s.rally)
  const selected = useMissionStore((s) => s.selectedShape)
  const update = useMissionStore((s) => s.updateRally)
  const remove = useMissionStore((s) => s.removeRally)
  const select = useMissionStore((s) => s.selectShape)

  return (
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
          {/* Relative to home, as ArduPilot stores rally altitudes. */}
          <LaField
            label="Altitude above home"
            unit={distanceLabel(units.distance)}
            htmlFor={`ra-${p.uid}`}
            stacked
          >
            <LaInput
              num
              id={`ra-${p.uid}`}
              type="number"
              min={0}
              value={Math.round(toDistance(p.altM, units.distance))}
              onChange={(e) =>
                update(p.uid, { altM: fromDistance(Number(e.target.value), units.distance) })
              }
            />
          </LaField>
        </div>
      ))}
    </section>
  )
}
