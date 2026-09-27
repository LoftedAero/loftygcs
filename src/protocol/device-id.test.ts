import { describe, expect, it } from 'vitest'
import { decodeDeviceId, describeDevice } from './device-id'

// The bit layout is `bus_type:3, bus:5, address:8, devtype:8` from
// AP_HAL/Device.h. Fixtures are packed the way ArduPilot packs them rather
// than copied from this decoder's output.
const pack = (busType: number, bus: number, address: number, devType: number) =>
  (busType & 0x7) | ((bus & 0x1f) << 3) | (address << 8) | (devType << 16)

describe('unpacking a device ID', () => {
  it('takes the four fields out of the word', () => {
    // An ICM42688 on SPI bus 1, chip select 1.
    const d = decodeDeviceId(pack(2, 1, 1, 0x34), 'imu')!
    expect(d.busType).toBe('SPI')
    expect(d.bus).toBe(1)
    expect(d.address).toBe(1)
    expect(d.devType).toBe(0x34)
    expect(d.name).toBe('ICM42688')
  })

  it('reads an I2C compass at its real address', () => {
    // IST8310 at 0x0E on I2C bus 0: the classic external compass.
    const d = decodeDeviceId(pack(1, 0, 0x0e, 0x0a), 'compass')!
    expect(describeDevice(d)).toBe('IST8310 on I2C0, address 0x0e')
  })

  it('names the same number differently per class, which is the whole trap', () => {
    // 0x0B is an ICM20948 to the compass driver and an MS5611 to the
    // barometer driver, so the class has to go with the number.
    expect(decodeDeviceId(pack(1, 0, 0x10, 0x0b), 'compass')!.name).toBe('ICM20948')
    expect(decodeDeviceId(pack(1, 0, 0x77, 0x0b), 'baro')!.name).toBe('MS5611')
  })

  it('calls an empty slot empty rather than a device at address zero', () => {
    // ArduPilot leaves the parameter at zero for a sensor it never found,
    // which is different from a sensor it found but this table cannot name.
    expect(decodeDeviceId(0, 'imu')).toBeNull()
  })

  it('keeps an unknown device type as a number instead of guessing', () => {
    // A part newer than this table keeps its bus and address; only the name
    // is missing.
    const d = decodeDeviceId(pack(2, 4, 3, 0xfe), 'imu')!
    expect(d.name).toBeNull()
    expect(describeDevice(d)).toBe('Type 0xfe on SPI4, address 0x03')
  })

  it('drops the bus and address where they mean nothing', () => {
    // A DroneCAN sensor is a network node, not a device at an address, and
    // SITL is not a device at all, so neither gets an address.
    expect(describeDevice(decodeDeviceId(pack(3, 0, 0, 0x0d), 'baro')!)).toBe(
      'DroneCAN on DroneCAN',
    )
    expect(describeDevice(decodeDeviceId(pack(4, 0, 0, 0x2a), 'imu')!)).toBe('SITL on SITL')
  })

  it('reads the top bit of the device type without going negative', () => {
    // devtype 0xFF puts a 1 in bit 23; a signed shift would make the whole
    // word negative and every field after it wrong.
    const d = decodeDeviceId(pack(1, 2, 0x77, 0xff), 'baro')!
    expect(d.devType).toBe(0xff)
    expect(d.bus).toBe(2)
    expect(d.address).toBe(0x77)
  })
})
