import { useEffect, useState } from 'react'
import { LaField, LaHint, LaInput, LaSelect } from '../../components/La'
import { useParamStore } from '../../../stores/param-store'
import { useConnectionStore } from '../../../stores/connection-store'
import { connectionService } from '../../../services/connection'
import { usePreferencesStore } from '../../../stores/preferences-store'
import { usePlanVehicleIsAssumed } from './plan-vehicle'
import type { VehicleClass } from '../../../protocol/modes'

// What is left of the mission settings column: the vehicle parameters that
// happen to be about mission flying.
//
// It held three kinds of thing and they belonged in three places, which is
// why only one is still here. Home is a point on the map, so it is edited
// from its own marker. Default altitude and altitude frame decide what the
// *next* placed item gets, so they sit on the item list's header beside the
// rows they stamp. What genuinely belongs in a column is what persists on
// the aircraft: waypoint and loiter radius are parameters, written the way
// every other parameter is, ack-verified.
//
// Mission speed used to sit here as a button that added a DO_CHANGE_SPEED
// item. It is out for now; when it returns it belongs in the item list, not
// in a settings panel, because a "speed" that never appeared among the items
// leaves nobody able to explain why the aircraft ignored it.

/** Radius parameters worth surfacing, by the vehicle that has them. */
const RADIUS_PARAMS = [
  { name: 'WPNAV_RADIUS', label: 'Waypoint radius', unit: 'cm', hint: 'Copter' },
  { name: 'WP_RADIUS', label: 'Waypoint radius', unit: 'm', hint: 'Plane and Rover' },
  { name: 'WP_LOITER_RAD', label: 'Loiter radius', unit: 'm', hint: 'Plane' },
]

/**
 * The radius parameters, edited live. Only the ones this vehicle actually
 * has are shown -- the same rule the curated Setup cards follow, so one
 * definition serves Copter, Plane and Rover.
 */
export default function RadiusParams() {
  const entries = useParamStore((s) => s.entries)
  const connected = useConnectionStore((s) => s.phase === 'connected')
  const assumed = usePlanVehicleIsAssumed()
  const present = RADIUS_PARAMS.filter((p) => entries.has(p.name))
  // The class picker stands on its own: with nothing connected there are no
  // radius parameters to show, and that is exactly when it is needed.
  if (present.length === 0 && !assumed) return null

  return (
    <section className="app-col__group">
      <h3 className="app-col__head">Vehicle</h3>
      {assumed && <PlanForPicker />}
      {present.map((p) => (
        <RadiusField key={p.name} name={p.name} label={p.label} unit={p.unit} enabled={connected} />
      ))}
      {present.length > 0 && (
        <LaHint>Stored on the vehicle, not in the mission. Written when you press Enter.</LaHint>
      )}
    </section>
  )
}

/**
 * What to plan for when nothing is connected.
 *
 * The command set is not the same for every aircraft -- spline waypoints and
 * payload place are Copter-only, and ArduPlane refuses them on upload -- so a
 * plan made offline has to be made *for* something. QGroundControl asks the
 * same question for the same stated reason; Mission Planner does not, always
 * assumes Copter, and has an open issue about it.
 *
 * Shown only while the vehicle is unknown. A connected aircraft answers this
 * itself and is never overridden by a preference.
 */
function PlanForPicker() {
  const planFor = usePreferencesStore((s) => s.planFor)
  const setPlanFor = usePreferencesStore((s) => s.setPlanFor)
  return (
    <>
      <LaField label="Planning for" htmlFor="plan-for">
        <LaSelect
          id="plan-for"
          value={planFor}
          onChange={(e) => setPlanFor(e.target.value as VehicleClass)}
        >
          <option value="copter">Copter</option>
          <option value="plane">Plane</option>
          <option value="rover">Rover</option>
        </LaSelect>
      </LaField>
      <LaHint>Decides which commands this plan can use. A connected vehicle sets it itself.</LaHint>
    </>
  )
}

function RadiusField({
  name,
  label,
  unit,
  enabled,
}: {
  name: string
  label: string
  unit: string
  enabled: boolean
}) {
  const entry = useParamStore((s) => s.entries.get(name))
  const [draft, setDraft] = useState('')
  const [note, setNote] = useState<string | null>(null)

  // Follow the vehicle unless the field is being edited.
  useEffect(() => {
    if (entry) setDraft(String(round(entry.value)))
  }, [entry])

  const commit = async () => {
    const value = Number(draft)
    if (!Number.isFinite(value) || !entry || value === entry.value) return
    try {
      await connectionService.setParamNow(name, value)
      setNote(null)
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Write failed')
    }
  }

  return (
    <>
      <LaField label={label} unit={unit} htmlFor={`mission-${name}`} stacked>
        <LaInput
          num
          id={`mission-${name}`}
          type="number"
          disabled={!enabled}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commit()
          }}
        />
      </LaField>
      {note && <LaHint error>{note}</LaHint>}
    </>
  )
}

function round(v: number): number {
  return Math.round(v * 100) / 100
}
