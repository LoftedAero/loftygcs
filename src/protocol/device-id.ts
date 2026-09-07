// What is actually plugged into this flight controller.
//
// ArduPilot gives every detected sensor a device ID and stores it in a
// parameter -- INS_ACC_ID, COMPASS_DEV_ID, BARO1_DEVID and their siblings.
// Each is a packed 32-bit word rather than a number anyone reads, and
// unpacking it answers the questions a bench session actually asks: is the
// external compass being seen at all, is that IMU the one the board is meant
// to have, did the second baro appear on the bus it should be on.
//
// Mission Planner's Hardware ID screen does the same job, and the values
// below are ArduPilot's own -- taken from its headers rather than inferred
// from what a particular board happened to report:
//
//   libraries/AP_HAL/Device.h                        (bus types, bit layout)
//   libraries/AP_InertialSensor/AP_InertialSensor_Backend.h
//   libraries/AP_Compass/AP_Compass_Backend.h
//   libraries/AP_Baro/AP_Baro_Backend.h
//
// The device type is **class specific**: 0x0B is an ICM20948 to the compass
// driver and an MS5611 to the barometer one. So a decoder that does not know
// which parameter it is reading cannot name the part, and every lookup here
// takes the class with the number. Getting that wrong would put a confident
// wrong sensor name on screen, which is worse than the raw hex it replaced.

/** `bus_type:3, bus:5, address:8, devtype:8`, from AP_HAL/Device.h. */
const BUS_TYPES = ['Unknown', 'I2C', 'SPI', 'DroneCAN', 'SITL', 'MSP', 'Serial', 'QSPI'] as const

/** Which table names a device type. */
export type DeviceClass = 'imu' | 'compass' | 'baro'

const IMU_TYPES: Record<number, string> = {
  0x11: 'LSM303D',
  0x12: 'BMA180',
  0x13: 'MPU6000',
  0x16: 'MPU9250',
  0x17: 'IIS328DQ',
  0x18: 'LSM9DS1',
  0x21: 'MPU6000',
  0x22: 'L3GD20',
  0x24: 'MPU9250',
  0x25: 'I3G4250D',
  0x26: 'LSM9DS1',
  0x27: 'ICM20789',
  0x28: 'ICM20689',
  0x29: 'BMI055',
  0x2a: 'SITL',
  0x2b: 'BMI088',
  0x2c: 'ICM20948',
  0x2d: 'ICM20648',
  0x2e: 'ICM20649',
  0x2f: 'ICM20602',
  0x30: 'ICM20601',
  0x31: 'ADIS1647x',
  0x33: 'ICM40609',
  0x34: 'ICM42688',
  0x35: 'ICM42605',
  0x36: 'ICM40605',
  0x37: 'IIM42652',
  0x39: 'BMI085',
  0x3a: 'ICM42670',
  0x3b: 'ICM45686',
  0x3c: 'SCHA63T',
  0x3d: 'IIM42653',
  0x3e: 'LSM6DSV16X',
  0x3f: 'ASM330',
  0x40: 'ADIS16607',
  0x41: 'SCH16T',
  0x42: 'LSM6DSV32X',
  0x43: 'LSM6DSK320X',
  0x44: 'ICM56686',
}

const COMPASS_TYPES: Record<number, string> = {
  0x01: 'HMC5883 (old)',
  0x02: 'LSM303D',
  0x04: 'AK8963',
  0x05: 'BMM150',
  0x06: 'LSM9DS1',
  0x07: 'HMC5883',
  0x08: 'LIS3MDL',
  0x09: 'AK09916',
  0x0a: 'IST8310',
  0x0b: 'ICM20948',
  0x0c: 'MMC3416',
  0x0d: 'QMC5883L',
  0x0e: 'MAG3110',
  0x0f: 'SITL',
  0x10: 'IST8308',
  0x11: 'RM3100',
  0x12: 'RM3100',
  0x13: 'MMC5983',
  0x14: 'AK09918',
  0x15: 'AK09915',
  0x16: 'QMC5883P',
  0x17: 'BMM350',
  0x18: 'IIS2MDC',
  0x1a: 'AF9838',
}

const BARO_TYPES: Record<number, string> = {
  0x01: 'SITL',
  0x02: 'BMP085',
  0x03: 'BMP280',
  0x04: 'BMP388',
  0x05: 'DPS280',
  0x06: 'DPS310',
  0x07: 'FBM320',
  0x08: 'ICM20789',
  0x09: 'KellerLD',
  0x0a: 'LPS2XH',
  0x0b: 'MS5611',
  0x0c: 'SPL06',
  0x0d: 'DroneCAN',
  0x0e: 'MSP',
  0x0f: 'ICP101xx',
  0x10: 'ICP201xx',
  0x11: 'MS5607',
  0x12: 'MS5837-30BA',
  0x13: 'MS5637',
  0x14: 'BMP390',
  0x15: 'BMP581',
  0x16: 'SPA06',
  0x17: 'AUAV',
  0x18: 'MS5837-02BA',
}

const TABLES: Record<DeviceClass, Record<number, string>> = {
  imu: IMU_TYPES,
  compass: COMPASS_TYPES,
  baro: BARO_TYPES,
}

export interface DecodedDevice {
  /** The raw parameter value, so an unrecognised part is still traceable. */
  id: number
  busType: string
  /** Which instance of that bus -- I2C0, SPI2. */
  bus: number
  /** Address on the bus: an I2C address, or a chip select for SPI. */
  address: number
  devType: number
  /** The part, where this class's table knows it. */
  name: string | null
}

/**
 * One packed device ID.
 *
 * Zero means the slot is empty -- ArduPilot leaves the parameter at zero for
 * an IMU or compass it never found -- and that is a different thing from a
 * device it found but this table cannot name, so it decodes to null rather
 * than to a device on an unknown bus at address zero.
 */
export function decodeDeviceId(id: number, cls: DeviceClass): DecodedDevice | null {
  if (!id) return null
  const devType = (id >>> 16) & 0xff
  return {
    id,
    busType: BUS_TYPES[id & 0x7] ?? 'Unknown',
    bus: (id >>> 3) & 0x1f,
    address: (id >>> 8) & 0xff,
    devType,
    name: TABLES[cls][devType] ?? null,
  }
}

/** How a device reads on one line: "ICM42688 on SPI1, address 0x01". */
export function describeDevice(d: DecodedDevice): string {
  const part = d.name ?? `Type 0x${d.devType.toString(16).padStart(2, '0')}`
  // DroneCAN and SITL have no bus number or address worth printing: the
  // first is a node on a network and the second is not a device at all.
  if (d.busType === 'DroneCAN' || d.busType === 'SITL') return `${part} on ${d.busType}`
  return `${part} on ${d.busType}${d.bus}, address 0x${d.address.toString(16).padStart(2, '0')}`
}

export interface DeviceSlot {
  /** The parameter this came from, which is what to search for elsewhere. */
  param: string
  /** What it is in the airframe: "Accel 1", "Compass 2". */
  label: string
  cls: DeviceClass
}

/**
 * The device-ID parameters worth showing, in the order they are numbered.
 *
 * Listed rather than pattern-matched: the names are not regular -- the IMU
 * uses `INS_ACC_ID` then `INS_ACC2_ID`, the compass `COMPASS_DEV_ID` then
 * `COMPASS_DEV_ID2`, and the barometer `BARO1_DEVID` from the start -- and a
 * pattern loose enough to catch all three would catch other things too.
 * Slots the vehicle does not have simply have no parameter, and are left out
 * rather than shown empty.
 */
export const DEVICE_SLOTS: DeviceSlot[] = [
  { param: 'INS_ACC_ID', label: 'Accel 1', cls: 'imu' },
  { param: 'INS_ACC2_ID', label: 'Accel 2', cls: 'imu' },
  { param: 'INS_ACC3_ID', label: 'Accel 3', cls: 'imu' },
  { param: 'INS_ACC4_ID', label: 'Accel 4', cls: 'imu' },
  { param: 'INS_ACC5_ID', label: 'Accel 5', cls: 'imu' },
  { param: 'INS_GYR_ID', label: 'Gyro 1', cls: 'imu' },
  { param: 'INS_GYR2_ID', label: 'Gyro 2', cls: 'imu' },
  { param: 'INS_GYR3_ID', label: 'Gyro 3', cls: 'imu' },
  { param: 'INS_GYR4_ID', label: 'Gyro 4', cls: 'imu' },
  { param: 'INS_GYR5_ID', label: 'Gyro 5', cls: 'imu' },
  { param: 'COMPASS_DEV_ID', label: 'Compass 1', cls: 'compass' },
  { param: 'COMPASS_DEV_ID2', label: 'Compass 2', cls: 'compass' },
  { param: 'COMPASS_DEV_ID3', label: 'Compass 3', cls: 'compass' },
  { param: 'COMPASS_DEV_ID4', label: 'Compass 4', cls: 'compass' },
  { param: 'COMPASS_DEV_ID5', label: 'Compass 5', cls: 'compass' },
  { param: 'COMPASS_DEV_ID6', label: 'Compass 6', cls: 'compass' },
  { param: 'COMPASS_DEV_ID7', label: 'Compass 7', cls: 'compass' },
  { param: 'COMPASS_DEV_ID8', label: 'Compass 8', cls: 'compass' },
  { param: 'BARO1_DEVID', label: 'Baro 1', cls: 'baro' },
  { param: 'BARO2_DEVID', label: 'Baro 2', cls: 'baro' },
  { param: 'BARO3_DEVID', label: 'Baro 3', cls: 'baro' },
]
