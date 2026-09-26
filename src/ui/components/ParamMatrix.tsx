import type { CSSProperties, ReactNode } from 'react'
import { LaCard } from './La'
import ParamField from './ParamField'
import type { ParamFieldSpec } from './ParamCard'
import SetupBand from './SetupBand'
import { useInDoc } from './SetupDoc'
import { useParamStore } from '../../stores/param-store'

// Parameters that vary along two axes, drawn as the grid they are.
//
// Rate gains are the case this exists for: ATC_RAT_RLL_P and ATC_RAT_PIT_P
// are the same setting on different axes, and as three separate cards the
// one comparison anyone makes -- is pitch P near roll P? -- is a comparison
// across three headings. Mission Planner and Betaflight both lay their gains
// out this way, and Betaflight's is a real fixed-layout table with the axis
// down the left, which is what this copies.
//
// Presence is filtered on both axes, so one declaration still serves several
// vehicles: a column no row has drops out, a row with nothing in it drops
// out, and a matrix left with nothing hides itself -- the same contract as
// ParamCard, which is what lets a Copter matrix and a Plane matrix sit in
// the same tab with only one ever drawing.

export interface MatrixColumn {
  label: string
  /**
   * Normally left out, so the unit comes from the firmware's own metadata for
   * whichever parameter the column shows. Hardcoded, it went wrong the moment
   * ArduPilot changed one: ATC_ACC_R_MAX is deg/s/s on 4.7 and the heading
   * said cdeg/s/s over a value of 1100.
   */
  unit?: string
  /**
   * A number box even where the metadata offers named values. ATC_ACC_R_MAX
   * lists a handful of presets, but the value a tune arrives at -- 1100 on
   * SITL's copter -- is rarely one of them, and a dropdown beside a column of
   * number boxes read as a different kind of setting.
   */
  numeric?: boolean
}

/**
 * One cell's parameter, or its spellings across firmware releases, newest
 * first. A vehicle reports one of them; the first it has is the one drawn.
 */
export type MatrixParam = string | readonly string[]

export interface MatrixRow {
  label: string
  /**
   * One parameter per column, positionally. `null` where this row has no
   * such parameter at all -- yaw has no lean-angle limit, and a blank cell
   * says that better than a missing row.
   */
  params: (MatrixParam | null)[]
}

export default function ParamMatrix({
  title,
  subtitle,
  note,
  columns,
  rows,
  fields = [],
  actions,
}: {
  title: string
  subtitle?: string
  note?: string
  columns: MatrixColumn[]
  rows: MatrixRow[]
  /**
   * Named rows under the table, for the loop's settings that have no axis:
   * ATC_ANGLE_MAX and ATC_INPUT_TC belong to the same attitude controller as
   * the angle gains above them, and in a card of their own they split one
   * subject in two.
   */
  fields?: ParamFieldSpec[]
  /** The card's title-row controls -- its own Revert and Write. */
  actions?: ReactNode
}) {
  const entries = useParamStore((s) => s.entries)
  const metadata = useParamStore((s) => s.metadata)
  const inDoc = useInDoc()

  /** The spelling this vehicle reports, or null. */
  const resolve = (p: MatrixParam | null | undefined): string | null => {
    if (!p) return null
    for (const name of typeof p === 'string' ? [p] : p) if (entries.has(name)) return name
    return null
  }
  const has = (p: MatrixParam | null | undefined) => resolve(p) !== null
  /**
   * The column's unit for its heading: its own if it names one, else the
   * metadata's -- but only when every parameter in the column agrees. The
   * position controller's I max column is d% for the vertical accelerator and
   * m/s/s for the horizontal velocity loop, and a heading taken from the first
   * row put "d%" over both. A column that disagrees shows no unit rather than
   * a wrong one; the fix for it is a matrix per unit, as the Tuning page's two
   * position controllers are.
   */
  const unitOf = (col: MatrixColumn, i: number): string | undefined => {
    if (col.unit) return col.unit
    const units = new Set<string | undefined>()
    for (const r of rows) {
      const name = resolve(r.params[i])
      if (name) units.add(metadata[name]?.units)
    }
    return units.size === 1 ? [...units][0] : undefined
  }

  // A column the vehicle has nowhere is a heading over a row of dashes.
  const keptCols = columns
    .map((col, i) => ({ col, i }))
    .filter(({ i }) => rows.some((r) => has(r.params[i])))
  const keptRows = rows.filter((r) => keptCols.some(({ i }) => has(r.params[i])))

  // The fields hold the card up on their own, as a ParamCard's do: a firmware
  // with the lean-angle limit but none of the angle gains still has something
  // on this card to set.
  const presentFields = fields.filter((f) => entries.has(f.param))
  const table = keptCols.length > 0 && keptRows.length > 0
  if (!table && presentFields.length === 0) return null

  // The column count varies by matrix, and a token cannot express "as many
  // as there are" -- so it rides in as a custom property rather than as a
  // class per width.
  const style = { '--matrix-cols': keptCols.length } as CSSProperties

  const named = presentFields.map((f) => (
    <ParamField
      key={f.param}
      param={f.param}
      label={f.label}
      showName
      {...(f.unit ? { unit: f.unit } : {})}
      {...(f.numeric ? { numeric: true } : {})}
      {...(f.withValues ? { withValues: true } : {})}
    />
  ))

  const grid = table && (
    // Framed like every other table on a Setup screen -- see `.app-table`.
    <div className="app-table">
      <div className="app-table__row matrix-grid app-table__head" style={style}>
        <span />
        {keptCols.map(({ col, i }) => {
          const unit = unitOf(col, i)
          return (
            <span key={col.label}>
              {col.label}
              {unit && <span className="matrix-grid__unit"> {unit}</span>}
            </span>
          )
        })}
      </div>
      {keptRows.map((r) => (
        <div className="app-table__row matrix-grid" key={r.label} style={style}>
          <span className="app-table__label">{r.label}</span>
          {keptCols.map(({ col, i }) => {
            const param = resolve(r.params[i])
            return (
              <span className="matrix-grid__cell" key={col.label}>
                {/* Empty, not a dash: ParamField's dash means "this vehicle
                    does not have it", and a cell that was never a parameter
                    is a different statement. */}
                {param && (
                  <ParamField
                    param={param}
                    label={`${r.label} ${col.label}`}
                    bare
                    {...(col.numeric ? { numeric: true } : {})}
                  />
                )}
              </span>
            )
          })}
        </div>
      ))}
    </div>
  )

  // A matrix is already a grid, so it goes straight into the band rather
  // than through the field flow -- and it is capped there, because four
  // gain columns spread over three thousand pixels stop reading as a row.
  if (inDoc) {
    return (
      <SetupBand
        title={title}
        {...(subtitle !== undefined ? { tag: subtitle } : {})}
        {...(note !== undefined ? { note } : {})}
      >
        {grid}
        {named.length > 0 && <div className="app-band__fields">{named}</div>}
      </SetupBand>
    )
  }

  return (
    <LaCard
      title={title}
      {...(subtitle !== undefined ? { subtitle } : {})}
      {...(note !== undefined ? { note } : {})}
      {...(actions !== undefined ? { actions } : {})}
    >
      {grid}
      {named}
    </LaCard>
  )
}
