// Accelerometer calibration: the vehicle runs it, we relay.
//
// ArduPilot's onboard accel calibration decides which orientation it wants
// next and says so over STATUSTEXT ("Place vehicle on its LEFT side and
// press any key."). The GCS reads that prompt and answers with
// MAV_CMD_ACCELCAL_VEHICLE_POS carrying the matching position. Following
// the vehicle rather than assuming a fixed client-side order is what makes
// the flow robust: if firmware changes the sequence, retries a side, or
// skips one, the UI still tracks it.

/** MAV_CMD_ACCELCAL_VEHICLE_POS values. */
export const ACCEL_POS = {
  LEVEL: 1,
  LEFT: 2,
  RIGHT: 3,
  NOSEDOWN: 4,
  NOSEUP: 5,
  BACK: 6,
  SUCCESS: 16777215,
  FAILED: 16777216,
} as const

export type AccelPositionId = 'LEVEL' | 'LEFT' | 'RIGHT' | 'NOSEDOWN' | 'NOSEUP' | 'BACK'

export interface AccelPosition {
  id: AccelPositionId
  /** The value to send in MAV_CMD_ACCELCAL_VEHICLE_POS. */
  value: number
  /** Short label for the progress rail. */
  label: string
  /** What to actually do with the airframe. */
  instruction: string
}

/** The six sides, in the order ArduPilot normally asks for them. */
export const ACCEL_POSITIONS: AccelPosition[] = [
  {
    id: 'LEVEL',
    value: ACCEL_POS.LEVEL,
    label: 'Level',
    instruction: 'Set the vehicle down level, the way it sits on its feet.',
  },
  {
    id: 'LEFT',
    value: ACCEL_POS.LEFT,
    label: 'Left side',
    instruction: 'Roll the vehicle onto its LEFT side.',
  },
  {
    id: 'RIGHT',
    value: ACCEL_POS.RIGHT,
    label: 'Right side',
    instruction: 'Roll the vehicle onto its RIGHT side.',
  },
  {
    id: 'NOSEDOWN',
    value: ACCEL_POS.NOSEDOWN,
    label: 'Nose down',
    instruction: 'Stand the vehicle on its nose.',
  },
  {
    id: 'NOSEUP',
    value: ACCEL_POS.NOSEUP,
    label: 'Nose up',
    instruction: 'Stand the vehicle on its tail, nose pointing up.',
  },
  {
    id: 'BACK',
    value: ACCEL_POS.BACK,
    label: 'Back',
    instruction: 'Turn the vehicle upside down, resting on its back.',
  },
]

export function positionById(id: AccelPositionId): AccelPosition {
  return ACCEL_POSITIONS.find((p) => p.id === id)!
}

/**
 * Which orientation is this STATUSTEXT asking for? Null when the line is
 * not a position prompt. Matching is keyword-based rather than exact so
 * wording tweaks between firmware versions do not break the wizard.
 */
export function parseAccelPrompt(text: string): AccelPosition | null {
  const t = text.toLowerCase()
  if (!t.includes('place vehicle') && !t.includes('place the vehicle')) return null
  // Order matters: "nose down" must beat the bare "down", and "level"
  // is checked first because it is unambiguous.
  if (t.includes('level')) return positionById('LEVEL')
  if (t.includes('nose') && t.includes('down')) return positionById('NOSEDOWN')
  if (t.includes('nose') && t.includes('up')) return positionById('NOSEUP')
  if (t.includes('left')) return positionById('LEFT')
  if (t.includes('right')) return positionById('RIGHT')
  if (t.includes('back') || t.includes('upside')) return positionById('BACK')
  return null
}

export function isCalibrationSuccess(text: string): boolean {
  return /calibration successful/i.test(text)
}

export function isCalibrationFailure(text: string): boolean {
  return /calibration (failed|cancelled|canceled)/i.test(text)
}
