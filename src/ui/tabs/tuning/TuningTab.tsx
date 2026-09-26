import { useState, type ReactNode } from 'react'
import ParamCard, { NeedsVehicle, type ParamFieldSpec } from '../../components/ParamCard'
import ParamMatrix, { type MatrixParam, type MatrixRow } from '../../components/ParamMatrix'
import CardParamActions from '../../components/CardParamActions'
import SubTabs from '../../components/SubTabs'
import { useConnectionStore } from '../../../stores/connection-store'
import { useParamStore } from '../../../stores/param-store'

// The tuning parameters people actually reach for, scoped to Mission Planner's
// own tuning pages -- its Plane "Basic Tuning" and the Copter "Extended
// Tuning" it reuses as "QP Extended Tuning" -- on the same two columns as
// Configuration. It was two sub-tabs drawn as one banded document, the one
// Setup screen that was not cards. The IMU's filtering -- low-pass filters,
// both harmonic notches, the batch sampler -- is on Filters, ahead of this in
// the rail: it is set once from a log before the gains, and on this page it
// made a page and a half of cards. The rate controller's own filters went
// there too: they are set once, from the gyro filter, before the gains, and
// are not what a tuning session changes.
//
// **Every name was read off running 4.7.1 vehicles** -- Copter, Plane, and a
// Plane booted as a quadplane -- because 4.7 renamed most of the multirotor
// navigation set and the page had been showing none of it: PSC_ACCZ_P is
// PSC_D_ACC_P, WPNAV_SPEED is WP_SPD, PILOT_SPEED_UP is PILOT_SPD_UP,
// ANGLE_MAX is ATC_ANGLE_MAX. Older spellings are listed after the current
// ones -- a vehicle reports one of them -- and **no unit is written here**
// where the metadata has one: the renames changed units too (cm/s to m/s,
// centidegrees to degrees), and Mission Planner flags the same change with a
// "Change in 4.7" warning. Units come from the metadata for the firmware
// connected, which is right for whichever spelling it has; TECS's rates, which
// the metadata gives none, are the one exception.
//
// Left out of Mission Planner's set on purpose: its Plane page's airspeeds (on
// Configuration), KFF_RDDRMIX (on Outputs) and its filters (on Filters); the
// yaw damper (YAW2SRV_*) and throttle limits (THR_MIN/MAX/SLEWRATE), which
// people rarely touch once set and which cost a quadplane's page two cards of
// scrolling -- the Parameters table still has them; and the pre-TECS
// ENRGY2THR / ALT2PTCH / ARSP2PTCH loops and the static INS_NOTCH_*, which 4.7
// does not have. Added beyond it: rate FF, and Plane's attitude time
// constants, which its page predates and which ArduPlane's own tuning guide
// starts from.

/** A spelling per firmware generation, newest first. */
const one = (...names: string[]): MatrixParam => names

/**
 * The multirotor attitude and navigation set, for a Copter or for a
 * quadplane's VTOL motors. ArduPilot names the quadplane's copies by prefix --
 * ATC_ becomes Q_A_, PSC_ becomes Q_P_, most others take Q_ -- and Mission
 * Planner serves both from one page the same way.
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
  // Rows in the order the cascade runs, outermost first. A matrix per axis, as
  // Mission Planner boxes them: their I max is in different units (d% for the
  // vertical accelerator, m/s/s for the horizontal velocity loop), so one
  // matrix could only head that column with a unit wrong for half of it. A
  // position loop is P only; the cells it has no I, D or I max for are blank
  // rather than dashes.
  // The rows are ArduPilot's own words for the loops -- "Position (vertical)
  // controller", "Velocity (vertical) controller" -- and so the same three on
  // both cards, rather than Altitude and Climb rate here and Position and
  // Velocity beside it.
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
  // The attitude controller's settings that have no axis, under its angle
  // gains -- the multirotor counterpart of the fixed wing's Attitude card.
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

// Quicktune, in the autotune card because it does the autotune's job: every
// official Plane build for flight hardware leaves QAUTOTUNE out and builds this
// in instead (`!QAUTOTUNE_ENABLED`, `AP_QUICKTUNE_ENABLED` in the published
// features.txt of CubeOrange, Pixhawk6X, MatekH743 and others, 4.6.3 to the
// current beta), so on real hardware these are the only tuning rows the card
// has. SITL builds both, and shows both. Copter builds neither.
//
// The enable gates the rest live -- 13 QWIK_ parameters appear the moment it
// is written, no restart, measured on 4.7.1 -- so it is OSD_TYPE's kind of
// field, and the rows after it are reserved to hold the card's height. Only
// these four: they are the setup ArduPilot's Quicktune guide asks for; the
// algorithm's own knobs (doubling time, gain margin, thresholds) are left to
// the Parameters table. The tune itself starts from a switch, RCn_OPTION 181.
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
// The attitude limits moved here from Configuration: Copter's lean limit is
// on this page, and Mission Planner's Plane tuning page has them as "Nav
// angles". 4.4 renamed them off centidegrees; the old spellings are carried
// because the unit comes from the metadata for whichever the vehicle reports,
// which is what makes carrying them safe here and not on Configuration.
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
  // The one unit this page states: ArduPilot's metadata gives these none (it is
  // in the display name, "metres/sec"), and they have not been renamed or
  // rescaled across releases. ParamField prefers a stated unit, so this is
  // used only because the metadata is silent.
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

/**
 * A card's own Revert and Write, scoped to its parameters, as on every Setup
 * screen that has left the footer.
 */
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
 * Two stacked columns on Configuration's even geometry, each reaching the
 * row's height so the shorter one's last card takes the slack rather than
 * leaving a step. Two fit a Copter's set or a plane's in an 1100px window, and
 * a quadplane shows one set at a time, so no layout here needs three.
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
 * A multirotor's cards, for a Copter or for a quadplane's VTOL motors -- under
 * the same titles either way, since on a quadplane the view switch already
 * says which set is showing, and the VTOL view is meant to be the Copter page.
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
    // PSC_ is ArduPilot's position controller, which its metadata describes in
    // two halves -- "Position (vertical) controller", "Position (horizontal)
    // controller". The limits card holds WP_, LOIT_ and PILOT_ -- speeds, an
    // acceleration and a radius, the navigation controllers' settings rather
    // than all speeds.
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

  // Parameters too, not just a link: with them still arriving every card is
  // missing its fields and hides itself, which reads as a vehicle with nothing
  // to tune.
  if (!connected || !ready) {
    return <NeedsVehicle title="Tuning" />
  }

  // Autotune comes first, top left: it is where tuning starts, and the gains
  // below it are what it writes. A multirotor's columns are by subject -- the
  // attitude loops under autotune, the position controller and navigation
  // beside them -- and a plane's are the arrangement that evens its columns,
  // found by trying every assignment against the cards' measured heights.
  //
  // What the aircraft is comes from what it reports: a fixed-wing rate loop
  // means a plane, and a plane with Q_A_ gains is a quadplane.
  const plane = entries.has('RLL_RATE_P')
  const vtol = entries.has('Q_A_RAT_RLL_P')
  if (!plane) return <MultirotorColumns q={false} />
  if (!vtol) return <PlaneColumns />

  // A quadplane shows its two sets one at a time, each laid out exactly as the
  // Plane page and the Copter page lay out theirs -- Mission Planner's "Basic
  // Tuning" and "QP Extended Tuning", which are separate pages there too. As
  // one screen of three columns the cards could only fit by leaving their
  // places on those pages, and a card that moves with the airframe is one
  // nobody finds twice; stacked, the screen scrolled 630px.
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
  // Quicktune's rows only where the firmware has it at all: they are reserved,
  // and a reserved row on a build without the feature would be a greyed row
  // nothing could ever turn on.
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
