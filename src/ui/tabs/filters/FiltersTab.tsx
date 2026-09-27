import ParamCard, { NeedsVehicle, type ParamFieldSpec } from '../../components/ParamCard'
import ParamMatrix, { type MatrixRow } from '../../components/ParamMatrix'
import CardParamActions from '../../components/CardParamActions'
import { useConnectionStore } from '../../../stores/connection-store'
import { useParamStore } from '../../../stores/param-store'

// The IMU's filtering, ahead of Tuning in the rail: ArduPilot's tuning
// process sets the harmonic notch from a batch-sampler log first, then tunes
// the gains.
//
// The rate controller's filters (target, error, D) are here too, since they
// are set alongside the gyro filter. A quadplane's fixed-wing and VTOL sets
// are rows of one card, so every vehicle gets the same four cards.
//
// Both harmonic notches are shown; the second (INS_HNTC2_*) is on every 4.7
// vehicle.
//
// Each notch's enable gates its other eight parameters, which appear without
// a restart. So the enable writes immediately and triggers a quiet re-read,
// like `OSD_TYPE`. The following rows are reserved (drawn disabled while
// absent) so the card keeps its height.

// The low-pass filters and the batch sampler (the log the notches are set
// from) share one card: all INS_ settings on the IMU's sample stream.
const IMU: ParamFieldSpec[] = [
  { param: 'INS_GYRO_FILTER', label: 'Gyro filter' },
  { param: 'INS_ACCEL_FILTER', label: 'Accel filter' },
  { param: 'INS_LOG_BAT_MASK', label: 'Batch-sampled IMUs' },
  { param: 'INS_LOG_BAT_OPT', label: 'Batch sampler options' },
]

function notch(prefix: 'INS_HNTCH_' | 'INS_HNTC2_'): ParamFieldSpec[] {
  return [
    { param: `${prefix}ENABLE`, label: 'Enable', writeNow: true, gatesOthers: true },
    { param: `${prefix}MODE`, label: 'Tracking mode', reserve: true },
    { param: `${prefix}REF`, label: 'Reference value', reserve: true },
    { param: `${prefix}FREQ`, label: 'Center frequency', reserve: true },
    { param: `${prefix}BW`, label: 'Bandwidth', reserve: true },
    { param: `${prefix}ATT`, label: 'Attenuation', reserve: true },
    { param: `${prefix}HMNCS`, label: 'Harmonics', reserve: true },
    { param: `${prefix}OPTS`, label: 'Options', reserve: true },
  ]
}

const AXES = [
  { label: 'Roll', multirotor: 'RLL', plane: 'RLL' },
  { label: 'Pitch', multirotor: 'PIT', plane: 'PTCH' },
  { label: 'Yaw', multirotor: 'YAW', plane: 'YAW' },
]
const FILTER_COLUMNS = [{ label: 'Target' }, { label: 'Error' }, { label: 'D' }]
const FILTERS = ['FLTT', 'FLTE', 'FLTD']

/** ATC_RAT_RLL_FLTT for a Copter, Q_A_RAT_ for VTOL motors, RLL_RATE_ for a plane. */
function rateFilters(
  name: (axis: (typeof AXES)[number], filter: string) => string,
  prefix = '',
): MatrixRow[] {
  return AXES.map((a) => ({
    label: prefix ? `${prefix} ${a.label.toLowerCase()}` : a.label,
    params: FILTERS.map((f) => name(a, f)),
  }))
}

const reason = 'Filter changes take effect after a restart'

function rateCard(title: string, rows: MatrixRow[]) {
  const owned = new Set(rows.flatMap((r) => r.params as string[]))
  return (
    <ParamMatrix
      key={title}
      title={title}
      columns={FILTER_COLUMNS}
      rows={rows}
      actions={<CardParamActions reason={reason} owns={(param) => owned.has(param)} />}
    />
  )
}

function card(title: string, fields: ParamFieldSpec[]) {
  const owned = new Set(fields.map((f) => f.param))
  return (
    <ParamCard
      key={title}
      title={title}
      showNames
      fields={fields}
      actions={<CardParamActions reason={reason} owns={(param) => owned.has(param)} />}
    />
  )
}

export default function FiltersTab() {
  const connected = useConnectionStore((s) => s.phase === 'connected' || s.phase === 'linkLost')
  const ready = useParamStore((s) => s.loadState === 'ready')
  const entries = useParamStore((s) => s.entries)

  if (!connected || !ready) {
    return <NeedsVehicle title="Filters" />
  }

  // Same test as Tuning: a fixed-wing rate loop is a plane, and Q_A_ gains
  // beside it mean a quadplane.
  const plane = entries.has('RLL_RATE_P')
  const vtol = entries.has('Q_A_RAT_RLL_P')

  // A plane's rows, then on a quadplane the VTOL motors' Q_A_ rows, labeled.
  const rows = [
    ...(plane
      ? rateFilters((a, f) => `${a.plane}_RATE_${f}`)
      : rateFilters((a, f) => `ATC_RAT_${a.multirotor}_${f}`)),
    ...(vtol ? rateFilters((a, f) => `Q_A_RAT_${a.multirotor}_${f}`, 'VTOL') : []),
  ]

  // Rows rather than columns, so paired cards share a height.
  return (
    <div className="config-screen config-screen--even">
      {card('IMU', IMU)}
      {rateCard('Rate filters', rows)}
      {card('First harmonic notch', notch('INS_HNTCH_'))}
      {card('Second harmonic notch', notch('INS_HNTC2_'))}
    </div>
  )
}
