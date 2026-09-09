import { execFile } from 'node:child_process'

// What a serial port actually is, according to the machine it is plugged into.
//
// A CubeOrange presents *two* USB CDC interfaces from one cable -- the MAVLink
// port and the SLCAN port for DroneCAN peripherals -- and they are
// indistinguishable by everything Chromium hands us: same vendor id, same
// product id, and the same `displayName`, because that field is the device's
// USB product string and a product string describes the device, not one of its
// interfaces. So the chooser offered two identical rows and the only way to
// tell which was which was to connect to one and see whether a heartbeat
// arrived.
//
// Windows already knows. Its driver names them "Cube Orange+ Mavlink" and
// "Cube Orange+ SLCAN", and that is the same source Mission Planner reads --
// per ArduPilot's own docs, the ports are "clearly labeled" there only once
// the driver set that supplies these names is installed, which is exactly the
// admission that the label comes from the driver rather than from the GCS.
//
// Read rather than derived, deliberately. The interface number in the device
// id (MI_00, MI_02) would let us guess -- ArduPilot puts MAVLink first -- but
// that is a convention we would be asserting about every composite serial
// device anyone plugs in, and it is the sort of confident guess that has been
// wrong here before. The driver's own string needs no such assumption and is
// right for boards nobody has thought about.
//
// Measured at 28 ms for two ports, so it happens before the chooser is shown
// rather than filling in behind it.

/** Windows appends "(COM31)"; the row already leads with the port name. */
export function stripPortSuffix(name: string): string {
  return name.replace(/\s*\((?:COM|LPT)\d+\)\s*$/i, '').trim()
}

/** The one value out of `reg query ... /v FriendlyName`. */
export function parseFriendlyName(stdout: string): string | null {
  const m = /^\s*FriendlyName\s+REG_SZ\s+(.+?)\s*$/im.exec(stdout)
  if (!m) return null
  const name = stripPortSuffix(m[1] ?? '')
  return name || null
}

const ENUM_ROOT = ['HKLM', 'SYSTEM', 'CurrentControlSet', 'Enum'].join('\\')

/**
 * The friendly name for one device instance id, or null.
 *
 * Never throws and never hangs the chooser: a missing key, a `reg` that is
 * not there, or one that does not answer all resolve to null, and the port
 * keeps whatever name it already had.
 */
function friendlyName(deviceInstanceId: string, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    const child = execFile(
      'reg',
      ['query', `${ENUM_ROOT}\\${deviceInstanceId}`, '/v', 'FriendlyName'],
      // No shell: a device id is full of `&`, which a shell would treat as
      // backgrounding rather than as part of the key.
      { windowsHide: true, timeout: timeoutMs },
      (err, stdout) => resolve(err ? null : parseFriendlyName(stdout)),
    )
    child.on('error', () => resolve(null))
  })
}

export interface NameablePort {
  displayName?: string | undefined
  deviceInstanceId?: string | undefined
}

/**
 * Replace each port's display name with the driver's, where there is one.
 *
 * Windows only -- `deviceInstanceId` is a Windows field and every other
 * platform gets the list back untouched.
 */
export async function withDriverNames<T extends NameablePort>(
  ports: T[],
  platform: string = process.platform,
  timeoutMs = 1500,
): Promise<T[]> {
  if (platform !== 'win32') return ports
  return Promise.all(
    ports.map(async (p) => {
      if (!p.deviceInstanceId) return p
      const name = await friendlyName(p.deviceInstanceId, timeoutMs)
      return name ? { ...p, displayName: name } : p
    }),
  )
}
