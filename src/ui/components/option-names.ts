// Short names for ArduPilot's dropdown values, where its own are sentences.
//
// Keyed by ArduPilot's text rather than the number, since numbers differ per
// vehicle (FENCE_ACTION 1 is "RTL or Land" on Copter, "RTL" on Plane). An
// unlisted value keeps its own name. The full text stays as hover text
// (ParamField).

const SHORT: Record<string, string> = {
  // Copter radio and GCS failsafe, dead reckoning.
  'Enabled always RTL': 'RTL',
  'Enabled Continue with Mission in Auto Mode (Removed in 4.0+)': 'Removed',
  'Enabled always Land': 'Land',
  'Enabled always SmartRTL or RTL': 'SmartRTL/RTL',
  'Enabled always SmartRTL or Land': 'SmartRTL/Land',
  'Enabled Auto DO_LAND_START/DO_RETURN_PATH_START or RTL': 'Auto land/RTL',
  'Enabled always Brake or Land': 'Brake/Land',
  'Disabled/NoAction': 'Disabled',
  'RTL or Continue with Mission in Auto Mode (Removed in 4.0+-see FS_OPTIONS)': 'Removed',
  'SmartRTL or RTL': 'SmartRTL/RTL',
  'SmartRTL or Land': 'SmartRTL/Land',
  'Auto DO_LAND_START/DO_RETURN_PATH_START or RTL': 'Auto land/RTL',
  'Brake or Land': 'Brake/Land',
  // Plane radio and GCS failsafe.
  EnabledNoFailsafe: 'No failsafe',
  'CIRCLE/no change(if already in AUTO|GUIDED|LOITER)': 'Circle/keep',
  'FBWA at zero throttle': 'FBWA glide',
  ReturnToLaunch: 'RTL',
  'Deploy Parachute': 'Parachute',
  HeartbeatAndREMRSSI: 'HB and RSSI',
  HeartbeatAndAUTO: 'HB and Auto',
  // Return to launch.
  'Shallow (45deg)': 'Shallow 45°',
  'Steep (72deg)': 'Steep 72°',
  'Fly HOME then land via DO_LAND_START mission item': 'Home first',
  'Go directly to landing sequence via DO_LAND_START mission item': 'Land directly',
  OnlyForGoAround: 'Go-around only',
  'Go directly to landing sequence via DO_RETURN_PATH_START mission item': 'Return path',
  // Estimator.
  'Switch to Land mode if current mode requires position': 'Land',
  'Switch to AltHold mode if current mode requires position': 'AltHold',
  'Switch to Land mode from all modes': 'Land always',
  // Fence.
  AutoEnableOff: 'Off',
  AutoEnableOnTakeoff: 'On takeoff',
  AutoEnableDisableFloorOnLanding: 'Disable floor',
  AutoEnableOnlyWhenArmed: 'When armed',
  'SmartRTL or RTL or Land': 'SmartRTL/RTL',
  GuidedThrottlePass: 'Guided thr',
  'AUTOLAND if possible else RTL': 'Autoland/RTL',
  'Fence Return Point': 'Return point',
  'Nearest Rally Point': 'Nearest rally',
  // Arming.
  'Yes(minimum PWM when disarmed)': 'Yes, min PWM',
  'Yes(0 PWM when disarmed)': 'Yes, 0 PWM',
  ArmingOnly: 'Arm only',
  ArmOrDisarm: 'Arm/disarm',
  // Battery monitor and failsafe.
  'Analog Voltage Only': 'Analog voltage',
  'Analog Voltage and Current': 'Analog V and I',
  'Analog Current Only': 'Analog current',
  'Synthetic Current and Analog Voltage': 'Synthetic current',
  'Sum Of Selected Monitors': 'Sum of monitors',
  'INA2XX (INA226 INA228 INA238 INA231 INA260)': 'INA2XX',
  'TIBQ76952-I2C (Periph only)': 'TIBQ76952',
  'Parachute release': 'Parachute',
  'AUTOLAND or RTL': 'Autoland/RTL',
  'Raw Voltage': 'Raw',
  'Sag Compensated Voltage': 'Sag compensated',
}

/** ArduPilot's name for a value, shortened where it is a sentence. */
export function shortOption(name: string): string {
  return SHORT[name] ?? name
}
