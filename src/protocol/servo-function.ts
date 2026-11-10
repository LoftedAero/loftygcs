// Which SERVOn_FUNCTION changes ArduPilot applies without a restart.
//
// The metadata marks every SERVOn_FUNCTION RebootRequired, but every vehicle
// re-reads the functions once a second (SRV_Channels::enable_aux_servos), so
// an output takes up its new function within a second. A restart is still owed
// where something about the output is settled only at boot:
//
// - Motors, throttles and GPIO: the output's protocol (DShot, OneShot) and rate
//   are configured with the motors at boot.
// - Scaling: aux_servo_function_setup gives an output its scaling once
//   (`type_setup`) and keeps it, so an output moved to a function scaled
//   differently keeps the old scaling.
// - Functions the vehicle code scales at boot (Plane's tilt motors, Rover's
//   steering, the winch): a later assignment never gets that scaling.
//
// Checked against SRV_Channel.h and SRV_Channel_aux.cpp on master, functions
// up to 189; anything newer is assumed to need a restart.

const HIGHEST_KNOWN = 189

function within(f: number, lo: number, hi: number) {
  return f >= lo && f <= hi
}

/** GPIO, motors 1-32 and the throttles. */
function setUpAtBoot(f: number): boolean {
  return (
    f === -1 ||
    within(f, 33, 40) ||
    within(f, 82, 85) ||
    within(f, 160, 179) ||
    f === 70 ||
    f === 73 ||
    f === 74
  )
}

/**
 * Scaled by vehicle code at boot, not by aux_servo_function_setup: steering,
 * the tilt motors, ignition and starter, the tracker's axes, the winch, the
 * sails and the mast.
 */
function scaledAtBoot(f: number): boolean {
  return [26, 45, 46, 47, 75, 76, 67, 69, 71, 72, 88, 89, 128, 137].includes(f)
}

/** The scaling aux_servo_function_setup gives a function, if any. */
function setupScaling(f: number): string | null {
  if ([2, 3, 11, 156, 110].includes(f)) return 'range 100'
  if ([31, 32, 41, 81, 126, 92, 180, 181, 182, 183].includes(f)) return 'range 1000'
  if (within(f, 184, 189)) return 'angle 1'
  if (
    [4, 18, 19, 20, 16, 17, 86, 87, 21, 24, 25, 77, 78, 79, 80, 124, 125, 127].includes(f) ||
    within(f, 94, 109) ||
    within(f, 140, 155)
  ) {
    return 'angle 4500'
  }
  return null
}

/** Whether changing an output's function from `from` to `to` applies without a restart. */
export function servoFunctionAppliesLive(from: number, to: number): boolean {
  if (from === to) return true
  if (from > HIGHEST_KNOWN || to > HIGHEST_KNOWN) return false
  if (setUpAtBoot(from) || setUpAtBoot(to) || scaledAtBoot(to)) return false
  const wanted = setupScaling(to)
  // The rest (gripper, camera trigger, mount, passthrough) set the pulse width
  // themselves, so a kept scaling does not touch them.
  if (wanted === null) return true
  if (scaledAtBoot(from)) return false
  const kept = setupScaling(from)
  return kept === null || kept === wanted
}

/** SERVOn_FUNCTION, for any n. */
export function isServoFunction(name: string): boolean {
  return /^SERVO\d+_FUNCTION$/.test(name)
}
