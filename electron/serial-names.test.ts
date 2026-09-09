import { describe, expect, it } from 'vitest'
import { parseFriendlyName, stripPortSuffix, withDriverNames } from './serial-names'

// The strings here are real: taken from a CubeOrange+ on Windows, which is
// the board the problem was found on. Both its interfaces report the same
// vendor id, product id and USB product string ("CubeOrange+"), so the
// chooser had two identical rows and no way to say which one speaks MAVLink.

const MAVLINK = [
  '',
  'HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Enum\\USB\\VID_2DAE&PID_1058&MI_00\\9&79BAA92&0&0000',
  '    FriendlyName    REG_SZ    Cube Orange+ Mavlink (COM32)',
  '',
].join('\r\n')

const SLCAN = [
  '',
  'HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Enum\\USB\\VID_2DAE&PID_1058&MI_02\\9&79BAA92&0&0002',
  '    FriendlyName    REG_SZ    Cube Orange+ SLCAN (COM31)',
  '',
].join('\r\n')

describe('reading the driver name', () => {
  it('separates the two interfaces of one board', () => {
    expect(parseFriendlyName(MAVLINK)).toBe('Cube Orange+ Mavlink')
    expect(parseFriendlyName(SLCAN)).toBe('Cube Orange+ SLCAN')
  })

  it('drops the port number the row already shows', () => {
    expect(stripPortSuffix('Cube Orange+ SLCAN (COM31)')).toBe('Cube Orange+ SLCAN')
    expect(stripPortSuffix('Standard Serial over Bluetooth link (COM3)')).toBe(
      'Standard Serial over Bluetooth link',
    )
    // Only a trailing one, and only a port: a name that is *about* a COM
    // port keeps its words.
    expect(stripPortSuffix('USB to COM1 adapter')).toBe('USB to COM1 adapter')
  })

  it('returns null rather than an empty label', () => {
    expect(parseFriendlyName('ERROR: The system was unable to find the key')).toBeNull()
    expect(parseFriendlyName('    FriendlyName    REG_SZ    (COM7)')).toBeNull()
    expect(parseFriendlyName('')).toBeNull()
  })
})

describe('enriching a port list', () => {
  it('leaves every other platform alone', async () => {
    const ports = [{ displayName: 'CubeOrange+', deviceInstanceId: 'USB\\VID_2DAE' }]
    expect(await withDriverNames(ports, 'darwin')).toEqual(ports)
    expect(await withDriverNames(ports, 'linux')).toEqual(ports)
  })

  it('keeps a port that has no device id to look up', async () => {
    // Bluetooth serial and anything Chromium enumerates without one. The
    // chooser must still list them, with whatever name they came with.
    const ports = [{ displayName: 'Bluetooth Peripheral Device' }]
    expect(await withDriverNames(ports, 'win32')).toEqual(ports)
  })

  it('keeps the original name when the lookup finds nothing', async () => {
    // A device with no FriendlyName in the registry. `reg` exits non-zero,
    // which must degrade to the name we already had rather than to a blank
    // row -- a chooser that lists an unnamed port is still usable.
    const ports = [{ displayName: 'CubeOrange+', deviceInstanceId: 'USB\\NOT_A_REAL_DEVICE\\0000' }]
    expect(await withDriverNames(ports, 'win32')).toEqual(ports)
  })
})
