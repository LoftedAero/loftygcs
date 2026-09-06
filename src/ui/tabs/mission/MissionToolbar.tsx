import { useState } from 'react'
import { LaButton, LaHint, LaModal } from '../../components/La'
import { isDirty, useMissionStore, type PlanKind } from '../../../stores/mission-store'
import { useConnectionStore } from '../../../stores/connection-store'
import {
  openFromFile,
  readFromVehicle,
  saveToFile,
  writeToVehicle,
} from '../../../services/mission'
import {
  applyGeoShapes,
  destinationFor,
  pickGeoFile,
  saveGpx,
  saveKml,
  usableShapes,
} from '../../../services/geo-import'
import type { GeoShape } from '../../../services/geo-file'

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
  /**
   * The two questions an import can raise.
   *
   * `fence` is the polygon type, which no file records. `mismatch` is a
   * file with nothing of the kind being imported -- where the alternative
   * to asking is doing nothing and not saying why. Everything else applies
   * without a word.
   */
  const [ask, setAsk] = useState<{
    kind: 'fence' | 'mismatch'
    name: string
    shapes: GeoShape[]
  } | null>(null)
  const editing = useMissionStore((s) => s.editing)
  const setTransfer = useMissionStore((s) => s.setTransfer)

  const importGeo = async () => {
    const picked = await pickGeoFile()
    if (!picked) return
    const dest = destinationFor(editing)
    const usable = usableShapes(picked.shapes, dest)
    if (usable.length === 0) {
      setAsk({ kind: 'mismatch', name: picked.name, shapes: picked.shapes })
      return
    }
    if (dest === 'fence') {
      setAsk({ kind: 'fence', name: picked.name, shapes: usable })
      return
    }
    setTransfer({ kind: 'done', text: applyGeoShapes(usable, picked.name) })
  }

  const apply = (shapes: GeoShape[], name: string, opts: Parameters<typeof applyGeoShapes>[2]) => {
    setTransfer({ kind: 'done', text: applyGeoShapes(shapes, name, opts) })
    setAsk(null)
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
        Import KML or GPX
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

      {ask?.kind === 'fence' && (
        <LaModal
          open
          narrow
          title={`${ask.shapes.length} ${ask.shapes.length === 1 ? 'area' : 'areas'} from ${ask.name}`}
          actions={
            <div className="la-prompt-actions">
              <LaButton
                variant="primary"
                size="block"
                onClick={() => apply(ask.shapes, ask.name, { inclusive: true })}
              >
                Keep the vehicle inside
              </LaButton>
              <LaButton
                variant="secondary"
                size="block"
                onClick={() => apply(ask.shapes, ask.name, { inclusive: false })}
              >
                Keep the vehicle out
              </LaButton>
              <LaButton variant="ghost" size="block" onClick={() => setAsk(null)}>
                Cancel
              </LaButton>
            </div>
          }
        >
          <p className="la-hint">A file cannot say which kind of fence it is.</p>
        </LaModal>
      )}

      {ask?.kind === 'mismatch' && (
        <MismatchPrompt
          name={ask.name}
          shapes={ask.shapes}
          editing={editing}
          onUse={(shapes, opts) => apply(shapes, ask.name, opts)}
          onCancel={() => setAsk(null)}
        />
      )}
    </div>
  )
}

/**
 * The file has nothing of the kind being imported.
 *
 * Rather than "nothing to import", it names what is in there and offers the
 * nearest sensible thing -- an area while planning a mission is a survey
 * boundary, a line while editing a fence is a boundary drawn open.
 */
function MismatchPrompt({
  name,
  shapes,
  editing,
  onUse,
  onCancel,
}: {
  name: string
  shapes: GeoShape[]
  editing: PlanKind
  onUse: (shapes: GeoShape[], opts: Parameters<typeof applyGeoShapes>[2]) => void
  onCancel: () => void
}) {
  const areas = shapes.filter((s) => s.kind === 'polygon')
  const lines = shapes.filter((s) => s.kind !== 'polygon')
  const offer =
    editing === 'fence' && lines.length > 0
      ? { label: 'Use as a fence anyway', shapes: lines, opts: { as: 'fence' as const } }
      : editing === 'mission' && areas.length > 0
        ? { label: 'Use as a survey area', shapes: areas, opts: { as: 'survey' as const } }
        : null

  return (
    <LaModal
      open
      narrow
      title={`Nothing to import from ${name}`}
      actions={
        <div className="la-prompt-actions">
          {offer && (
            <LaButton
              variant="primary"
              size="block"
              onClick={() => onUse(offer.shapes, offer.opts)}
            >
              {offer.label}
            </LaButton>
          )}
          <LaButton variant="ghost" size="block" onClick={onCancel}>
            Cancel
          </LaButton>
        </div>
      }
    >
      <p className="la-hint">
        {shapes.length === 0
          ? 'It holds no routes, points or areas.'
          : editing === 'fence'
            ? 'It holds lines and points, not closed areas.'
            : 'It holds closed areas, not routes.'}
      </p>
    </LaModal>
  )
}

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
