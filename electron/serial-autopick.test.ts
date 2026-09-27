import { describe, expect, it } from 'vitest'
import { looksLikeBootloader, newPortSince, pickBootloaderPort } from './serial-autopick'

// A Cube Orange+ with two CubePilot interfaces and two Bluetooth ports; on
// reboot its bootloader replaces the MAVLink interface.
const BEFORE = ['cube-mavlink', 'cube-slcan', 'bt-1', 'bt-2']
const ports = (...ids: string[]) => ids.map((portId) => ({ portId }))

describe('answering a port request from the list difference', () => {
  it('picks the bootloader that appeared while the board rebooted', () => {
    const after = ports('cube-slcan', 'bt-1', 'bt-2', 'cube-bootloader')
    expect(newPortSince(after, new Set(BEFORE))).toBe('cube-bootloader')
  })

  it('asks when two ports appeared at once', () => {
    // Something else was plugged in at the same moment; guessing could erase
    // the wrong board.
    const after = ports('bt-1', 'cube-bootloader', 'some-usb-serial')
    expect(newPortSince(after, new Set(BEFORE))).toBeNull()
  })

  it('asks when nothing appeared, which is a reboot that did not take', () => {
    expect(newPortSince(ports(...BEFORE), new Set(BEFORE))).toBeNull()
  })

  it('asks on the first request of all, when every port looks new', () => {
    // With no previous list "new" means nothing; on a one-port machine it
    // would auto-pick without anyone choosing.
    expect(newPortSince(ports('cube-mavlink'), new Set())).toBeNull()
  })

  it('ignores ports that went away, counting only arrivals', () => {
    // The MAVLink interface disappears on reboot; only arrivals count.
    const after = ports('bt-1', 'bt-2', 'cube-bootloader')
    expect(newPortSince(after, new Set(BEFORE))).toBe('cube-bootloader')
  })
})

describe('recognising a bootloader by what it calls itself', () => {
  it('knows an ArduPilot bootloader by its product string', () => {
    // The hwdef name with -BL appended (the manifest's bootloader_str).
    expect(looksLikeBootloader({ portId: 'x', displayName: 'CubeOrangePlus-BL' })).toBe(true)
    expect(looksLikeBootloader({ portId: 'x', displayName: 'Cube Orange+ Mavlink' })).toBe(false)
  })

  it('knows the generic ArduPilot and the old PX4 bootloader ids, as Electron spells them', () => {
    // Electron sends the ids as decimal strings: 0x1209 arrives as "4617".
    expect(looksLikeBootloader({ portId: 'x', vendorId: '4617', productId: '22337' })).toBe(true)
    expect(looksLikeBootloader({ portId: 'x', vendorId: 0x26ac, productId: 0x0011 })).toBe(true)
    expect(looksLikeBootloader({ portId: 'x', vendorId: '11694', productId: '4184' })).toBe(false)
    // A string with a hex letter is read as hex. One without ("0011") is
    // ambiguous and read as decimal, which is what Electron sends.
    expect(looksLikeBootloader({ portId: 'x', vendorId: '26ac', productId: 0x0011 })).toBe(true)
  })
})

describe('answering a held request', () => {
  it('picks the one port that says it is a bootloader, with no previous list at all', () => {
    // First request of the session, so nothing to diff against, but the
    // bootloader names itself.
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
  // On Windows, after a Cube reboots into its bootloader, Chromium lists the
  // old MAVLink port and the new one, both with product string
  // "CubeOrange-BL". Only the driver names tell them apart; opening the
  // phantom fails with FILE_ERROR_NOT_FOUND.
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
    // No driver names; the port the reboot produced is the one that arrived.
    const stale = { portId: 'a', displayName: 'MatekH743-BL' }
    const fresh = { portId: 'b', displayName: 'MatekH743-BL' }
    expect(pickBootloaderPort([stale, fresh], new Set(['a']), new Set(['b']))).toBe('b')
  })

  it('still asks when two bootloaders arrived at once', () => {
    const a = { portId: 'a', displayName: 'X-BL' }
    const b = { portId: 'b', displayName: 'Y-BL' }
    expect(pickBootloaderPort([a, b], new Set(), new Set(['a', 'b']))).toBeNull()
  })

  it('never answers with a running board’s interface just because it is new', () => {
    // The board has left its bootloader, and the port that appeared
    // mid-request is the firmware's SLCAN interface.
    const slcan = { portId: 'com38', displayName: 'CubeOrange', driverName: 'Cube Orange SLCAN' }
    const before = new Set([...others.map((p) => p.portId), 'com36', 'com37'])
    expect(pickBootloaderPort([...others, phantom, slcan], before, new Set(['com38']))).toBeNull()
  })
})
