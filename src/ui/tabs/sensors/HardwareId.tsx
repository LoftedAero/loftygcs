import { useParamStore } from '../../../stores/param-store'
import { DEVICE_SLOTS, decodeDeviceId, describeDevice } from '../../../protocol/device-id'

// The sensors this board detected, decoded from the packed device IDs
// ArduPilot stores in parameters (COMPASS_DEV_ID, INS_ACC_ID and so on). It
// shows whether an external compass was found at all, which part each IMU
// is, and which bus each device is on.
//
// Read from the downloaded parameters, so it needs no extra traffic.

export default function HardwareId() {
  // The Sensors tab renders this only once parameters are loaded.
  const entries = useParamStore((s) => s.entries)

  // Only slots whose parameter exists; a vehicle with one compass has no
  // COMPASS_DEV_ID2.
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
                  {/* The parameter name, for looking it up. */}
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
