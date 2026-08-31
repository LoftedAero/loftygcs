import { useEffect, useState } from 'react'
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
// The honest complication is that they do not all live in the same place.
// Default altitude and altitude frame are *editor* settings -- they decide
// what a newly placed item gets, and the vehicle has never heard of them.
// Waypoint and loiter radius are *vehicle parameters*, so they persist on
// the aircraft and are written the way every other parameter is: ack
// verified, one at a time. Mission speed is neither: it is a DO_CHANGE_SPEED
// item in the mission itself, which is why it is a button that adds one.
//
// Pretending all four were the same thing would be tidier and wrong -- a
// user who set "speed" here and never saw it in the item list would have no
// idea why the aircraft ignored it.

/** Radius parameters worth surfacing, by the vehicle that has them. */
const RADIUS_PARAMS = [
  { name: 'WPNAV_RADIUS', label: 'Waypoint radius', unit: 'cm', hint: 'Copter' },
  { name: 'WP_RADIUS', label: 'Waypoint radius', unit: 'm', hint: 'Plane and Rover' },
  { name: 'WP_LOITER_RAD', label: 'Loiter radius', unit: 'm', hint: 'Plane' },
]

export default function MissionSettings() {
  const defaults = useMissionStore((s) => s.defaults)
  const setDefaults = useMissionStore((s) => s.setDefaults)
  const home = useMissionStore((s) => s.plan.home)
  const setHome = useMissionStore((s) => s.setHome)
  const addItem = useMissionStore((s) => s.addItem)
  const updateItem = useMissionStore((s) => s.updateItem)
  const connected = useConnectionStore((s) => s.phase === 'connected')
  const [homeNote, setHomeNote] = useState<string | null>(null)

  return (
    <div className="mission-settings">
      <section className="mission-settings__group">
        <h3 className="mission-settings__head">New items</h3>
        <LaField label="Default altitude" unit="m" htmlFor="mission-alt" stacked>
          <LaInput
            num
            id="mission-alt"
            type="number"
            min={0}
            value={defaults.altM}
            onChange={(e) => setDefaults({ altM: Number(e.target.value) })}
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

      <section className="mission-settings__group">
        <h3 className="mission-settings__head">Speed</h3>
        <LaHint>
          Mission speed is an item, not a setting: it takes effect where it sits in the list.
        </LaHint>
        <LaButton
          variant="secondary"
          size="block"
          onClick={() => {
            const uid = addItem(178)
            // Groundspeed, and no throttle change: the pair of defaults that
            // makes the item do the one thing its name promises.
            updateItem(uid, { param1: 1, param2: 5, param3: -1 })
          }}
        >
          Add a speed change
        </LaButton>
      </section>

      <section className="mission-settings__group">
        <h3 className="mission-settings__head">Planned home</h3>
        {home ? (
          <>
            <div className="mission-settings__coords">
              {(home.x / 1e7).toFixed(7)}, {(home.y / 1e7).toFixed(7)}
            </div>
            <LaField label="Altitude" unit="m AMSL" htmlFor="mission-home-alt" stacked>
              <LaInput
                num
                id="mission-home-alt"
                type="number"
                value={Math.round(home.z)}
                onChange={(e) => setHome({ ...home, z: Number(e.target.value) })}
              />
            </LaField>
          </>
        ) : (
          <LaHint>Not set. Use Add ▸ Home, or copy the vehicle's.</LaHint>
        )}
        <LaButton
          variant="secondary"
          size="block"
          disabled={!connected}
          onClick={() => {
            setHomeNote(
              homeFromVehicle() ? null : 'The vehicle has no position fix to copy yet.',
            )
          }}
        >
          Use vehicle position
        </LaButton>
        {homeNote && <LaHint error>{homeNote}</LaHint>}
        <LaHint>
          Relative altitudes are measured from here. The vehicle replaces it with its own
          position when it arms, so this is a planning reference.
        </LaHint>
      </section>

      <RadiusParams />
    </div>
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
    <section className="mission-settings__group">
      <h3 className="mission-settings__head">Vehicle</h3>
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
