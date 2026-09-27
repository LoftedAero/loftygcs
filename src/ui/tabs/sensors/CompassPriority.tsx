import { mdiArrowDown, mdiArrowUp } from '@mdi/js'
import ParamField from '../../components/ParamField'
import WriteFeedback from '../../components/WriteFeedback'
import { useParamStore } from '../../../stores/param-store'
import { useWriteFeedbackStore } from '../../../stores/write-feedback-store'
import { connectionService } from '../../../services/connection'
import { decodeDeviceId, describeDevice } from '../../../protocol/device-id'

// Which compass the EKF believes first, and the settings that belong to each.
//
// **The two are indexed differently, and that is the whole difficulty here.**
// ArduPilot declares its arrays with type-safe index types precisely so the
// firmware cannot confuse them (AP_Compass.h):
//
//   RestrictIDTypeArray<mag_state, .., StateIndex> _state;              // ORIENT, EXTERN, DEV_ID
//   RestrictIDTypeArray<AP_Int8,   .., Priority>   _use_for_yaw;        // USE
//   RestrictIDTypeArray<AP_Int32,  .., Priority>   _priority_did_stored_list; // PRIO*_ID
//
// So COMPASS_USE2 is "the compass in priority slot 2", while COMPASS_ORIENT2
// and COMPASS_EXTERN2 are "the device that was detected into state slot 2".
// They agree until somebody reorders, and then they do not -- which means a
// row that simply lined up USE2 with ORIENT2 would be showing one compass's
// orientation against another compass's yaw switch, silently, and only after
// a reorder. Exactly the kind of wrong that looks fine.
//
// The firmware bridges them in `_get_state_id()` by matching the priority
// slot's device id against the state slot's, and that is what `stateSlotFor`
// does below. Nothing here indexes by row number.
//
// Reordering is a swap of two COMPASS_PRIO*_ID values. This screen writes as
// you go, so the swap goes to the vehicle immediately rather than staging --
// see `swap` for why both halves have to land or neither. All three carry
// RebootRequired in ArduPilot's metadata, and that is not a formality:
// priority is read when the compass backends are built, so until the vehicle
// restarts the order on screen is not the order in use.

/** Priority slots: the order the vehicle tries its compasses in. */
const PRIORITY = [
  { prio: 'COMPASS_PRIO1_ID', use: 'COMPASS_USE' },
  { prio: 'COMPASS_PRIO2_ID', use: 'COMPASS_USE2' },
  { prio: 'COMPASS_PRIO3_ID', use: 'COMPASS_USE3' },
] as const

/** State slots: one per detected device, and where its settings live. */
const STATE = [
  { devId: 'COMPASS_DEV_ID', orient: 'COMPASS_ORIENT', external: 'COMPASS_EXTERNAL' },
  { devId: 'COMPASS_DEV_ID2', orient: 'COMPASS_ORIENT2', external: 'COMPASS_EXTERN2' },
  { devId: 'COMPASS_DEV_ID3', orient: 'COMPASS_ORIENT3', external: 'COMPASS_EXTERN3' },
] as const

/** Every device id the firmware reports, including the extra unregistered slots. */
const ALL_DEV_IDS = [
  'COMPASS_DEV_ID',
  'COMPASS_DEV_ID2',
  'COMPASS_DEV_ID3',
  'COMPASS_DEV_ID4',
  'COMPASS_DEV_ID5',
  'COMPASS_DEV_ID6',
  'COMPASS_DEV_ID7',
  'COMPASS_DEV_ID8',
]

export default function CompassPriority() {
  const entries = useParamStore((s) => s.entries)
  const edit = useParamStore((s) => s.edit)

  const slots = PRIORITY.filter((s) => entries.has(s.prio))
  if (slots.length === 0) return null

  const value = (p: string) => entries.get(p)?.value
  const detected = new Set(ALL_DEV_IDS.map(value).filter((v): v is number => !!v))

  /** The state slot holding this device -- the firmware's own `_get_state_id`. */
  const stateSlotFor = (id: number) => (id ? STATE.find((s) => value(s.devId) === id) : undefined)

  const rows = slots.map((s) => {
    const id = value(s.prio) ?? 0
    const state = stateSlotFor(id)
    return {
      ...s,
      id,
      state,
      device: decodeDeviceId(id, 'compass'),
      // A priority slot naming a device the firmware no longer reports: the
      // compass was unplugged, or moved to another bus. The slot is still
      // spent on it.
      missing: id !== 0 && !detected.has(id),
      // ArduPilot ignores a compass orientation unless the compass is
      // external -- an internal one is rotated by AHRS_ORIENT with the board.
      // Saying so is worth more than a control that does nothing.
      //
      // `=== 0` rather than `!== 0`, which is not pedantry: a parameter this
      // vehicle does not have reads as `undefined`, and `undefined !== 0` is
      // true -- so a missing flag claimed the compass was external and
      // offered an orientation control for it. Absent is not external.
      //
      // "External" is ArduPilot's word for "do not rotate this one with the
      // board", not "on a cable". A Cube Orange's own AK09916 reports
      // COMPASS_EXTERNAL=1 (measured, and Mission Planner shows the same
      // tick for the same device id), because it sits on a bus the firmware
      // treats as external.
      external: state ? value(state.external) !== undefined && value(state.external) !== 0 : false,
    }
  })

  const filled = rows.filter((r) => r.id !== 0).length
  /**
   * Swap two priority slots, on the vehicle.
   *
   * Both halves or neither: a swap that wrote one id and failed the other
   * would leave the same compass in two slots, which is a configuration
   * nobody asked for. So the second write is only attempted if the first
   * lands, and a failure puts the pair back as staged edits -- the state the
   * action bar exists to carry.
   *
   * No refresh follows: PRIO ids expose no further parameters, and the order
   * they describe is not read again until the vehicle reboots anyway.
   */
  const swap = (a: number, b: number) => {
    const from = rows[a]
    const to = rows[b]
    if (!from || !to) return
    const feedback = useWriteFeedbackStore.getState()
    void connectionService
      .setParamNow(from.prio, to.id)
      .then(() => connectionService.setParamNow(to.prio, from.id))
      .then(() => {
        feedback.report({ ok: true, param: from.prio })
        // COMPASS_PRIO*_ID carries RebootRequired in ArduPilot's metadata,
        // and it means it: the order is read when the compass backends are
        // built, so until the restart this table is showing an order the
        // vehicle is not using.
        feedback.needReboot('Compass priority takes effect after a restart')
      })
      .catch((err: unknown) => {
        edit(from.prio, to.id)
        edit(to.prio, from.id)
        feedback.report({
          ok: false,
          param: `${from.prio}/${to.prio}`,
          ...(err instanceof Error && err.message ? { error: err.message } : {}),
        })
      })
  }

  return (
    <section className="compass-prio" aria-labelledby="compass-prio-title">
      <h3 className="compass-prio__title" id="compass-prio-title">
        Compass priority
        {/* The arrows write too, and have no control of their own to answer
            inside, so the table's own title does. */}
        <WriteFeedback prefixes={['COMPASS_PRIO']} inline />
      </h3>
      {/* Framed, with a header band and a rule between rows: it sat on the
          card as loose lines of text and controls, and did not read as the
          table it is. */}
      <div className="app-table">
      <div className="app-table__row compass-prio__row app-table__head">
        <span />
        <span>Compass</span>
        <span>Use</span>
        <span>Orientation</span>
        <span>Priority</span>
      </div>
      {rows.map((r, i) => (
        <div className="app-table__row compass-prio__row" key={r.prio}>
          <span className="compass-prio__n">{i + 1}</span>
          <span className="compass-prio__device">
            {r.id === 0 ? (
              <span className="compass-prio__empty">Empty</span>
            ) : (
              <>
                <span className="compass-prio__part">
                  {(r.device && describeDevice(r.device)) || `Device ${r.id}`}
                </span>
                {r.external && <span className="compass-prio__tag">external</span>}
                {r.missing && <span className="compass-prio__missing">not detected</span>}
              </>
            )}
          </span>

          {/* Priority-indexed: this switch belongs to the row. */}
          <span className="compass-prio__cell">
            {entries.has(r.use) && r.id !== 0 ? (
              <ParamField param={r.use} label={`Use compass ${i + 1} for yaw`} bare writeNow />
            ) : (
              <span className="compass-prio__na">—</span>
            )}
          </span>

          {/* State-indexed: this one belongs to the *device*, found by id. */}
          <span className="compass-prio__cell">
            {r.state && entries.has(r.state.orient) && r.external ? (
              <ParamField
                param={r.state.orient}
                label={`Compass ${i + 1} orientation`}
                bare
                writeNow
              />
            ) : r.id === 0 ? (
              <span className="compass-prio__na">—</span>
            ) : (
              // Not "AHRS_ORIENT": a parameter name on screen says nothing to
              // the person reading the row, and that one was not even
              // ArduPilot's spelling of it. What the cell has to say is why
              // there is no control here.
              <span className="compass-prio__na" title="An internal compass turns with the board">
                Follows the board
              </span>
            )}
          </span>

          <span className="compass-prio__moves">
            <button
              type="button"
              className="compass-prio__move"
              disabled={i === 0 || r.id === 0}
              title="Use this compass sooner"
              aria-label={`Move compass ${i + 1} up`}
              onClick={() => swap(i, i - 1)}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path fill="currentColor" d={mdiArrowUp} />
              </svg>
            </button>
            <button
              type="button"
              className="compass-prio__move"
              disabled={i >= filled - 1 || r.id === 0}
              title="Use this compass later"
              aria-label={`Move compass ${i + 1} down`}
              onClick={() => swap(i, i + 1)}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path fill="currentColor" d={mdiArrowDown} />
              </svg>
            </button>
          </span>
        </div>
      ))}
      </div>
      {/* No standing line saying the order waits for a restart: a swap raises
          the restart prompt itself, which says so when it is true. */}
    </section>
  )
}
