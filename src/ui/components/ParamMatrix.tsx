import type { CSSProperties, ReactNode } from 'react'
import { LaCard } from './La'
import ParamField from './ParamField'
import type { ParamFieldSpec } from './ParamCard'
import { useParamStore } from '../../stores/param-store'

// Parameters that vary along two axes, drawn as the grid they are.
//
// Rate gains are the main case: ATC_RAT_RLL_P and ATC_RAT_PIT_P are the same
// setting on different axes, and a grid makes them easy to compare. The
// layout follows Betaflight's, with the axis down the left.
//
// Presence is filtered on both axes, as in ParamCard: empty columns and rows
// drop out and an empty matrix hides itself, so one declaration serves
// several vehicles.

export interface MatrixColumn {
  label: string
  /**
   * Normally omitted so the unit comes from the firmware's metadata, which
   * tracks changes between releases (ATC_ACC_R_MAX is deg/s/s on 4.7, not
   * cdeg/s/s).
   */
  unit?: string
  /**
   * A number box even where the metadata offers named values. ATC_ACC_R_MAX
   * lists a few presets, but a tuned value is rarely one of them.
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
   * such parameter (yaw has no lean-angle limit).
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
   * Named rows under the table for related settings with no axis, such as
   * ATC_ANGLE_MAX and ATC_INPUT_TC beside the angle gains.
   */
  fields?: ParamFieldSpec[]
  /** The card's title-row controls (its own Revert and Write). */
  actions?: ReactNode
}) {
  const entries = useParamStore((s) => s.entries)
  const metadata = useParamStore((s) => s.metadata)

  /** The spelling this vehicle reports, or null. */
  const resolve = (p: MatrixParam | null | undefined): string | null => {
    if (!p) return null
    for (const name of typeof p === 'string' ? [p] : p) if (entries.has(name)) return name
    return null
  }
  const has = (p: MatrixParam | null | undefined) => resolve(p) !== null
  /**
   * The column's unit for its heading: its own if set, else the metadata's,
   * but only when every parameter in the column agrees. A column that
   * disagrees shows no unit rather than a wrong one.
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

  const keptCols = columns
    .map((col, i) => ({ col, i }))
    .filter(({ i }) => rows.some((r) => has(r.params[i])))
  const keptRows = rows.filter((r) => keptCols.some(({ i }) => has(r.params[i])))

  // The fields alone keep the card visible, as in a ParamCard.
  const presentFields = fields.filter((f) => entries.has(f.param))
  const table = keptCols.length > 0 && keptRows.length > 0
  if (!table && presentFields.length === 0) return null

  // The column count varies by matrix, so it is passed as a custom property.
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
    // Framed like every other Setup table; see `.app-table`.
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
                {/* Empty, not a dash: ParamField's dash means the vehicle
                    lacks the parameter, which is a different statement. */}
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
