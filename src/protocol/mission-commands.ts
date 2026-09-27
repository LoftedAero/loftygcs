// What each mission command means, as data.
//
// Every mission item carries the same seven anonymous numbers: param1 is a
// hold time in a waypoint, a turn count in a loiter and a servo number in
// DO_SET_SERVO. This catalog labels them, and it is the one place a command
// is added; the table, the item editor and the palette all read it.
//
// Semantics follow ArduPilot's mission command reference where it differs
// from the generic MAVLink spec.

import type { VehicleClass } from './modes'

export interface MissionParamSpec {
  /** Which of param1..param4 this describes. */
  index: 1 | 2 | 3 | 4
  label: string
  unit?: string
  /** Only whole numbers make sense (indices, counts, relay numbers). */
  integer?: boolean
  min?: number
  max?: number
  /** Fixed choices, when the parameter is really an enumeration. */
  options?: { value: number; label: string }[]
}

export interface MissionCommandSpec {
  id: number
  /** What we call it in the UI. */
  name: string
  /** The MAVLink name, shown alongside so it can be matched to the docs. */
  mavName: string
  /**
   * nav commands move the vehicle and take time; do and condition commands
   * run between them. ArduPilot executes one nav command at a time.
   */
  category: 'nav' | 'condition' | 'do'
  /**
   * Copter (and heli) only; ArduPlane and Rover refuse these on upload.
   * `mission-commands.integration.test.ts` reads this field too.
   */
  copterOnly?: true
  /** Uses x/y as a position on the map. */
  location: boolean
  /** Uses z as an altitude. */
  altitude: boolean
  params: MissionParamSpec[]
  summary: string
}

const YAW: MissionParamSpec = { index: 4, label: 'Yaw', unit: '°', min: -360, max: 360 }

export const MISSION_COMMANDS: readonly MissionCommandSpec[] = [
  {
    id: 16,
    name: 'Waypoint',
    mavName: 'NAV_WAYPOINT',
    category: 'nav',
    location: true,
    altitude: true,
    params: [
      { index: 1, label: 'Hold', unit: 's', min: 0 },
      { index: 2, label: 'Accept radius', unit: 'm', min: 0 },
      { index: 3, label: 'Pass radius', unit: 'm' },
      YAW,
    ],
    summary: 'Fly to a point, then continue.',
  },
  {
    id: 22,
    name: 'Takeoff',
    mavName: 'NAV_TAKEOFF',
    category: 'nav',
    // ArduCopter ignores the takeoff position and climbs where it stands;
    // altitude is the only field that matters, so the map does not place it.
    location: false,
    altitude: true,
    params: [{ index: 1, label: 'Pitch', unit: '°', min: 0 }, YAW],
    summary: 'Climb to altitude. Must be the first item of a mission that flies.',
  },
  {
    id: 21,
    name: 'Land',
    mavName: 'NAV_LAND',
    category: 'nav',
    location: true,
    altitude: false,
    params: [{ index: 1, label: 'Abort alt', unit: 'm' }, YAW],
    summary: 'Descend and land. A zero position lands where the vehicle is.',
  },
  {
    id: 20,
    name: 'Return to launch',
    mavName: 'NAV_RETURN_TO_LAUNCH',
    category: 'nav',
    location: false,
    altitude: false,
    params: [],
    summary: 'Fly home and land, per the RTL parameters.',
  },
  {
    id: 17,
    name: 'Loiter (forever)',
    mavName: 'NAV_LOITER_UNLIM',
    category: 'nav',
    location: true,
    altitude: true,
    params: [{ index: 3, label: 'Radius', unit: 'm' }, YAW],
    summary: 'Circle here until the mode is changed. Ends the mission.',
  },
  {
    id: 19,
    name: 'Loiter (time)',
    mavName: 'NAV_LOITER_TIME',
    category: 'nav',
    location: true,
    altitude: true,
    params: [
      { index: 1, label: 'Time', unit: 's', min: 0 },
      { index: 3, label: 'Radius', unit: 'm' },
      { index: 4, label: 'Cross-track', integer: true },
    ],
    summary: 'Circle here for a set time, then continue.',
  },
  {
    id: 18,
    name: 'Loiter (turns)',
    mavName: 'NAV_LOITER_TURNS',
    category: 'nav',
    location: true,
    altitude: true,
    params: [
      { index: 1, label: 'Turns', min: 0 },
      { index: 3, label: 'Radius', unit: 'm' },
      { index: 4, label: 'Cross-track', integer: true },
    ],
    summary: 'Circle here a number of times, then continue.',
  },
  {
    id: 31,
    name: 'Loiter to altitude',
    mavName: 'NAV_LOITER_TO_ALT',
    category: 'nav',
    location: true,
    altitude: true,
    params: [
      { index: 1, label: 'Heading required', integer: true },
      { index: 2, label: 'Radius', unit: 'm' },
      { index: 4, label: 'Cross-track', integer: true },
    ],
    summary: 'Circle until the altitude is reached, then continue.',
  },
  {
    id: 82,
    name: 'Spline waypoint',
    mavName: 'NAV_SPLINE_WAYPOINT',
    category: 'nav',
    copterOnly: true,
    location: true,
    altitude: true,
    params: [{ index: 1, label: 'Hold', unit: 's', min: 0 }],
    summary: 'Fly a curve through this point rather than a straight leg.',
  },
  {
    id: 189,
    name: 'Land start marker',
    mavName: 'DO_LAND_START',
    category: 'do',
    location: false,
    altitude: false,
    params: [],
    summary: 'Marks where the landing sequence begins, for RTL to jump to.',
  },
  {
    id: 201,
    name: 'Region of interest',
    mavName: 'DO_SET_ROI',
    category: 'do',
    location: true,
    altitude: true,
    params: [],
    summary: 'Point the camera (and optionally the nose) at this spot.',
  },
  {
    id: 177,
    name: 'Jump',
    mavName: 'DO_JUMP',
    category: 'do',
    location: false,
    altitude: false,
    params: [
      { index: 1, label: 'To item', integer: true, min: 1 },
      { index: 2, label: 'Repeat', integer: true, min: -1 },
    ],
    summary: 'Go back to an earlier item. Repeat -1 means forever.',
  },
  {
    id: 178,
    name: 'Change speed',
    mavName: 'DO_CHANGE_SPEED',
    category: 'do',
    location: false,
    altitude: false,
    params: [
      {
        index: 1,
        label: 'Type',
        integer: true,
        options: [
          { value: 0, label: 'Airspeed' },
          { value: 1, label: 'Groundspeed' },
        ],
      },
      { index: 2, label: 'Speed', unit: 'm/s', min: -1 },
      { index: 3, label: 'Throttle', unit: '%', min: -1 },
    ],
    summary: 'Change the speed for the rest of the mission.',
  },
  {
    id: 112,
    name: 'Delay',
    mavName: 'CONDITION_DELAY',
    category: 'condition',
    location: false,
    altitude: false,
    params: [{ index: 1, label: 'Time', unit: 's', min: 0 }],
    summary: 'Wait before running the next do command.',
  },
  {
    id: 115,
    name: 'Set yaw',
    mavName: 'CONDITION_YAW',
    category: 'condition',
    location: false,
    altitude: false,
    params: [
      { index: 1, label: 'Angle', unit: '°', min: 0, max: 360 },
      { index: 2, label: 'Rate', unit: '°/s', min: 0 },
      {
        index: 3,
        label: 'Direction',
        integer: true,
        options: [
          { value: 1, label: 'Clockwise' },
          { value: -1, label: 'Counter-clockwise' },
        ],
      },
      {
        index: 4,
        label: 'Relative',
        integer: true,
        options: [
          { value: 0, label: 'Absolute' },
          { value: 1, label: 'Relative' },
        ],
      },
    ],
    summary: 'Turn to a heading.',
  },
  {
    id: 206,
    name: 'Camera trigger distance',
    mavName: 'DO_SET_CAM_TRIGG_DIST',
    category: 'do',
    location: false,
    altitude: false,
    params: [{ index: 1, label: 'Distance', unit: 'm', min: 0 }],
    summary: 'Take a photo every so many meters. Zero switches it off.',
  },
  {
    id: 183,
    name: 'Set servo',
    mavName: 'DO_SET_SERVO',
    category: 'do',
    location: false,
    altitude: false,
    params: [
      { index: 1, label: 'Servo', integer: true, min: 1, max: 16 },
      { index: 2, label: 'PWM', unit: 'µs', integer: true, min: 800, max: 2200 },
    ],
    summary: 'Drive a servo output to a value.',
  },
  {
    id: 181,
    name: 'Set relay',
    mavName: 'DO_SET_RELAY',
    category: 'do',
    location: false,
    altitude: false,
    params: [
      { index: 1, label: 'Relay', integer: true, min: 0, max: 5 },
      {
        index: 2,
        label: 'State',
        integer: true,
        options: [
          { value: 0, label: 'Off' },
          { value: 1, label: 'On' },
        ],
      },
    ],
    summary: 'Switch a relay output.',
  },
  {
    id: 208,
    name: 'Parachute',
    mavName: 'DO_PARACHUTE',
    category: 'do',
    location: false,
    altitude: false,
    params: [
      {
        index: 1,
        label: 'Action',
        integer: true,
        options: [
          { value: 0, label: 'Disable' },
          { value: 1, label: 'Enable' },
          { value: 2, label: 'Release' },
        ],
      },
    ],
    summary: 'Arm, disarm or fire the parachute.',
  },
  {
    id: 211,
    name: 'Gripper',
    mavName: 'DO_GRIPPER',
    category: 'do',
    location: false,
    altitude: false,
    params: [
      { index: 1, label: 'Gripper', integer: true, min: 1 },
      {
        index: 2,
        label: 'Action',
        integer: true,
        options: [
          { value: 0, label: 'Release' },
          { value: 1, label: 'Grab' },
        ],
      },
    ],
    summary: 'Open or close a gripper.',
  },
  {
    id: 30,
    name: 'Continue and change altitude',
    mavName: 'NAV_CONTINUE_AND_CHANGE_ALT',
    category: 'nav',
    location: false,
    altitude: true,
    params: [
      {
        index: 1,
        label: 'Direction',
        integer: true,
        options: [
          { value: 0, label: 'Either' },
          { value: 1, label: 'Climb' },
          { value: 2, label: 'Descend' },
        ],
      },
    ],
    summary: 'Hold the current heading until the altitude is reached.',
  },
  {
    id: 84,
    name: 'VTOL takeoff',
    mavName: 'NAV_VTOL_TAKEOFF',
    category: 'nav',
    location: true,
    altitude: true,
    params: [{ index: 2, label: 'Transition heading', unit: '°' }, YAW],
    summary: 'Take off vertically, then transition to forward flight.',
  },
  {
    id: 85,
    name: 'VTOL land',
    mavName: 'NAV_VTOL_LAND',
    category: 'nav',
    location: true,
    altitude: true,
    params: [
      {
        index: 1,
        label: 'Options',
        integer: true,
        options: [
          { value: 0, label: 'Default' },
          { value: 1, label: 'Hover descent' },
          { value: 2, label: 'Approach only' },
        ],
      },
      { index: 3, label: 'Approach alt', unit: 'm' },
      YAW,
    ],
    summary: 'Transition to hover and land vertically.',
  },
  {
    id: 92,
    name: 'Hand over to companion',
    mavName: 'NAV_GUIDED_ENABLE',
    category: 'nav',
    location: false,
    altitude: false,
    params: [
      {
        index: 1,
        label: 'Enable',
        integer: true,
        options: [
          { value: 0, label: 'Off' },
          { value: 1, label: 'On' },
        ],
      },
    ],
    summary: 'Let an offboard computer steer until it hands control back.',
  },
  {
    id: 93,
    name: 'Delay',
    mavName: 'NAV_DELAY',
    category: 'nav',
    location: false,
    altitude: false,
    params: [
      { index: 1, label: 'Delay', unit: 's', min: -1 },
      { index: 2, label: 'Hour', integer: true, min: -1, max: 23 },
      { index: 3, label: 'Minute', integer: true, min: -1, max: 59 },
      { index: 4, label: 'Second', integer: true, min: -1, max: 59 },
    ],
    summary: 'Wait here for a number of seconds, or until a time of day.',
  },
  {
    id: 94,
    name: 'Place payload',
    mavName: 'NAV_PAYLOAD_PLACE',
    category: 'nav',
    copterOnly: true,
    location: true,
    altitude: true,
    params: [{ index: 1, label: 'Max descent', unit: 'm', min: 0 }],
    summary: 'Descend until the payload touches down, release, and climb.',
  },
  {
    id: 114,
    name: 'Wait for distance',
    mavName: 'CONDITION_DISTANCE',
    category: 'condition',
    location: false,
    altitude: false,
    params: [{ index: 1, label: 'Distance', unit: 'm', min: 0 }],
    summary: 'Hold the next do command until this close to the next waypoint.',
  },
  {
    id: 179,
    name: 'Set home',
    mavName: 'DO_SET_HOME',
    category: 'do',
    location: true,
    altitude: true,
    params: [
      {
        index: 1,
        label: 'Use',
        integer: true,
        options: [
          { value: 0, label: 'This location' },
          { value: 1, label: 'Current position' },
        ],
      },
    ],
    summary: 'Move home, which is where RTL returns to.',
  },
  {
    id: 182,
    name: 'Cycle relay',
    mavName: 'DO_REPEAT_RELAY',
    category: 'do',
    location: false,
    altitude: false,
    params: [
      { index: 1, label: 'Relay', integer: true, min: 0 },
      { index: 2, label: 'Count', integer: true, min: 1 },
      { index: 3, label: 'Cycle time', unit: 's', min: 0 },
    ],
    summary: 'Switch a relay on and off a number of times.',
  },
  {
    id: 184,
    name: 'Cycle servo',
    mavName: 'DO_REPEAT_SERVO',
    category: 'do',
    location: false,
    altitude: false,
    params: [
      { index: 1, label: 'Servo', integer: true, min: 1 },
      { index: 2, label: 'PWM', unit: 'µs', integer: true, min: 800, max: 2200 },
      { index: 3, label: 'Count', integer: true, min: 1 },
      { index: 4, label: 'Cycle time', unit: 's', min: 0 },
    ],
    summary: 'Move a servo to a value and back, a number of times.',
  },
  {
    id: 188,
    name: 'Return path start',
    mavName: 'DO_RETURN_PATH_START',
    category: 'do',
    location: false,
    altitude: false,
    params: [],
    summary: 'Marks where a return to launch rejoins the mission.',
  },
  {
    id: 191,
    name: 'Go around',
    mavName: 'DO_GO_AROUND',
    category: 'do',
    location: false,
    altitude: false,
    params: [{ index: 1, label: 'Altitude', unit: 'm' }],
    summary: 'Abort a landing and climb away.',
  },
  {
    id: 193,
    name: 'Pause or continue',
    mavName: 'DO_PAUSE_CONTINUE',
    category: 'do',
    location: false,
    altitude: false,
    params: [
      {
        index: 1,
        label: 'Action',
        integer: true,
        options: [
          { value: 0, label: 'Pause' },
          { value: 1, label: 'Continue' },
        ],
      },
    ],
    summary: 'Hold position, or carry on from a hold.',
  },
  {
    id: 194,
    name: 'Set reverse',
    mavName: 'DO_SET_REVERSE',
    category: 'do',
    location: false,
    altitude: false,
    params: [
      {
        index: 1,
        label: 'Direction',
        integer: true,
        options: [
          { value: 0, label: 'Forward' },
          { value: 1, label: 'Reverse' },
        ],
      },
    ],
    summary: 'Drive forward or in reverse.',
  },
  {
    id: 195,
    name: 'ROI at location',
    mavName: 'DO_SET_ROI_LOCATION',
    category: 'do',
    location: true,
    altitude: true,
    params: [{ index: 1, label: 'Gimbal', integer: true, min: 0 }],
    summary: 'Point the camera at a place and keep it there.',
  },
  {
    id: 197,
    name: 'Clear ROI',
    mavName: 'DO_SET_ROI_NONE',
    category: 'do',
    location: false,
    altitude: false,
    params: [{ index: 1, label: 'Gimbal', integer: true, min: 0 }],
    summary: 'Stop pointing the camera at anything in particular.',
  },
  {
    id: 203,
    name: 'Camera trigger',
    mavName: 'DO_DIGICAM_CONTROL',
    category: 'do',
    location: false,
    altitude: false,
    params: [
      {
        index: 1,
        label: 'Session',
        integer: true,
        options: [
          { value: 0, label: 'Off' },
          { value: 1, label: 'On' },
        ],
      },
    ],
    summary: "Fire the shutter through ArduPilot's own camera trigger.",
  },
  {
    id: 205,
    name: 'Point the mount',
    mavName: 'DO_MOUNT_CONTROL',
    category: 'do',
    location: false,
    altitude: false,
    params: [
      { index: 1, label: 'Pitch', unit: '°', min: -180, max: 180 },
      { index: 2, label: 'Roll', unit: '°', min: -180, max: 180 },
      { index: 3, label: 'Yaw', unit: '°', min: -180, max: 180 },
    ],
    summary: 'Aim a camera mount at fixed angles.',
  },
  {
    id: 207,
    name: 'Fence',
    mavName: 'DO_FENCE_ENABLE',
    category: 'do',
    location: false,
    altitude: false,
    params: [
      {
        index: 1,
        label: 'Fence',
        integer: true,
        options: [
          { value: 0, label: 'Disable' },
          { value: 1, label: 'Enable' },
          { value: 2, label: 'Disable floor only' },
        ],
      },
    ],
    summary: 'Turn the geofence on or off mid-mission.',
  },
  {
    id: 210,
    name: 'Inverted flight',
    mavName: 'DO_INVERTED_FLIGHT',
    category: 'do',
    location: false,
    altitude: false,
    params: [
      {
        index: 1,
        label: 'Inverted',
        integer: true,
        options: [
          { value: 0, label: 'Normal' },
          { value: 1, label: 'Inverted' },
        ],
      },
    ],
    summary: 'Fly the wing upside down, on airframes set up for it.',
  },
  {
    id: 212,
    name: 'Autotune',
    mavName: 'DO_AUTOTUNE_ENABLE',
    category: 'do',
    location: false,
    altitude: false,
    params: [
      {
        index: 1,
        label: 'Autotune',
        integer: true,
        options: [
          { value: 0, label: 'Disable' },
          { value: 1, label: 'Enable' },
        ],
      },
    ],
    summary: 'Start or stop tuning the controller in flight.',
  },
  {
    id: 218,
    name: 'Auxiliary function',
    mavName: 'DO_AUX_FUNCTION',
    category: 'do',
    location: false,
    altitude: false,
    params: [
      { index: 1, label: 'Function', integer: true, min: 0 },
      {
        index: 2,
        label: 'Switch',
        integer: true,
        options: [
          { value: 0, label: 'Low' },
          { value: 1, label: 'Middle' },
          { value: 2, label: 'High' },
        ],
      },
    ],
    summary: 'Trigger an RCn_OPTION function as if a switch had moved.',
  },
  {
    id: 223,
    name: 'Engine control',
    mavName: 'DO_ENGINE_CONTROL',
    category: 'do',
    location: false,
    altitude: false,
    params: [
      {
        index: 1,
        label: 'Engine',
        integer: true,
        options: [
          { value: 0, label: 'Stop' },
          { value: 1, label: 'Start' },
        ],
      },
      {
        index: 2,
        label: 'Cold start',
        integer: true,
        options: [
          { value: 0, label: 'No' },
          { value: 1, label: 'Yes' },
        ],
      },
      { index: 3, label: 'Height delay', unit: 'm', min: 0 },
    ],
    summary: 'Start or stop an internal combustion engine.',
  },
]

const BY_ID = new Map(MISSION_COMMANDS.map((c) => [c.id, c]))

/**
 * The commands to offer for one kind of aircraft, verified against the
 * firmware by `mission-commands.integration.test.ts`. `other` (an
 * unrecognized MAV_TYPE) gets everything, since unknown is not absent.
 */
export function commandsFor(cls: VehicleClass): readonly MissionCommandSpec[] {
  if (cls === 'copter' || cls === 'other') return MISSION_COMMANDS
  return MISSION_COMMANDS.filter((c) => !c.copterOnly)
}

export function commandSpec(id: number): MissionCommandSpec | undefined {
  return BY_ID.get(id)
}

/**
 * A name for any command, catalogued or not. A downloaded mission can hold
 * commands this build does not know; those show their number.
 */
export function commandLabel(id: number): string {
  return BY_ID.get(id)?.name ?? `Command ${id}`
}

/** Does this command place a marker on the map? */
export function hasLocation(id: number): boolean {
  return BY_ID.get(id)?.location ?? false
}

/**
 * Whether `frame` is meaningful for a command. ArduPilot reports frame 0 on
 * read-back for commands without coordinates, whatever was uploaded, so
 * comparing their frames would make an unchanged mission look modified.
 */
export function frameMatters(id: number): boolean {
  const spec = BY_ID.get(id)
  return spec ? spec.location || spec.altitude : true
}

/** The palette's headline choices; everything else is "Other…". */
export const PALETTE_COMMANDS = [22, 16, 201, 21, 20] as const

export const MAV_FRAMES = [
  { value: 3, label: 'Relative to home', short: 'Rel' },
  { value: 0, label: 'Above mean sea level', short: 'AMSL' },
  { value: 10, label: 'Above terrain', short: 'Terrain' },
] as const

export function frameLabel(frame: number): string {
  return MAV_FRAMES.find((f) => f.value === frame)?.short ?? `Frame ${frame}`
}
