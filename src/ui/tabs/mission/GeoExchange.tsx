import { useState } from 'react'
import { LaButton, LaModal } from '../../components/La'
import { useMissionStore, type PlanKind } from '../../../stores/mission-store'
import { openFromFile, saveToFile } from '../../../services/mission'
import {
  applyGeoShapes,
  destinationFor,
  exportable,
  pickGeoFile,
  saveGpx,
  saveKml,
  usableShapes,
} from '../../../services/geo-import'
import type { GeoShape } from '../../../services/geo-file'

// File import and export for whichever plan is on screen. It sits outside the
// per-plan panels because the plan switch decides what a file means: a route
// on Mission, a boundary on Fence, alternates on Rally.
//
// The three interchange buttons are the same on every plan. The mission's
// .waypoints pair is a separate section below them. ArduPilot's .fence and
// .rally formats are not supported yet, so those plans travel as KML.

const WORD: Record<PlanKind, string> = {
  mission: 'mission',
  fence: 'fence',
  rally: 'rally points',
}

export default function GeoExchange() {
  const editing = useMissionStore((s) => s.editing)
  const sourceName = useMissionStore((s) => s.sourceName)
  // Subscribed so the export buttons re-evaluate as the plans change;
  // `exportable` reads the store directly.
  useMissionStore(
    (s) =>
      s.plan.items.length +
      s.fence.shapes.filter((f) => f.kind === 'polygon').length +
      s.rally.length,
  )
  const can = exportable(editing)

  /**
   * The two questions an import can raise: `fence` asks the polygon type,
   * which no file records; `mismatch` is a file with nothing of the kind
   * being imported. Everything else applies directly.
   */
  const [ask, setAsk] = useState<{
    kind: 'fence' | 'mismatch'
    name: string
    shapes: GeoShape[]
  } | null>(null)
  const [busy, setBusy] = useState(false)
  /** The import result, shown here since this section is on every plan. */
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null)

  const apply = (shapes: GeoShape[], name: string, opts: Parameters<typeof applyGeoShapes>[2]) => {
    setNote({ text: applyGeoShapes(shapes, name, opts) })
    setAsk(null)
  }

  const onImport = () => {
    setBusy(true)
    setNote(null)
    void pickGeoFile()
      .then((picked) => {
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
        setNote({ text: applyGeoShapes(usable, picked.name) })
      })
      .catch((err: unknown) =>
        setNote({ text: err instanceof Error ? err.message : String(err), error: true }),
      )
      .finally(() => setBusy(false))
  }

  return (
    <>
      <section className="app-col__group">
        <h3 className="app-col__head">Import/export</h3>

        <LaButton variant="secondary" size="block" disabled={busy} onClick={onImport}>
          Import KML or GPX
        </LaButton>
        <LaButton
          variant="ghost"
          size="block"
          disabled={busy || !can.kml}
          onClick={() => saveKml(exchangeName(sourceName, editing, 'kml'))}
        >
          Export KML
        </LaButton>
        {/* Disabled rather than hidden on a fence, since GPX cannot express
            an area; the title says so. */}
        <LaButton
          variant="ghost"
          size="block"
          disabled={busy || !can.gpx}
          title={editing === 'fence' ? 'GPX has no way to hold an area' : undefined}
          onClick={() => saveGpx(exchangeName(sourceName, editing, 'gpx'))}
        >
          Export GPX
        </LaButton>

        {note && <p className={`app-col__note${note.error ? ' is-error' : ''}`}>{note.text}</p>}
      </section>

      {/* The mission's own format, below the shared section so that section
          stays in the same place on every plan. */}
      {editing === 'mission' && (
        <section className="app-col__group">
          <h3 className="app-col__head">Load/save</h3>
          <LaButton
            variant="secondary"
            size="block"
            disabled={busy}
            onClick={() => void openFromFile()}
          >
            Open from file
          </LaButton>
          <LaButton
            variant="secondary"
            size="block"
            disabled={busy || !can.kml}
            onClick={() => saveToFile(waypointsName(sourceName))}
          >
            Save to file
          </LaButton>
        </section>
      )}

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
          <p className="la-hint">Which kind of fence are these?</p>
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
    </>
  )
}

/**
 * The file has nothing of the kind being imported. Says what it does hold
 * and offers the nearest use: an area on a mission becomes a survey area, a
 * line on a fence becomes a boundary.
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
      title={`Nothing for the ${WORD[editing]} in ${name}`}
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

/** An export name, reusing the loaded one where the mission came from a file. */
function exchangeName(source: string | null, editing: PlanKind, ext: 'kml' | 'gpx'): string {
  if (editing !== 'mission') return `${editing}.${ext}`
  if (!source || source === 'Vehicle') return `mission.${ext}`
  return `${source.replace(/\.[^.]+$/, '')}.${ext}`
}

/** A .waypoints name, reusing the loaded one where there was one. */
function waypointsName(source: string | null): string {
  if (!source || source === 'Vehicle') return 'mission.waypoints'
  return source.replace(/\.(plan|txt|mission)$/i, '.waypoints')
}
