// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { describePort, hex, usbIds } from './SerialChooserModal'

// Turning a list of COM7 / COM12 into a choice someone can actually make.

describe('hex', () => {
  it('reads the decimal Electron actually sends', () => {
    // Electron passes the uint16 ids as decimal strings: 0x1209 arrives as
    // "4617".
    expect(hex('4617')).toBe('1209')
    expect(hex('22337')).toBe('5741')
    expect(hex('1155')).toBe('0483')
    expect(hex('57105')).toBe('DF11')
  })

  it('still reads a hex string, which can only be hex', () => {
    expect(hex('df11')).toBe('DF11')
    expect(hex('DF11')).toBe('DF11')
  })

  it('gives nothing rather than a wrong number', () => {
    expect(hex(undefined)).toBeNull()
    expect(hex('')).toBeNull()
    expect(hex('0')).toBeNull()
    expect(hex('nonsense')).toBeNull()
  })
})

describe('describePort', () => {
  const base = { portId: 'p1', portName: 'COM7' }

  it('uses the product string the device supplies', () => {
    expect(describePort({ ...base, displayName: 'Pixhawk6C' })).toBe('Pixhawk6C')
  })

  it('says nothing when the name adds nothing', () => {
    expect(describePort(base)).toBeNull()
    expect(describePort({ ...base, displayName: 'COM7' })).toBeNull()
    expect(describePort({ ...base, displayName: '  ' })).toBeNull()
  })

  it('names the DFU bootloader, which reports itself uselessly', () => {
    // A board in DFU otherwise shows up as a bare "STM32 BOOTLOADER".
    expect(
      describePort({ ...base, vendorId: '1155', productId: '57105', displayName: 'STM32' }),
    ).toMatch(/DFU bootloader/)
  })
})

describe('usbIds', () => {
  it('shows what tells two identical boards apart', () => {
    expect(usbIds({ portId: 'p', portName: 'COM7', vendorId: '4617', productId: '22337' })).toBe(
      'USB 1209:5741',
    )
    expect(
      usbIds({
        portId: 'p',
        portName: 'COM7',
        vendorId: '4617',
        productId: '22337',
        serialNumber: 'ABC123',
      }),
    ).toBe('USB 1209:5741 · SN ABC123')
  })

  it('is absent rather than half-filled', () => {
    expect(usbIds({ portId: 'p', portName: 'COM7' })).toBeNull()
    expect(usbIds({ portId: 'p', portName: 'COM7', vendorId: '4617' })).toBeNull()
  })
})
