import { useUnits } from '../../../stores/preferences-store'
import { distanceLabel, fromDistance, toDistance } from '../../../units'
import { LaInput, LaSelect } from '../../components/La'
import { useMissionStore } from '../../../stores/mission-store'
import { MAV_FRAMES } from '../../../protocol/mission-commands'

// What a newly placed item gets: its altitude, and which datum that
// altitude is measured from.
//
// On the item list's own header rather than in the settings column, because
// they are the two fields every row underneath is stamped with -- reading
// them in the same glance as the rows they produced is the whole point, and
// the column is where you look for what to *do*, not for what the next
// click will be worth.
//
// Shown on all three plans, because the list under them is always the
// mission list whichever plan is being edited -- and the altitude is live on
// Rally as well, where a new point is placed at it.
//
// The vehicle has never heard of either: they are editor settings, and
// changing one does not touch an item already placed.

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
      {/* The short names, because the header has no room for "Above mean sea
          level" -- and they are the same short names the rows below use, so
          the setting and its result read alike. The long form is on hover. */}
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
