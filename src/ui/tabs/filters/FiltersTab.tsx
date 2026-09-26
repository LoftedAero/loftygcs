import ParamCard, { NeedsVehicle, type ParamFieldSpec } from '../../components/ParamCard'
import ParamMatrix, { type MatrixRow } from '../../components/ParamMatrix'
import CardParamActions from '../../components/CardParamActions'
import { useConnectionStore } from '../../../stores/connection-store'
import { useParamStore } from '../../../stores/param-store'

// The IMU's filtering, on a screen of its own and ahead of Tuning in the rail,
// because it is a different sitting in the order the work is done: ArduPilot's
// tuning process sets the harmonic notch from a batch-sampler log first, then
// autotunes the gains. Filters are set once per airframe from a log; gains are
// revisited. Mission Planner keeps these on its Extended Tuning page; there
// they made this app's Tuning screen a page and a half of cards.
//
// The rate controller's own filters (target, error, D) are here as well,
// though they belong to the rate PID rather than to the sensor: they are set in
// the same sitting as the gyro filter -- ArduPilot's tuning setup derives them
// from it -- and then left alone while the gains are tuned. A quadplane has two
// sets, the fixed wing's and the VTOL motors', as rows of one card: every
// vehicle gets the same four cards in the same places, because a card that
// does one job should not change name or position with the airframe. Nor are
// these on Sensors,
// where the low-pass pair once sat beside the calibrations because they are
// INS_ parameters: a filter frequency is not something set while calibrating a
// board, it is a decision made against a log.
//
// Both harmonic notches, where Mission Planner shows only the first. The
// second (INS_HNTC2_*) is on every 4.7 vehicle, measured on Copter, Plane and
// a quadplane.
//
// **Each notch's enable gates the rest of it, live.** Off, the vehicle reports
// the enable alone; set to 1, it reports the other eight at once -- measured on
// Copter 4.7.1, 1,370 parameters to 1,378 with no restart, and the metadata
// marks none of them RebootRequired. So the enable is `OSD_TYPE`'s kind of
// field: written when it is chosen, then a quiet re-read, which is where the
// new rows come from. Staged behind the card's Write it changed the vehicle and
// left the rows greyed, because nothing read the list again. The rows after it
// are reserved -- drawn greyed while the vehicle does not report them -- so the
// card is one height either way.

// The low-pass filters and the batch sampler -- the log the notches are set
// from -- as one card. They were two, and five cards cannot pair up in two
// columns; these are the two that are one subject, every row an INS_ setting
// on the IMU's own sample stream.
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

  // Tuning's test of what the aircraft is: a fixed-wing rate loop is a plane,
  // and Q_A_ gains beside it are a quadplane's VTOL motors.
  const plane = entries.has('RLL_RATE_P')
  const vtol = entries.has('Q_A_RAT_RLL_P')

  // A plane's rows under its own names, then -- on a quadplane -- the VTOL
  // motors' under Q_A_, labelled so the two sets cannot be mistaken.
  const rows = [
    ...(plane
      ? rateFilters((a, f) => `${a.plane}_RATE_${f}`)
      : rateFilters((a, f) => `ATC_RAT_${a.multirotor}_${f}`)),
    ...(vtol ? rateFilters((a, f) => `Q_A_RAT_${a.multirotor}_${f}`, 'VTOL') : []),
  ]

  // Rows rather than two stacked columns, so a card is the height of the one
  // beside it: the two notches are the same card twice, and in columns the
  // second was stretched to whatever the other column added up to.
  return (
    <div className="config-screen config-screen--even">
      {card('IMU', IMU)}
      {rateCard('Rate filters', rows)}
      {card('First harmonic notch', notch('INS_HNTCH_'))}
      {card('Second harmonic notch', notch('INS_HNTC2_'))}
    </div>
  )
}
