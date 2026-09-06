import { useEffect, useState } from 'react'
import { useUnits } from '../../../stores/preferences-store'
import { distanceLabel, fromDistance, toDistance } from '../../../units'
import { LaButton, LaField, LaHint, LaInput, LaSelect } from '../../components/La'
import { useMissionStore } from '../../../stores/mission-store'
import { useParamStore } from '../../../stores/param-store'
import { useConnectionStore } from '../../../stores/connection-store'
import { connectionService } from '../../../services/connection'
import { homeFromVehicle } from '../../../services/mission'
import { MAV_FRAMES } from '../../../protocol/mission-commands'

// The settings column, QGroundControl's idea: the handful of things that
// apply to the whole mission, beside the map instead of buried in a row.
//
// The honest complication is that they do not all live in the same place,
// and the column is ordered so that shows.
//
// Home comes first because it is the origin every relative altitude is
// measured from -- it should be read before the altitudes are set, not after.
// Default altitude and altitude frame are *editor* settings: they decide what
// a newly placed item gets, and the vehicle has never heard of them. Waypoint
// and loiter radius are *vehicle parameters*, so they persist on the aircraft
// and are written the way every other parameter is, ack-verified.
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

export default function MissionSettings() {
  const units = useUnits()
  const defaults = useMissionStore((s) => s.defaults)
  const setDefaults = useMissionStore((s) => s.setDefaults)
  const home = useMissionStore((s) => s.plan.home)
  const setHome = useMissionStore((s) => s.setHome)
  const connected = useConnectionStore((s) => s.phase === 'connected')
  const [homeNote, setHomeNote] = useState<string | null>(null)

  // A fragment, not a nested `.app-col`. It was the only section in this
  // column wrapped in a column of its own, which gave it 12px of padding
  // nothing else had and -- because the padding is the wrapper's, not the
  // sections' -- put its own three groups on a 16px rhythm while everything
  // above them sat flush. The visible symptom was Load/save and Home
  // location touching.
  return (
    <>
      <section className="app-col__group">
        <h3 className="app-col__head">Home location</h3>
        {home ? (
          <>
            <div className="app-col__mono">
              {(home.x / 1e7).toFixed(7)}, {(home.y / 1e7).toFixed(7)}
            </div>
            <LaField
              label="Altitude"
              unit={`${distanceLabel(units.distance)} AMSL`}
              htmlFor="mission-home-alt"
              stacked
            >
              <LaInput
                num
                id="mission-home-alt"
                type="number"
                value={Math.round(toDistance(home.z, units.distance))}
                onChange={(e) =>
                  setHome({ ...home, z: fromDistance(Number(e.target.value), units.distance) })
                }
              />
            </LaField>
          </>
        ) : (
          <LaHint>Not set.</LaHint>
        )}
        <LaButton
          variant="secondary"
          size="block"
          disabled={!connected}
          onClick={() => {
            setHomeNote(homeFromVehicle() ? null : 'No position fix to copy yet.')
          }}
        >
          Use vehicle position
        </LaButton>
        {homeNote && <LaHint error>{homeNote}</LaHint>}
        <LaHint>Relative altitudes are measured from here.</LaHint>
      </section>

      <section className="app-col__group">
        <h3 className="app-col__head">General settings</h3>
        <LaField
          label="Default altitude"
          unit={distanceLabel(units.distance)}
          htmlFor="mission-alt"
          stacked
        >
          <LaInput
            num
            id="mission-alt"
            type="number"
            min={0}
            value={Math.round(toDistance(defaults.altM, units.distance))}
            onChange={(e) =>
              setDefaults({ altM: fromDistance(Number(e.target.value), units.distance) })
            }
          />
        </LaField>
        <LaField label="Altitude mode" htmlFor="mission-frame" stacked>
          <LaSelect
            id="mission-frame"
            value={defaults.frame}
            onChange={(e) => setDefaults({ frame: Number(e.target.value) })}
          >
            {MAV_FRAMES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </LaSelect>
        </LaField>
        <LaHint>Applies to items you add next, not to ones already placed.</LaHint>
      </section>

      <RadiusParams />
    </>
  )
}

/**
 * The radius parameters, edited live. Only the ones this vehicle actually
 * has are shown -- the same rule the curated Setup cards follow, so one
 * definition serves Copter, Plane and Rover.
 */
function RadiusParams() {
  const entries = useParamStore((s) => s.entries)
  const connected = useConnectionStore((s) => s.phase === 'connected')
  const present = RADIUS_PARAMS.filter((p) => entries.has(p.name))
  if (present.length === 0) return null

  return (
    <section className="app-col__group">
      <h3 className="app-col__head">Vehicle</h3>
      {present.map((p) => (
        <RadiusField key={p.name} name={p.name} label={p.label} unit={p.unit} enabled={connected} />
      ))}
      <LaHint>Stored on the vehicle, not in the mission. Written when you press Enter.</LaHint>
    </section>
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
