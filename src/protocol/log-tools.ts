// Which of ArduPilot's WebTools can do anything with this log?
//
// The tools live at firmware.ardupilot.org and run in the browser: you open
// one and drop a .bin into it. There is no upload API to hand the log
// across, so the app's job is to open the right page and to say up front
// whether the log has what the tool needs -- FilterReview against a log
// with no raw IMU data is a blank screen and ten minutes of wondering why,
// and the answer was knowable before leaving.
//
// The requirements here are the tools' own: FilterReview reads batch
// sampler records (ISBH/ISBD, from INS_LOG_BAT_MASK) or raw gyro records;
// PID Review reads the rate-controller PID records; MAGFit fits compass
// readings against the world magnetic model, which takes both MAG and a
// position. Hardware Report reads the parameters and boot messages every
// log has.

import type { ParsedLog } from './dataflash'

export interface WebToolLink {
  id: 'hardware' | 'magfit' | 'filter' | 'pid'
  name: string
  url: string
  /** What the tool answers, one line, for the button's tooltip. */
  purpose: string
  /** Null when the log has what the tool needs; otherwise what is missing. */
  missing: string | null
}

const BASE = 'https://firmware.ardupilot.org/Tools/WebTools/'

export function webToolsFor(log: ParsedLog): WebToolLink[] {
  const has = (...names: string[]) => names.some((n) => log.messages.has(n))
  const position = has('GPS', 'POS', 'AHR2')

  return [
    {
      id: 'hardware',
      name: 'Hardware Report',
      url: BASE + 'HardwareReport/',
      purpose: 'Board, sensors, and configuration summary from any log',
      missing: null,
    },
    {
      id: 'magfit',
      name: 'MAGFit',
      url: BASE + 'MAGFit/',
      purpose: 'Fit compass calibration and motor interference from flight data',
      missing: !has('MAG')
        ? 'This log has no compass (MAG) records.'
        : !position
          ? 'This log has no position records, and MAGFit fits against the world magnetic model.'
          : null,
    },
    {
      id: 'filter',
      name: 'Filter Review',
      url: BASE + 'FilterReview/',
      purpose: 'Gyro noise and notch filter analysis',
      missing: has('ISBH', 'ISBD', 'GYR')
        ? null
        : 'This log has no raw IMU data — set INS_LOG_BAT_MASK (batch logging) and fly again.',
    },
    {
      id: 'pid',
      name: 'PID Review',
      url: BASE + 'PIDReview/',
      purpose: 'Rate controller tracking and tuning analysis',
      missing: has('PIDR', 'PIDP', 'PIDY')
        ? null
        : 'This log has no PID records — enable PID logging in LOG_BITMASK and fly again.',
    },
  ]
}
