import { describe, expect, it } from 'vitest'
import { parseFriendlyName, stripPortSuffix, withDriverNames } from './serial-names'

// Real registry output from a CubeOrange+ on Windows. Both its interfaces
// report the same vendor id, product id and USB product string, so only the
// driver name says which one speaks MAVLink.

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
    // Only a trailing port suffix is removed.
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
    // Bluetooth serial, and anything else Chromium enumerates without one.
    const ports = [{ displayName: 'Bluetooth Peripheral Device' }]
    expect(await withDriverNames(ports, 'win32')).toEqual(ports)
  })

  it('keeps the original name when the lookup finds nothing', async () => {
    // No FriendlyName in the registry: `reg` exits non-zero, and the port
    // keeps the name it already had.
    const ports = [{ displayName: 'CubeOrange+', deviceInstanceId: 'USB\\NOT_A_REAL_DEVICE\\0000' }]
    expect(await withDriverNames(ports, 'win32')).toEqual(ports)
  })
})
