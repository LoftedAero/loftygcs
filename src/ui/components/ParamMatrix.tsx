import type { CSSProperties } from 'react'
import { LaCard } from './La'
import ParamField from './ParamField'
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
  unit?: string
}

export interface MatrixRow {
  label: string
  /**
   * One parameter per column, positionally. `null` where this row has no
   * such parameter at all -- yaw has no lean-angle limit, and a blank cell
   * says that better than a missing row.
   */
  params: (string | null)[]
}

export default function ParamMatrix({
  title,
  subtitle,
  note,
  columns,
  rows,
}: {
  title: string
  subtitle?: string
  note?: string
  columns: MatrixColumn[]
  rows: MatrixRow[]
}) {
  const entries = useParamStore((s) => s.entries)
  const inDoc = useInDoc()

  const has = (p: string | null | undefined) => !!p && entries.has(p)

  // A column the vehicle has nowhere is a heading over a row of dashes.
  const keptCols = columns
    .map((col, i) => ({ col, i }))
    .filter(({ i }) => rows.some((r) => has(r.params[i])))
  const keptRows = rows.filter((r) => keptCols.some(({ i }) => has(r.params[i])))

  if (keptCols.length === 0 || keptRows.length === 0) return null

  // The column count varies by matrix, and a token cannot express "as many
  // as there are" -- so it rides in as a custom property rather than as a
  // class per width.
  const style = { '--matrix-cols': keptCols.length } as CSSProperties

  const grid = (
    // Framed like every other table on a Setup screen -- see `.app-table`.
    <div className="app-table">
      <div className="app-table__row matrix-grid app-table__head" style={style}>
        <span />
        {keptCols.map(({ col }) => (
          <span key={col.label}>
            {col.label}
            {col.unit && <span className="matrix-grid__unit"> {col.unit}</span>}
          </span>
        ))}
      </div>
      {keptRows.map((r) => (
        <div className="app-table__row matrix-grid" key={r.label} style={style}>
          <span className="app-table__label">{r.label}</span>
          {keptCols.map(({ col, i }) => {
            const param = r.params[i]
            return (
              <span className="matrix-grid__cell" key={col.label}>
                {/* Empty, not a dash: ParamField's dash means "this vehicle
                    does not have it", and a cell that was never a parameter
                    is a different statement. */}
                {param && <ParamField param={param} label={`${r.label} ${col.label}`} bare />}
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
      </SetupBand>
    )
  }

  return (
    <LaCard
      title={title}
      {...(subtitle !== undefined ? { subtitle } : {})}
      {...(note !== undefined ? { note } : {})}
    >
      {grid}
    </LaCard>
  )
}
