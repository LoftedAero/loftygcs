import { describe, expect, it } from 'vitest'
import { looksLikeBootloader, newPortSince, pickBootloaderPort } from './serial-autopick'

// The real sequence this exists for, taken from a Cube Orange+ on the bench:
// two CubePilot interfaces and a pair of Bluetooth ports, then the board
// reboots and its bootloader replaces the MAVLink interface.
const BEFORE = ['cube-mavlink', 'cube-slcan', 'bt-1', 'bt-2']
const ports = (...ids: string[]) => ids.map((portId) => ({ portId }))

describe('answering a port request from the list difference', () => {
  it('picks the bootloader that appeared while the board rebooted', () => {
    const after = ports('cube-slcan', 'bt-1', 'bt-2', 'cube-bootloader')
    expect(newPortSince(after, new Set(BEFORE))).toBe('cube-bootloader')
  })

  it('asks when two ports appeared at once', () => {
    // Something else was plugged in at the same moment. Either guess is a
    // board chosen silently and then erased.
    const after = ports('bt-1', 'cube-bootloader', 'some-usb-serial')
    expect(newPortSince(after, new Set(BEFORE))).toBeNull()
  })

  it('asks when nothing appeared, which is a reboot that did not take', () => {
    expect(newPortSince(ports(...BEFORE), new Set(BEFORE))).toBeNull()
  })

  it('asks on the first request of all, when every port looks new', () => {
    // With no previous list "new" is not evidence of anything -- and on a
    // one-port machine it would auto-pick before anyone had chosen a thing.
    expect(newPortSince(ports('cube-mavlink'), new Set())).toBeNull()
  })

  it('ignores ports that went away, counting only arrivals', () => {
    // The MAVLink interface disappears on reboot. A diff that counted
    // removals would see two changes and give up.
    const after = ports('bt-1', 'bt-2', 'cube-bootloader')
    expect(newPortSince(after, new Set(BEFORE))).toBe('cube-bootloader')
  })
})

describe('recognising a bootloader by what it calls itself', () => {
  it('knows an ArduPilot bootloader by its product string', () => {
    // The hwdef name with -BL on it, which is what the manifest carries as
    // bootloader_str and what the board enumerates as.
    expect(looksLikeBootloader({ portId: 'x', displayName: 'CubeOrangePlus-BL' })).toBe(true)
    expect(looksLikeBootloader({ portId: 'x', displayName: 'Cube Orange+ Mavlink' })).toBe(false)
  })

  it('knows the generic ArduPilot and the old PX4 bootloader ids, as Electron spells them', () => {
    // Electron hands the ids over as decimal strings built from uint16s:
    // 0x1209 arrives as "4617". Read as hex that is 0x4617, a vendor that
    // does not exist, and the first version of this test passed a hex string
    // and so never noticed.
    expect(looksLikeBootloader({ portId: 'x', vendorId: '4617', productId: '22337' })).toBe(true)
    expect(looksLikeBootloader({ portId: 'x', vendorId: 0x26ac, productId: 0x0011 })).toBe(true)
    expect(looksLikeBootloader({ portId: 'x', vendorId: '11694', productId: '4184' })).toBe(false)
    // A hex string with a letter in it is read as hex. One without -- "0011"
    // for PX4's product id -- cannot be told from decimal, which is the
    // limit the chooser's hex() helper documents too; the decimal reading
    // wins because that is what Electron actually sends.
    expect(looksLikeBootloader({ portId: 'x', vendorId: '26ac', productId: 0x0011 })).toBe(true)
  })
})

describe('answering a held request', () => {
  it('picks the one port that says it is a bootloader, with no previous list at all', () => {
    // The hole the bench found: the autopilot port was already granted, so
    // this was the first request of the session and there was nothing to
    // diff against -- yet the bootloader was right there in the list.
    const list = [
      { portId: 'bt-1', displayName: 'Standard Serial over Bluetooth link' },
      { portId: 'cube-slcan', displayName: 'Cube Orange+ SLCAN' },
      { portId: 'cube-bl', displayName: 'CubeOrangePlus-BL' },
    ]
    expect(pickBootloaderPort(list, new Set())).toBe('cube-bl')
  })

  it('asks when two bootloaders are attached', () => {
    const list = [
      { portId: 'a', displayName: 'CubeOrangePlus-BL' },
      { portId: 'b', displayName: 'MatekH743-BL' },
    ]
    expect(pickBootloaderPort(list, new Set())).toBeNull()
  })

  it('falls back to the port that appeared, for a bootloader with no name', () => {
    const list = [...ports('cube-slcan', 'bt-1'), { portId: 'unnamed-new' }]
    expect(pickBootloaderPort(list, new Set(BEFORE))).toBe('unnamed-new')
  })
})

describe('the phantom port a reboot leaves behind', () => {
  // Traced on the bench: after the Cube rebooted into its bootloader,
  // Chromium listed the old MAVLink port *and* the new one, both with the
  // product string "CubeOrange-BL". Only the driver names told them apart,
  // and opening the phantom failed FILE_ERROR_NOT_FOUND.
  const phantom = {
    portId: 'com36',
    displayName: 'CubeOrange-BL',
    driverName: 'Cube Orange Mavlink',
  }
  const real = {
    portId: 'com37',
    displayName: 'CubeOrange-BL',
    driverName: 'Cube Orange Bootloader',
  }
  const others = [
    {
      portId: 'bt-1',
      displayName: 'Bluetooth Peripheral Device',
      driverName: 'Standard Serial over Bluetooth link',
    },
  ]

  it('is vetoed by a driver name that says it is a MAVLink interface', () => {
    expect(looksLikeBootloader(phantom)).toBe(false)
    expect(looksLikeBootloader(real)).toBe(true)
  })

  it('picks the real bootloader with the phantom beside it', () => {
    expect(pickBootloaderPort([...others, phantom, real], new Set())).toBe('com37')
  })

  it('prefers the port that arrived during the request over a lookalike already there', () => {
    // No driver names at all -- a board Windows gives a generic name to.
    // The one the reboot produced is the one that arrived.
    const stale = { portId: 'a', displayName: 'MatekH743-BL' }
    const fresh = { portId: 'b', displayName: 'MatekH743-BL' }
    expect(pickBootloaderPort([stale, fresh], new Set(['a']), new Set(['b']))).toBe('b')
  })

  it('still asks when two bootloaders arrived at once', () => {
    const a = { portId: 'a', displayName: 'X-BL' }
    const b = { portId: 'b', displayName: 'Y-BL' }
    expect(pickBootloaderPort([a, b], new Set(), new Set(['a', 'b']))).toBeNull()
  })
})
