import { execFile } from 'node:child_process'

// Windows driver names for serial ports.
//
// A CubeOrange presents two USB CDC interfaces on one cable (MAVLink, and
// SLCAN for DroneCAN), and Chromium reports both with the same vendor id,
// product id and `displayName`, since that is the device's USB product
// string. The Windows driver names them "Cube Orange+ Mavlink" and
// "Cube Orange+ SLCAN"; Mission Planner reads the same names.
//
// The interface number in the device id (MI_00, MI_02) would allow a guess,
// but that asserts a convention about every composite serial device. The
// driver's string needs no assumption. The lookup takes tens of milliseconds,
// so it runs before the chooser is shown.

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
 * The friendly name for one device instance id, or null. Never throws: a
 * missing key, a missing `reg`, or a timeout all resolve to null.
 */
function friendlyName(deviceInstanceId: string, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    const child = execFile(
      'reg',
      ['query', `${ENUM_ROOT}\\${deviceInstanceId}`, '/v', 'FriendlyName'],
      // No shell: device ids contain `&`.
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
 * Windows only; other platforms get the list back untouched.
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
