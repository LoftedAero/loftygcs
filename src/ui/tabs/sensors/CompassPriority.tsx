import { mdiArrowDown, mdiArrowUp } from '@mdi/js'
import ParamField from '../../components/ParamField'
import WriteFeedback from '../../components/WriteFeedback'
import { useParamStore } from '../../../stores/param-store'
import { useWriteFeedbackStore } from '../../../stores/write-feedback-store'
import { connectionService } from '../../../services/connection'
import { decodeDeviceId, describeDevice } from '../../../protocol/device-id'

// Which compass the EKF believes first, and the settings that belong to each.
//
// The two are indexed differently. ArduPilot uses type-safe index types so
// the firmware cannot confuse them (AP_Compass.h):
//
//   RestrictIDTypeArray<mag_state, .., StateIndex> _state;              // ORIENT, EXTERN, DEV_ID
//   RestrictIDTypeArray<AP_Int8,   .., Priority>   _use_for_yaw;        // USE
//   RestrictIDTypeArray<AP_Int32,  .., Priority>   _priority_did_stored_list; // PRIO*_ID
//
// So COMPASS_USE2 is "the compass in priority slot 2", while COMPASS_ORIENT2
// and COMPASS_EXTERN2 belong to "the device detected into state slot 2".
// They agree until the priorities are reordered. The firmware maps between
// them in `_get_state_id()` by matching device ids, as `stateSlotFor` does
// below; nothing here indexes by row number.
//
// Reordering swaps two COMPASS_PRIO*_ID values and writes immediately. The
// PRIO ids are RebootRequired: priority is read when the compass backends are
// built, so the new order applies only after a restart.

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

  /** The state slot holding this device, as the firmware's `_get_state_id` finds it. */
  const stateSlotFor = (id: number) => (id ? STATE.find((s) => value(s.devId) === id) : undefined)

  const rows = slots.map((s) => {
    const id = value(s.prio) ?? 0
    const state = stateSlotFor(id)
    return {
      ...s,
      id,
      state,
      device: decodeDeviceId(id, 'compass'),
      // A priority slot naming a device the firmware no longer reports
      // (unplugged, or moved to another bus).
      missing: id !== 0 && !detected.has(id),
      // ArduPilot ignores a compass orientation unless the compass is
      // external; an internal one rotates with the board via AHRS_ORIENT.
      // An absent parameter is not external.
      //
      // "External" means "not rotated with the board", not "on a cable": a
      // Cube Orange's built-in AK09916 reports COMPASS_EXTERNAL=1 because it
      // sits on a bus the firmware treats as external.
      external: state ? value(state.external) !== undefined && value(state.external) !== 0 : false,
    }
  })

  const filled = rows.filter((r) => r.id !== 0).length
  /**
   * Swap two priority slots on the vehicle.
   *
   * The second write is attempted only if the first lands, so the same
   * compass never ends up in two slots; on failure the pair is staged
   * instead. No refresh follows, since PRIO ids gate no other parameters.
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
        // The new order applies only after a restart.
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
        {/* Write feedback for the reorder arrows. */}
        <WriteFeedback prefixes={['COMPASS_PRIO']} inline />
      </h3>
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

          {/* State-indexed: this one belongs to the device, found by id. */}
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
    </section>
  )
}
