import { useParamStore } from '../../../stores/param-store'
import { useConnectionStore } from '../../../stores/connection-store'
import { LaHint } from '../../components/La'
import { DEVICE_SLOTS, decodeDeviceId, describeDevice } from '../../../protocol/device-id'

// What is actually plugged into this board.
//
// ArduPilot stores a packed device ID for every sensor it detects, and the
// numbers are already on screen -- in the parameter table, as eight-digit
// integers nobody can read. Unpacked they answer the questions a bench
// session asks out loud: is the external compass being seen at all, is that
// IMU the one this board is supposed to have, did the second barometer come
// up on the bus it should be on.
//
// It sits in the Inspector rather than under Sensors because it is the same
// kind of thing as the message list beside it: not a step in a bring-up, but
// the X-ray you reach for when a step goes wrong. A compass that will not
// calibrate is usually a compass that was never found, and this is the
// screen that says so.
//
// Read from the parameters already downloaded, so it costs no traffic and
// works on a vehicle that has gone quiet.

export default function HardwareId() {
  const connected = useConnectionStore((s) => s.phase === 'connected' || s.phase === 'linkLost')
  const entries = useParamStore((s) => s.entries)

  if (!connected) {
    return (
      <p className="app-placeholder">
        Connect a vehicle and this lists the sensors its firmware has detected, with the bus and
        address each one was found on.
      </p>
    )
  }
  if (entries.size === 0) {
    return <p className="app-placeholder">Waiting for the parameters this is read from…</p>
  }

  // Present means the parameter exists: a vehicle with one compass has no
  // COMPASS_DEV_ID2 at all, and an empty row for it would suggest a slot
  // that could be filled.
  const found = DEVICE_SLOTS.map((slot) => ({
    slot,
    value: entries.get(slot.param)?.value,
  })).filter((r) => r.value !== undefined)

  const live = found.filter((r) => r.value !== 0)

  return (
    <div className="hwid">
      <table className="hwid__table">
        <thead>
          <tr>
            <th>Device</th>
            <th>Part</th>
            <th>Bus</th>
            <th className="num">Address</th>
            <th className="num">ID</th>
          </tr>
        </thead>
        <tbody>
          {live.map(({ slot, value }) => {
            const d = decodeDeviceId(value!, slot.cls)!
            return (
              <tr key={slot.param}>
                <td>
                  {slot.label}
                  {/* The parameter name, because the next thing anyone does
                      with a surprising row is go and look it up. */}
                  <span className="hwid__param">{slot.param}</span>
                </td>
                <td className={d.name ? undefined : 'hwid__unknown'}>
                  {d.name ?? `Type 0x${d.devType.toString(16).padStart(2, '0')}`}
                </td>
                <td>
                  {d.busType === 'DroneCAN' || d.busType === 'SITL'
                    ? d.busType
                    : `${d.busType}${d.bus}`}
                </td>
                <td className="num">
                  {d.busType === 'DroneCAN' || d.busType === 'SITL'
                    ? '—'
                    : `0x${d.address.toString(16).padStart(2, '0')}`}
                </td>
                <td className="num hwid__raw">{d.id}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {live.length === 0 && (
        <p className="app-placeholder">
          This firmware reports no detected sensors. Every device ID it has is zero, which usually
          means the sensors are on a bus the board has not been told about.
        </p>
      )}

      {/* Only when something is unnamed. It explains a row that is already
          on screen, and with every part recognised it is a paragraph about
          a situation the reader is not in. */}
      {live.some(({ slot, value }) => !decodeDeviceId(value!, slot.cls)!.name) && (
        <LaHint>A device type this build has no name for keeps its number.</LaHint>
      )}
    </div>
  )
}

/** One line per device, for the clipboard and for a bug report. */
export function hardwareSummary(entries: Map<string, { value: number }>): string {
  return DEVICE_SLOTS.flatMap((slot) => {
    const value = entries.get(slot.param)?.value
    if (value === undefined || value === 0) return []
    const d = decodeDeviceId(value, slot.cls)
    return d ? [`${slot.label}: ${describeDevice(d)}`] : []
  }).join('\n')
}
