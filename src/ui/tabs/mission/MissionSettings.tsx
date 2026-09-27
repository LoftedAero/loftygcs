import { useEffect, useState } from 'react'
import { LaField, LaHint, LaInput, LaSelect } from '../../components/La'
import { useParamStore } from '../../../stores/param-store'
import { useConnectionStore } from '../../../stores/connection-store'
import { connectionService } from '../../../services/connection'
import { usePreferencesStore } from '../../../stores/preferences-store'
import { usePlanVehicleIsAssumed } from './plan-vehicle'
import type { VehicleClass } from '../../../protocol/modes'

// The vehicle parameters that concern mission flying: waypoint and loiter
// radius, written ack-verified like any other parameter.
//
// Home is edited from its marker, and default altitude and frame from the
// item list's header, since they apply to the next item placed.

/** Radius parameters worth surfacing, by the vehicle that has them. */
const RADIUS_PARAMS = [
  { name: 'WPNAV_RADIUS', label: 'Waypoint radius', unit: 'cm', hint: 'Copter' },
  { name: 'WP_RADIUS', label: 'Waypoint radius', unit: 'm', hint: 'Plane and Rover' },
  { name: 'WP_LOITER_RAD', label: 'Loiter radius', unit: 'm', hint: 'Plane' },
]

/**
 * The radius parameters, edited live. Only the ones this vehicle has are
 * shown, so one definition serves Copter, Plane and Rover.
 */
export default function RadiusParams() {
  const entries = useParamStore((s) => s.entries)
  const connected = useConnectionStore((s) => s.phase === 'connected')
  const assumed = usePlanVehicleIsAssumed()
  const present = RADIUS_PARAMS.filter((p) => entries.has(p.name))
  // The class picker shows even with no radius parameters, since it is
  // needed exactly when nothing is connected.
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
 * The command set differs by aircraft (spline waypoints and payload place are
 * Copter-only, and ArduPlane refuses them on upload), so an offline plan
 * needs a target. QGroundControl asks the same question.
 *
 * Shown only while the vehicle is unknown; a connected vehicle decides.
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
