import { useMissionStore } from '../../../stores/mission-store'
import { useUnits } from '../../../stores/preferences-store'
import { distanceLabel, fromDistance, toDistance } from '../../../units'
import { LaField, LaHint, LaInput } from '../../components/La'

// Rally points: the places a vehicle is sent instead of home.
//
// Simpler than the fence in every way -- one item each on the wire, one
// marker each on the map, and the only thing to set is how high to arrive.
// There is no tool to arm: while this is the plan being edited, a map click
// adds a point, the same way a click adds a waypoint in Mission.
//
// Read, write and clear are in PlanActions above, shared with the other two
// plans, so this is only the list.

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
          {/* Relative to home, always: ArduPilot stores rally altitudes
                that way, and an AMSL number typed here would arrive as a
                very different height. */}
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
