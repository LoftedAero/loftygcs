// The ArduPilot OSD panel catalog: one entry per OSD{screen}_{ITEM}_{EN,X,Y}
// triplet the firmware exposes. The editor drops anything the connected
// firmware lacks.
//
// `sample` sets a panel's width, which is what shows collisions. Uppercase
// because the MAX7456 character set is.
//
// Extents are approximate for the drawn-graphic panels (horizon, sidebars,
// compass rose): ArduPilot does not publish their footprints, and they vary
// with video standard.

export type OsdGroup = 'flight' | 'navigation' | 'power' | 'radio' | 'system'

export interface OsdItem {
  /** Parameter stem: OSD1_<id>_EN / _X / _Y. */
  id: string
  label: string
  /** Representative on-screen text, sized as the firmware would draw it. */
  sample: string
  group: OsdGroup
  /**
   * Cell footprint. Defaults to the sample's length by one row; set
   * explicitly for panels that draw a graphic rather than a string.
   */
  width?: number
  height?: number
  /**
   * Panels ArduPilot implements only for MSP OSDs: the parameters exist on
   * every build but draw nothing on an analog MAX7456.
   */
  mspOnly?: boolean
}

export const OSD_ITEMS: OsdItem[] = [
  // Flight
  { id: 'ALTITUDE', label: 'Altitude (AGL)', sample: '123M', group: 'flight' },
  { id: 'HORIZON', label: 'Artificial horizon', sample: '', group: 'flight', width: 17, height: 7 },
  { id: 'SIDEBARS', label: 'Horizon sidebars', sample: '', group: 'flight', width: 23, height: 7 },
  {
    id: 'CRSSHAIR',
    label: 'Crosshair',
    sample: '',
    group: 'flight',
    width: 3,
    height: 1,
    mspOnly: true,
  },
  { id: 'ROLL', label: 'Roll angle', sample: '-12', group: 'flight' },
  { id: 'PITCH', label: 'Pitch angle', sample: '  4', group: 'flight' },
  { id: 'ASPEED', label: 'Airspeed (fused)', sample: '18M/S', group: 'flight' },
  { id: 'ASPD1', label: 'Airspeed sensor 1', sample: '18M/S', group: 'flight' },
  { id: 'ASPD2', label: 'Airspeed sensor 2', sample: '18M/S', group: 'flight' },
  { id: 'GSPEED', label: 'Ground speed', sample: '23M/S', group: 'flight' },
  { id: 'VSPEED', label: 'Climb rate', sample: '  1.5', group: 'flight' },
  { id: 'THROTTLE', label: 'Throttle', sample: ' 75%', group: 'flight' },
  { id: 'FLTMODE', label: 'Flight mode', sample: 'STAB', group: 'flight' },
  { id: 'ARMING', label: 'Arming status', sample: 'ARMED', group: 'flight', mspOnly: true },
  { id: 'FLTIME', label: 'Flight time', sample: '04:12', group: 'flight' },
  { id: 'STATS', label: 'Flight statistics', sample: '', group: 'flight', width: 14, height: 6 },
  { id: 'RPM', label: 'Rotor RPM', sample: '2450', group: 'flight' },

  // Navigation
  { id: 'HEADING', label: 'Heading', sample: '125', group: 'navigation' },
  { id: 'COMPASS', label: 'Compass rose', sample: '', group: 'navigation', width: 13, height: 1 },
  { id: 'HOME', label: 'Home distance + direction', sample: '  245M', group: 'navigation' },
  { id: 'HOMEDIST', label: 'Home distance', sample: '  245M', group: 'navigation', mspOnly: true },
  {
    id: 'HOMEDIR',
    label: 'Home direction',
    sample: '  ',
    group: 'navigation',
    width: 2,
    mspOnly: true,
  },
  { id: 'WAYPOINT', label: 'Next waypoint', sample: '  120M', group: 'navigation' },
  { id: 'XTRACK', label: 'Crosstrack error', sample: '  2M', group: 'navigation' },
  { id: 'DIST', label: 'Distance flown', sample: ' 1.2KM', group: 'navigation' },
  { id: 'GPSLAT', label: 'GPS latitude', sample: ' 42.3601000', group: 'navigation' },
  { id: 'GPSLONG', label: 'GPS longitude', sample: '-71.0589000', group: 'navigation' },
  { id: 'SATS', label: 'Satellite count', sample: '12', group: 'navigation' },
  { id: 'HDOP', label: 'HDOP', sample: 'H1.2', group: 'navigation' },
  { id: 'PLUSCODE', label: 'Plus code', sample: '87J9PC4V+2X', group: 'navigation' },
  { id: 'WIND', label: 'Wind', sample: '  4M/S', group: 'navigation' },
  { id: 'TER_HGT', label: 'Height above terrain', sample: ' 118M', group: 'navigation' },
  { id: 'RNGF', label: 'Rangefinder', sample: ' 1.4M', group: 'navigation' },
  { id: 'FENCE', label: 'Fence status', sample: 'FEN', group: 'navigation' },

  // Power
  { id: 'BAT_VOLT', label: 'Battery voltage', sample: '12.3V', group: 'power' },
  { id: 'BAT2_VLT', label: 'Battery 2 voltage', sample: '12.3V', group: 'power' },
  { id: 'RESTVOLT', label: 'Resting voltage', sample: '12.6V', group: 'power' },
  { id: 'AVGCELLV', label: 'Average cell voltage', sample: '4.11V', group: 'power' },
  { id: 'ACRVOLT', label: 'Average cell resting voltage', sample: '4.15V', group: 'power' },
  { id: 'CELLVOLT', label: 'Cell voltage', sample: '4.11V', group: 'power', mspOnly: true },
  { id: 'CURRENT', label: 'Current', sample: '14.2A', group: 'power' },
  { id: 'CURRENT2', label: 'Current 2', sample: '14.2A', group: 'power' },
  { id: 'POWER', label: 'Power', sample: ' 175W', group: 'power', mspOnly: true },
  { id: 'BATUSED', label: 'Battery used', sample: '1234MAH', group: 'power' },
  { id: 'BAT2USED', label: 'Battery 2 used', sample: '1234MAH', group: 'power' },
  {
    id: 'BATTBAR',
    label: 'Battery bar',
    sample: '',
    group: 'power',
    width: 10,
    height: 1,
    mspOnly: true,
  },
  { id: 'EFF', label: 'Efficiency', sample: ' 82MAH/KM', group: 'power' },
  { id: 'CLIMBEFF', label: 'Climb efficiency', sample: ' 2.4M/AH', group: 'power' },
  { id: 'ESCRPM', label: 'ESC RPM', sample: '12300', group: 'power' },
  { id: 'ESCAMPS', label: 'ESC current', sample: '14.2A', group: 'power' },
  { id: 'ESCTEMP', label: 'ESC temperature', sample: ' 42C', group: 'power' },

  // Radio link
  { id: 'RSSI', label: 'RSSI', sample: ' 95', group: 'radio' },
  { id: 'RSSIDBM', label: 'RSSI (dBm)', sample: '-72DBM', group: 'radio' },
  { id: 'LINK_Q', label: 'Link quality', sample: ' 99', group: 'radio' },
  { id: 'RC_LQ', label: 'RC link quality', sample: '99LQ', group: 'radio' },
  { id: 'RC_SNR', label: 'RC signal-to-noise', sample: ' 12DB', group: 'radio' },
  { id: 'RC_PWR', label: 'RC transmit power', sample: ' 250MW', group: 'radio' },
  { id: 'RC_ANT', label: 'RC active antenna', sample: 'A1', group: 'radio' },
  { id: 'VTX_PWR', label: 'VTX power', sample: ' 25MW', group: 'radio' },

  // System
  { id: 'MESSAGE', label: 'Status messages', sample: 'EKF3 IMU0 IS USING GPS', group: 'system' },
  { id: 'CLK', label: 'Clock', sample: '14:32', group: 'system' },
  { id: 'CALLSIGN', label: 'Callsign', sample: 'N123AB', group: 'system' },
  { id: 'TEMP', label: 'Barometer temperature', sample: ' 24C', group: 'system' },
  { id: 'BTEMP', label: 'Barometer 2 temperature', sample: ' 24C', group: 'system' },
  { id: 'ATEMP', label: 'Airspeed temperature', sample: ' 24C', group: 'system' },
]

export const OSD_GROUP_LABELS: Record<OsdGroup, string> = {
  flight: 'Flight',
  navigation: 'Navigation',
  power: 'Power',
  radio: 'Radio link',
  system: 'System',
}

/** Cells a panel occupies, falling back to the width of its sample text. */
export function itemExtent(item: OsdItem): { width: number; height: number } {
  return {
    width: item.width ?? Math.max(1, item.sample.length),
    height: item.height ?? 1,
  }
}
