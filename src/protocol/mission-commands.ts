// What each mission command means, as data.
//
// MAVLink gives every mission item the same seven anonymous numbers, so a
// table of them is unreadable without knowing which command is in the row --
// param1 is a hold time in a waypoint, a turn count in a loiter, and a servo
// number in DO_SET_SERVO. This catalog is what turns those columns into
// labelled fields, and it is the single place a new command is added: the
// table, the item editor and the palette all read it.
//
// Semantics follow ArduPilot's mission command reference rather than the
// generic MAVLink spec where the two differ -- this is an ArduPilot station,
// and the firmware's interpretation is the one the aircraft flies.

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
   * run instantly between them. ArduPilot executes at most one nav command
   * at a time, which is why the distinction is worth showing.
   */
  category: 'nav' | 'condition' | 'do'
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
    id: 113,
    name: 'Change altitude',
    mavName: 'CONDITION_CHANGE_ALT',
    category: 'condition',
    location: false,
    altitude: true,
    params: [{ index: 1, label: 'Rate', unit: 'm/s' }],
    summary: 'Climb or descend to an altitude while continuing.',
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
    id: 212,
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
]

const BY_ID = new Map(MISSION_COMMANDS.map((c) => [c.id, c]))

export function commandSpec(id: number): MissionCommandSpec | undefined {
  return BY_ID.get(id)
}

/**
 * A name for any command, catalogued or not. A mission downloaded from a
 * vehicle can contain commands this build has never heard of, and showing
 * the number beats showing a blank row.
 */
export function commandLabel(id: number): string {
  return BY_ID.get(id)?.name ?? `Command ${id}`
}

/** Does this command place a marker on the map? */
export function hasLocation(id: number): boolean {
  return BY_ID.get(id)?.location ?? false
}

/**
 * Whether `frame` is meaningful for a command. ArduPilot stores commands
 * that carry no coordinates without a frame and reports 0 for them on
 * read-back, whatever was uploaded -- so comparing frames on those items
 * makes an unchanged mission look modified. Found against SITL, not guessed.
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
