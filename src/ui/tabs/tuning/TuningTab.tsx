import { useState, type ReactNode } from 'react'
import ParamCard, { NeedsVehicle, type ParamFieldSpec } from '../../components/ParamCard'
import ParamMatrix, { type MatrixParam, type MatrixRow } from '../../components/ParamMatrix'
import CardParamActions from '../../components/CardParamActions'
import SubTabs from '../../components/SubTabs'
import { useConnectionStore } from '../../../stores/connection-store'
import { useParamStore } from '../../../stores/param-store'

// The commonly used tuning parameters, scoped to Mission Planner's Plane
// "Basic Tuning" and Copter "Extended Tuning" (reused as "QP Extended
// Tuning"). IMU and rate-controller filtering is on the Filters tab, since it
// is set once from a log before the gains.
//
// Names are as reported by 4.7.1 Copter, Plane and quadplane. 4.7 renamed most
// of the multirotor navigation set (PSC_ACCZ_P is PSC_D_ACC_P, WPNAV_SPEED is
// WP_SPD, PILOT_SPEED_UP is PILOT_SPD_UP, ANGLE_MAX is ATC_ANGLE_MAX), so
// older spellings follow the current ones and a vehicle reports one of them.
// The renames also changed units (cm/s to m/s, centidegrees to degrees), so
// units come from the connected firmware's metadata. TECS's rates, which the
// metadata gives no unit, are the one exception.
//
// Omitted from Mission Planner's set: the Plane page's airspeeds (on
// Configuration), KFF_RDDRMIX (on Outputs) and filters (on Filters); the yaw
// damper (YAW2SRV_*) and throttle limits (THR_MIN/MAX/SLEWRATE), left to the
// Parameters table; and the pre-TECS ENRGY2THR / ALT2PTCH / ARSP2PTCH loops
// and static INS_NOTCH_*, which 4.7 does not have. Added: rate FF, and
// Plane's attitude time constants, which ArduPlane's tuning guide starts from.

/** A spelling per firmware generation, newest first. */
const one = (...names: string[]): MatrixParam => names

/**
 * The multirotor attitude and navigation set, for a Copter or a quadplane's
 * VTOL motors. The quadplane's copies are prefixed: ATC_ becomes Q_A_, PSC_
 * becomes Q_P_, and most others take Q_.
 */
function multirotorSet(q: boolean, quicktune = false) {
  const atc = q ? 'Q_A_' : 'ATC_'
  const psc = q ? 'Q_P_' : 'PSC_'
  const top = q ? 'Q_' : ''
  const axes = [
    { label: 'Roll', k: 'RLL', acc: 'R' },
    { label: 'Pitch', k: 'PIT', acc: 'P' },
    { label: 'Yaw', k: 'YAW', acc: 'Y' },
  ]

  const rate: MatrixRow[] = axes.map((a) => ({
    label: a.label,
    params: ['P', 'I', 'D', 'FF', 'IMAX'].map((t) => `${atc}RAT_${a.k}_${t}`),
  }))
  const angle: MatrixRow[] = axes.map((a) => ({
    label: a.label,
    params: [`${atc}ANG_${a.k}_P`, one(`${atc}ACC_${a.acc}_MAX`, `${atc}ACCEL_${a.acc}_MAX`)],
  }))
  // Rows in cascade order, outermost first, with row labels from ArduPilot's
  // own loop names. Vertical and horizontal get separate matrices because
  // their I max units differ (d% for the vertical accelerator, m/s/s for the
  // horizontal velocity loop). A position loop is P only, so its other cells
  // are blank.
  const vertical: MatrixRow[] = [
    { label: 'Position', params: [one(`${psc}D_POS_P`, `${psc}POSZ_P`), null, null, null] },
    { label: 'Velocity', params: [one(`${psc}D_VEL_P`, `${psc}VELZ_P`), null, null, null] },
    {
      label: 'Accel',
      params: ['P', 'I', 'D', 'IMAX'].map((t) => one(`${psc}D_ACC_${t}`, `${psc}ACCZ_${t}`)),
    },
  ]
  const horizontal: MatrixRow[] = [
    { label: 'Position', params: [one(`${psc}NE_POS_P`, `${psc}POSXY_P`), null, null, null] },
    {
      label: 'Velocity',
      params: ['P', 'I', 'D', 'IMAX'].map((t) => one(`${psc}NE_VEL_${t}`, `${psc}VELXY_${t}`)),
    },
  ]
  const speeds: ParamFieldSpec[] = [
    ...both(q ? ['Q_WP_SPD', 'Q_WP_SPEED'] : ['WP_SPD', 'WPNAV_SPEED'], 'Waypoint speed'),
    ...both(
      q ? ['Q_WP_SPD_UP', 'Q_WP_SPEED_UP'] : ['WP_SPD_UP', 'WPNAV_SPEED_UP'],
      'Waypoint climb speed',
    ),
    ...both(
      q ? ['Q_WP_SPD_DN', 'Q_WP_SPEED_DN'] : ['WP_SPD_DN', 'WPNAV_SPEED_DN'],
      'Waypoint descent speed',
    ),
    ...both(q ? ['Q_WP_ACC', 'Q_WP_ACCEL'] : ['WP_ACC', 'WPNAV_ACCEL'], 'Waypoint acceleration'),
    ...both(
      q ? ['Q_WP_RADIUS_M', 'Q_WP_RADIUS'] : ['WP_RADIUS_M', 'WPNAV_RADIUS'],
      'Waypoint radius',
    ),
    ...both(
      q ? ['Q_LOIT_SPEED_MS', 'Q_LOIT_SPEED'] : ['LOIT_SPEED_MS', 'LOIT_SPEED', 'WPNAV_LOIT_SPEED'],
      'Loiter speed',
    ),
    ...both([`${top}PILOT_SPD_UP`, `${top}PILOT_SPEED_UP`], 'Pilot climb speed'),
    ...both([`${top}PILOT_SPD_DN`, `${top}PILOT_SPEED_DN`], 'Pilot descent speed'),
  ]
  // The attitude controller's per-vehicle (not per-axis) settings.
  const attitude: ParamFieldSpec[] = [
    ...both(
      q ? ['Q_A_ANGLE_MAX', 'Q_ANGLE_MAX'] : ['ATC_ANGLE_MAX', 'ANGLE_MAX'],
      'Lean angle max',
    ),
    // Named presets on a scale of seconds, so each carries its number.
    { param: `${atc}INPUT_TC`, label: 'Input time constant', withValues: true },
  ]
  const autotune: ParamFieldSpec[] = [
    { param: `${top}AUTOTUNE_AXES`, label: 'Axes to tune' },
    { param: `${top}AUTOTUNE_AGGR`, label: 'Aggressiveness' },
    { param: `${top}AUTOTUNE_MIN_D`, label: 'Minimum D' },
    ...(quicktune ? QUICKTUNE : []),
  ]
  return { rate, angle, attitude, vertical, horizontal, speeds, autotune }
}

// Quicktune goes in the autotune card: official Plane builds for flight
// hardware ship Quicktune instead of QAUTOTUNE (per their published
// features.txt), so on real hardware these are the card's only tuning rows.
// SITL builds both; Copter builds neither.
//
// QWIK_ENABLE exposes the other QWIK_ parameters without a restart, so it
// writes immediately and the rows after it are reserved to hold the card's
// height. These four are the setup ArduPilot's Quicktune guide asks for; the
// tune itself starts from a switch (RCn_OPTION 181).
const QUICKTUNE: ParamFieldSpec[] = [
  { param: 'QWIK_ENABLE', label: 'Quicktune', writeNow: true, gatesOthers: true },
  { param: 'QWIK_AXES', label: 'Quicktune axes', reserve: true },
  { param: 'QWIK_AUTO_SAVE', label: 'Auto-save after', reserve: true },
  { param: 'QWIK_OPTIONS', label: 'Quicktune options', reserve: true },
]

/** One field per spelling; the card keeps whichever the vehicle reports. */
function both(names: string[], label: string): ParamFieldSpec[] {
  return names.map((param) => ({ param, label }))
}

/** The fixed-wing set, from Mission Planner's Plane page. */
const PLANE_RATE: MatrixRow[] = [
  { label: 'Roll', k: 'RLL' },
  { label: 'Pitch', k: 'PTCH' },
  { label: 'Yaw', k: 'YAW' },
].map((a) => ({
  label: a.label,
  params: ['P', 'I', 'D', 'FF', 'IMAX'].map((t) => `${a.k}_RATE_${t}`),
}))
// Attitude limits, which Mission Planner's Plane page calls "Nav angles". 4.4
// renamed them off centidegrees; the old spellings are safe to carry because
// the unit comes from the metadata for whichever the vehicle reports.
const PLANE_ATTITUDE: ParamFieldSpec[] = [
  ...both(['ROLL_LIMIT_DEG', 'LIM_ROLL_CD'], 'Roll limit'),
  ...both(['PTCH_LIM_MAX_DEG', 'LIM_PITCH_MAX'], 'Pitch up limit'),
  ...both(['PTCH_LIM_MIN_DEG', 'LIM_PITCH_MIN'], 'Pitch down limit'),
  { param: 'RLL2SRV_TCONST', label: 'Roll time constant' },
  { param: 'PTCH2SRV_TCONST', label: 'Pitch time constant' },
]
const L1: ParamFieldSpec[] = [
  { param: 'NAVL1_PERIOD', label: 'Period' },
  { param: 'NAVL1_DAMPING', label: 'Damping' },
]
const TECS: ParamFieldSpec[] = [
  // ArduPilot's metadata gives these no unit (it is in the display name), and
  // they have not been rescaled across releases. A metadata unit would win.
  { param: 'TECS_CLMB_MAX', label: 'Climb rate max', unit: 'm/s' },
  { param: 'TECS_SINK_MIN', label: 'Sink rate min', unit: 'm/s' },
  { param: 'TECS_SINK_MAX', label: 'Sink rate max', unit: 'm/s' },
  { param: 'TECS_TIME_CONST', label: 'Time constant' },
  { param: 'TECS_PTCH_DAMP', label: 'Pitch damping' },
]
const PLANE_AUTOTUNE: ParamFieldSpec[] = [
  { param: 'AUTOTUNE_AXES', label: 'Axes to tune' },
  { param: 'AUTOTUNE_LEVEL', label: 'Tune level' },
]

const flat = (rows: MatrixRow[]): string[] =>
  rows.flatMap((r) =>
    r.params.flatMap((p) => (p === null ? [] : typeof p === 'string' ? [p] : [...p])),
  )

/** A card's own Revert and Write, scoped to its parameters. */
function actionsFor(params: readonly string[]) {
  const owned = new Set(params)
  return (
    <CardParamActions
      reason="Tuning changes take effect after a restart"
      owns={(param) => owned.has(param)}
    />
  )
}

const RATE_COLUMNS = [
  { label: 'P' },
  { label: 'I' },
  { label: 'D' },
  { label: 'FF' },
  { label: 'I max' },
]
const PID_COLUMNS = [{ label: 'P' }, { label: 'I' }, { label: 'D' }, { label: 'I max' }]

function card(title: string, fields: ParamFieldSpec[]) {
  return (
    <ParamCard
      key={title}
      title={title}
      showNames
      fields={fields}
      actions={actionsFor(fields.map((f) => f.param))}
    />
  )
}

function matrix(
  title: string,
  columns: { label: string; numeric?: boolean }[],
  rows: MatrixRow[],
  fields: ParamFieldSpec[] = [],
) {
  return (
    <ParamMatrix
      key={title}
      title={title}
      columns={columns}
      rows={rows}
      fields={fields}
      actions={actionsFor([...flat(rows), ...fields.map((f) => f.param)])}
    />
  )
}

/**
 * Two stacked columns, each filling the row's height so the shorter one's
 * last card takes the slack.
 */
function Columns({ columns }: { columns: ReactNode[][] }) {
  return (
    <div className="config-screen config-screen--even">
      {columns.map((cards, i) => (
        <div className="app-stack app-stack--fill" key={i}>
          {cards}
        </div>
      ))}
    </div>
  )
}

/**
 * A multirotor's cards, for a Copter or a quadplane's VTOL motors, under the
 * same titles; on a quadplane the view switch says which set is showing.
 */
function multirotorCards(q: boolean, quicktune = false) {
  const set = multirotorSet(q, quicktune)
  return {
    rate: matrix('Rate gains', RATE_COLUMNS, set.rate),
    angle: matrix(
      'Attitude',
      [{ label: 'Angle P' }, { label: 'Accel max', numeric: true }],
      set.angle,
      set.attitude,
    ),
    // PSC_ is the position controller, which ArduPilot's metadata describes as
    // vertical and horizontal halves. Navigation holds the WP_, LOIT_ and
    // PILOT_ settings.
    vertical: matrix('Vertical position controller', PID_COLUMNS, set.vertical),
    horizontal: matrix('Horizontal position controller', PID_COLUMNS, set.horizontal),
    speeds: card('Navigation', set.speeds),
    autotune: card('Autotune', set.autotune),
  }
}

/** The fixed-wing cards, from Mission Planner's Plane page. */
function planeCards() {
  return {
    rate: matrix('Rate gains', RATE_COLUMNS, PLANE_RATE),
    attitude: card('Attitude', PLANE_ATTITUDE),
    l1: card('L1 navigation', L1),
    tecs: card('TECS', TECS),
    autotune: card('Autotune', PLANE_AUTOTUNE),
  }
}

export default function TuningTab() {
  const connected = useConnectionStore((s) => s.phase === 'connected' || s.phase === 'linkLost')
  const ready = useParamStore((s) => s.loadState === 'ready')
  const entries = useParamStore((s) => s.entries)
  const [view, setView] = useState<'plane' | 'vtol'>('plane')

  // Wait for parameters too, or every card hides itself for lack of fields.
  if (!connected || !ready) {
    return <NeedsVehicle title="Tuning" />
  }

  // Autotune comes first, since tuning starts there and the gains below are
  // what it writes. A multirotor's columns are by subject; a plane's are
  // arranged to balance the column heights.
  //
  // A fixed-wing rate loop means a plane; a plane with Q_A_ gains is a
  // quadplane.
  const plane = entries.has('RLL_RATE_P')
  const vtol = entries.has('Q_A_RAT_RLL_P')
  if (!plane) return <MultirotorColumns q={false} />
  if (!vtol) return <PlaneColumns />

  // A quadplane shows its two sets one at a time, each laid out as on the
  // Plane and Copter pages (separate pages in Mission Planner too), so cards
  // keep the same place regardless of airframe.
  return (
    <>
      <SubTabs tabs={QUADPLANE_VIEWS} active={view} onChange={setView} label="Tuning view" />
      {view === 'vtol' ? <MultirotorColumns q /> : <PlaneColumns />}
    </>
  )
}

const QUADPLANE_VIEWS = [
  { id: 'plane', label: 'Fixed wing' },
  { id: 'vtol', label: 'VTOL' },
] as const

function MultirotorColumns({ q }: { q: boolean }) {
  // Only where the firmware has Quicktune, since its rows are reserved.
  const quicktune = useParamStore((s) => s.entries.has('QWIK_ENABLE'))
  const m = multirotorCards(q, quicktune)
  return (
    <Columns
      columns={[
        [m.autotune, m.rate, m.angle],
        [m.horizontal, m.vertical, m.speeds],
      ]}
    />
  )
}

function PlaneColumns() {
  const f = planeCards()
  return (
    <Columns
      columns={[
        [f.autotune, f.rate, f.l1],
        [f.attitude, f.tecs],
      ]}
    />
  )
}
