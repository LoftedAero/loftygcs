import { useState } from 'react'
import { LaButton, LaHint, LaModal } from '../../components/La'
import { isDirty, useMissionStore } from '../../../stores/mission-store'
import { useConnectionStore } from '../../../stores/connection-store'
import {
  openFromFile,
  readFromVehicle,
  saveToFile,
  writeToVehicle,
} from '../../../services/mission'
import {
  applyGeoShape,
  destinationFor,
  pickGeoFile,
  saveGpx,
  saveKml,
  type GeoFilePick,
} from '../../../services/geo-import'

// File in, file out, vehicle in, vehicle out -- and one badge saying whether
// the screen and the aircraft agree.
//
// Write is the primary action here, and it is the only one: uploading is
// what makes a plan real, and it is also the only button that changes what
// the aircraft will do if someone switches to Auto.

export default function MissionToolbar() {
  const connected = useConnectionStore((s) => s.phase === 'connected')
  const transfer = useMissionStore((s) => s.transfer)
  const dirty = useMissionStore(isDirty)
  const synced = useMissionStore((s) => s.synced)
  const items = useMissionStore((s) => s.plan.items.length)
  const sourceName = useMissionStore((s) => s.sourceName)
  const clear = useMissionStore((s) => s.clear)
  const [busy, setBusy] = useState(false)
  // A file with one shape in it is applied straight away; only a file that
  // holds several has a question in it worth asking.
  const [choosing, setChoosing] = useState<GeoFilePick | null>(null)
  const editing = useMissionStore((s) => s.editing)
  const setTransfer = useMissionStore((s) => s.setTransfer)

  const importGeo = async () => {
    const picked = await pickGeoFile()
    if (!picked) return
    const only = picked.shapes.length === 1 ? picked.shapes[0] : null
    if (only) setTransfer({ kind: 'done', text: applyGeoShape(only, picked.name) })
    else setChoosing(picked)
  }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } catch {
      // The store already carries the message; the toolbar shows it below.
    } finally {
      setBusy(false)
    }
  }

  const working = busy || transfer.kind === 'busy'

  return (
    <div className="app-col__group">
      <div className="app-col__headrow">
        <h3 className="app-col__head">Mission</h3>
        <span className={`mission-badge${dirty ? ' is-dirty' : synced ? ' is-synced' : ''}`}>
          {!synced ? 'Not on vehicle' : dirty ? 'Modified' : 'Matches vehicle'}
        </span>
      </div>

      {/* Vehicle before file: writing is the action that makes a plan real,
          and it is the one with a consequence, so it leads. One per row and
          full width -- the column is narrow enough that two to a row gave
          each a label with barely room for the word in it. */}
      <LaButton
        variant="secondary"
        size="block"
        disabled={working || !connected}
        onClick={() => void run(readFromVehicle)}
      >
        Read from vehicle
      </LaButton>
      <LaButton
        variant="primary"
        size="block"
        disabled={working || !connected || items === 0}
        onClick={() => void run(writeToVehicle)}
      >
        Write to vehicle
      </LaButton>
      {!connected && <LaHint>Connect a vehicle to read or write.</LaHint>}

      <LaButton
        variant="secondary"
        size="block"
        disabled={working}
        onClick={() => void run(openFromFile)}
      >
        Open from file
      </LaButton>
      <LaButton
        variant="secondary"
        size="block"
        disabled={working || items === 0}
        onClick={() => saveToFile(fileName(sourceName))}
      >
        Save to file
      </LaButton>

      {/* Below the native formats: this is the interchange path, used when
          something is coming from or going to a tool that is not a station. */}
      <LaButton
        variant="secondary"
        size="block"
        disabled={working}
        onClick={() =>
          void run(async () => {
            try {
              await importGeo()
            } catch (err) {
              setTransfer({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
            }
          })
        }
      >
        Import KML or GPX…
      </LaButton>
      <LaButton
        variant="ghost"
        size="block"
        disabled={working || items === 0}
        onClick={() => saveKml(exchangeName(sourceName, 'kml'))}
      >
        Export KML
      </LaButton>
      <LaButton
        variant="ghost"
        size="block"
        disabled={working || items === 0}
        onClick={() => saveGpx(exchangeName(sourceName, 'gpx'))}
      >
        Export GPX
      </LaButton>

      <LaButton variant="ghost" size="block" disabled={working || items === 0} onClick={clear}>
        Clear mission
      </LaButton>

      {transfer.kind === 'busy' ? (
        <p className="app-col__note">
          {transfer.dir === 'read' ? 'Reading' : 'Writing'} {transfer.got}
          {transfer.total ? ` of ${transfer.total}` : ''}…
        </p>
      ) : transfer.kind === 'error' ? (
        <p className="app-col__note is-error">{transfer.text}</p>
      ) : transfer.kind === 'done' ? (
        <p className="app-col__note">{transfer.text}</p>
      ) : null}

      {choosing && (
        <LaModal
          open
          narrow
          title={`Import from ${choosing.name}`}
          actions={
            <LaButton variant="ghost" onClick={() => setChoosing(null)}>
              Cancel
            </LaButton>
          }
        >
          {/* A list, not a stack of block buttons. The file holds several
              shapes and the question is only which one -- where it goes was
              settled by the plan on screen. */}
          <p className="la-hint">Pick one.</p>
          <div className="geo-pick">
            {choosing.shapes.map((shape, i) => (
              <button
                key={i}
                type="button"
                className="geo-pick__item"
                onClick={() => {
                  setTransfer({ kind: 'done', text: applyGeoShape(shape, choosing.name) })
                  setChoosing(null)
                }}
              >
                <span className="geo-pick__name">{shape.name ?? KIND_WORDS[shape.kind]}</span>
                {/* Each row says what it will become, not what it is: a
                    file can hold a line and an area, and they do not go to
                    the same place. */}
                <span className="geo-pick__meta">
                  {DESTINATION_WORDS[destinationFor(shape, editing)]} · {shape.fixes.length}
                </span>
              </button>
            ))}
          </div>
        </LaModal>
      )}
    </div>
  )
}

const DESTINATION_WORDS = {
  waypoints: 'waypoints',
  survey: 'survey area',
  fence: 'fence',
  rally: 'rally points',
} as const

const KIND_WORDS = { track: 'Line', points: 'Points', polygon: 'Area' } as const

/** An export name, reusing the loaded one where there was one. */
function exchangeName(source: string | null, ext: 'kml' | 'gpx'): string {
  if (!source || source === 'Vehicle') return `mission.${ext}`
  return `${source.replace(/\.[^.]+$/, '')}.${ext}`
}

/** A .waypoints name, reusing the loaded one where there was one. */
function fileName(source: string | null): string {
  if (!source || source === 'Vehicle') return 'mission.waypoints'
  return source.replace(/\.(plan|txt|mission)$/i, '.waypoints')
}
