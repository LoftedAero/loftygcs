// Labels for RCOU and RCIN channels from the log's own SERVOn_FUNCTION,
// RCn_OPTION and RCMAP_* parameters (its PARM records), as Mission Planner
// does. The log's parameters are used rather than a connected vehicle's,
// since they describe the configuration the flight was flown under.

/**
 * SERVOn_FUNCTION values, from ArduPilot's Aux_servo_function_t. Not
 * exhaustive; an unrecognized number is shown as itself.
 */
const SERVO_FUNCTIONS: Record<number, string> = {
  0: 'Disabled',
  1: 'RC pass-through',
  2: 'Flap',
  3: 'Flap auto',
  4: 'Aileron',
  6: 'Mount pan',
  7: 'Mount tilt',
  8: 'Mount roll',
  9: 'Mount open',
  10: 'Camera trigger',
  12: 'Mount2 pan',
  13: 'Mount2 tilt',
  14: 'Mount2 roll',
  15: 'Mount2 open',
  16: 'DS spoiler L1',
  17: 'DS spoiler R1',
  19: 'Elevator',
  21: 'Rudder',
  22: 'Sprayer pump',
  23: 'Sprayer spinner',
  24: 'Flaperon left',
  25: 'Flaperon right',
  26: 'Ground steering',
  27: 'Parachute',
  28: 'Gripper',
  29: 'Landing gear',
  30: 'Engine run enable',
  31: 'Heli RSC',
  32: 'Heli tail RSC',
  41: 'Motor tilt',
  70: 'Throttle',
  71: 'Tracker yaw',
  72: 'Tracker pitch',
  73: 'Throttle left',
  74: 'Throttle right',
  75: 'Tilt motor left',
  76: 'Tilt motor right',
  77: 'Elevon left',
  78: 'Elevon right',
  79: 'V-tail left',
  80: 'V-tail right',
  81: 'Boost throttle',
  86: 'DS spoiler L2',
  87: 'DS spoiler R2',
  88: 'Winch',
  89: 'Main sail',
  120: 'NeoPixel 1',
  121: 'NeoPixel 2',
  122: 'NeoPixel 3',
  123: 'NeoPixel 4',
}

/** RCn_OPTION values: what an auxiliary switch on that channel does. */
const RC_OPTIONS: Record<number, string> = {
  0: 'Do nothing',
  2: 'Flip',
  3: 'Simple mode',
  4: 'RTL',
  5: 'Save trim',
  7: 'Save waypoint',
  9: 'Camera trigger',
  10: 'Rangefinder',
  11: 'Fence',
  13: 'Super simple',
  14: 'Acro trainer',
  15: 'Sprayer',
  16: 'Auto',
  17: 'AutoTune',
  18: 'Land',
  19: 'Gripper',
  21: 'Parachute enable',
  22: 'Parachute release',
  23: 'Parachute 3-position',
  24: 'Mission reset',
  27: 'Retract mount',
  28: 'Relay 1',
  29: 'Landing gear',
  30: 'Lost vehicle alarm',
  31: 'Motor emergency stop',
  32: 'Motor interlock',
  33: 'Brake',
  34: 'Relay 2',
  37: 'Throw',
  38: 'ADSB avoidance',
  39: 'Precision loiter',
  41: 'ArmDisarm',
  42: 'SmartRTL',
  43: 'InvertedFlight',
  46: 'RC override enable',
  47: 'User function 1',
  55: 'Guided',
  56: 'Loiter',
  57: 'Follow',
  58: 'Clear waypoints',
  62: 'Compass learn',
  65: 'GPS disable',
  66: 'Relay 5',
  67: 'Relay 6',
  68: 'Stabilize',
  69: 'PosHold',
  70: 'AltHold',
  71: 'Circle',
  72: 'Drift',
  73: 'Sport',
  74: 'Flip mode',
  75: 'AutoTune mode',
  76: 'QSTABILIZE',
  78: 'RTL mode',
  81: 'Disarm',
  84: 'Airmode',
  85: 'Generator',
  90: 'EKF position source',
  100: 'KillIMU1',
  153: 'ArmDisarm (airmode)',
}

/** The four sticks, and the parameter that says which channel each is on. */
const RCMAP: [string, string][] = [
  ['RCMAP_ROLL', 'Roll'],
  ['RCMAP_PITCH', 'Pitch'],
  ['RCMAP_THROTTLE', 'Throttle'],
  ['RCMAP_YAW', 'Yaw'],
]

/** Motor functions are one contiguous run; spelling them out is noise. */
function motorName(fn: number): string | null {
  if (fn >= 33 && fn <= 40) return `Motor ${fn - 32}`
  if (fn >= 82 && fn <= 85) return `Motor ${fn - 73}`
  // 51..66 pass RC input n straight through to this output.
  if (fn >= 51 && fn <= 66) return `RC in ${fn - 50}`
  return null
}

export function servoFunctionName(fn: number): string {
  return motorName(fn) ?? SERVO_FUNCTIONS[fn] ?? `Function ${fn}`
}

export function rcOptionName(option: number): string {
  return RC_OPTIONS[option] ?? `Option ${option}`
}

/**
 * Channel labels for one message, keyed by field name ('C1', 'C2', ...).
 *
 * Empty when the log carries no parameters.
 */
export function channelLabels(
  params: Map<string, number>,
  message: 'RCOU' | 'RCIN',
): Map<string, string> {
  const out = new Map<string, string>()
  if (message === 'RCOU') {
    for (let ch = 1; ch <= 32; ch++) {
      const fn = params.get(`SERVO${ch}_FUNCTION`)
      // Disabled outputs stay unlabeled; the bare channel reads better.
      if (fn === undefined || fn === 0) continue
      out.set(`C${ch}`, servoFunctionName(fn))
    }
    return out
  }

  // RC input: the four sticks come from RCMAP, everything else from the
  // channel's own RCn_OPTION. A stick wins if a channel somehow has both.
  for (let ch = 1; ch <= 32; ch++) {
    const option = params.get(`RC${ch}_OPTION`)
    if (option !== undefined && option !== 0) out.set(`C${ch}`, rcOptionName(option))
  }
  const modeCh = params.get('FLTMODE_CH')
  if (modeCh !== undefined && modeCh > 0) out.set(`C${modeCh}`, 'Flight mode')
  for (const [param, label] of RCMAP) {
    const ch = params.get(param)
    if (ch !== undefined && ch > 0) out.set(`C${ch}`, label)
  }
  return out
}

/**
 * A display name for any field, or null if the bare name is already best.
 */
export function fieldLabel(
  params: Map<string, number>,
  message: string,
  field: string,
): string | null {
  if (message !== 'RCOU' && message !== 'RCIN') return null
  return channelLabels(params, message).get(field) ?? null
}
