import { useUnits } from '../../../stores/preferences-store'
import { distanceLabel, fromDistance, toDistance } from '../../../units'
import { LaInput, LaSelect } from '../../components/La'
import { useMissionStore } from '../../../stores/mission-store'
import { MAV_FRAMES } from '../../../protocol/mission-commands'

// The altitude and altitude frame given to a newly placed item. They sit on
// the item list's header, beside the rows they stamp, on all three plans
// (the altitude also applies to new rally points).
//
// Editor settings only: nothing is sent to the vehicle, and existing items
// are not changed.

export default function NewItemDefaults() {
  const units = useUnits()
  const defaults = useMissionStore((s) => s.defaults)
  const setDefaults = useMissionStore((s) => s.setDefaults)

  return (
    <div className="mission-defaults">
      <label className="mission-defaults__label" htmlFor="mission-alt">
        Default altitude
      </label>
      <LaInput
        num
        id="mission-alt"
        className="mission-defaults__alt"
        type="number"
        min={0}
        title="The altitude a newly placed waypoint or rally point gets"
        value={Math.round(toDistance(defaults.altM, units.distance))}
        onChange={(e) =>
          setDefaults({ altM: fromDistance(Number(e.target.value), units.distance) })
        }
      />
      <span className="mission-defaults__unit">{distanceLabel(units.distance)}</span>
      <label className="mission-defaults__label" htmlFor="mission-frame">
        Altitude mode
      </label>
      {/* Short names, matching the rows; the long form is in the tooltip. */}
      <LaSelect
        id="mission-frame"
        className="mission-defaults__frame"
        title="The datum a newly placed item's altitude is measured from"
        value={defaults.frame}
        onChange={(e) => setDefaults({ frame: Number(e.target.value) })}
      >
        {MAV_FRAMES.map((f) => (
          <option key={f.value} value={f.value} title={f.label}>
            {f.short}
          </option>
        ))}
      </LaSelect>
    </div>
  )
}
