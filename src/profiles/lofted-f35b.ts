// Product profile: Lofted Aero F-35B.
//
// This is the pilot content for product-level guided setup -- a KNOWN
// aircraft, not a category. Values marked TODO(product) are placeholders
// standing in for the real flight-test baseline; the structure is the
// deliverable here. The doors/gear sequencer and the 3BSM nozzle controller
// are separate Lofted Aero boards with their own config apps, so this guide
// hands off to them explicitly (a future "companion device" transport could
// absorb them).
import type { ProfileDef } from './types'

export const LOFTED_F35B: ProfileDef = {
  id: 'lofted-f35b',
  name: 'Lofted Aero F-35B',
  layer: 'product',
  extends: 'class-quadplane',
  maker: 'Lofted Aero',
  description:
    'Thrust-vectored VTOL with the three-bearing swivel module and the F-35B door sequencer.',
  // TODO(product): real output map from the flight-test airframe.
  outputLabels: {
    1: 'Lift fan ESC',
    2: 'Main engine ESC',
    3: 'Nozzle tilt (3BSM)',
    4: 'Roll post left',
    5: 'Roll post right',
    6: 'Elevon left',
    7: 'Elevon right',
  },
  channelLabels: {
    5: 'Flight mode',
    7: 'Transition switch',
    8: 'Gear & doors',
  },
  // TODO(product): replace with the full known-good .param baseline. These
  // few exist so the diff/apply machinery is exercised end to end today.
  paramBaseline: [
    { name: 'FS_THR_ENABLE', value: 1 },
    { name: 'FS_GCS_ENABLE', value: 1 },
    { name: 'BATT_MONITOR', value: 4 },
  ],
  guides: [
    {
      id: 'f35b-bringup',
      title: 'F-35B bring-up',
      summary:
        'Bench-to-hover sequence for a new F-35B: baseline parameters, calibrations, sequencer checks, and the pre-hover checklist.',
      steps: [
        {
          kind: 'info',
          title: 'What this covers',
          body: 'This walks a freshly assembled F-35B from first power-up to hover-ready: applying the Lofted Aero parameter baseline, calibrating sensors, verifying the door sequencer and nozzle, and the pre-hover checks. Have the airframe on a bench, props/fan blades off, USB connected.',
        },
        {
          kind: 'manual',
          title: 'Props and fan blades off',
          body: 'Remove the main propeller and lift-fan blades. Several steps command motors and the nozzle.',
          confirmLabel: 'Blades are removed',
        },
        {
          kind: 'paramSet',
          title: 'Apply the F-35B baseline',
          body: 'Writes the Lofted Aero known-good parameter set for this airframe. Each value is verified against the vehicle after writing.',
          // TODO(product): the full baseline; this subset proves the flow.
          params: [
            { name: 'FS_THR_ENABLE', value: 1 },
            { name: 'FS_GCS_ENABLE', value: 1 },
            { name: 'BATT_MONITOR', value: 4 },
          ],
        },
        {
          kind: 'calibration',
          title: 'Accelerometer',
          body: 'Calibrate with the fuselage, not the nozzle, as your level reference.',
          cal: 'accel',
        },
        {
          kind: 'calibration',
          title: 'Compass',
          body: 'Calibrate outdoors, away from the bench PSU -- the lift-fan motor magnets make this airframe fussier than most.',
          cal: 'compass',
        },
        {
          kind: 'info',
          title: 'Door sequencer',
          body: 'Connect the door sequencer over its own USB port and verify the full open/close sequence in the F-35B Door Sequencer app. Confirm the doors clear the lift fan at every point of travel.',
          // TODO(product): becomes a live companion-device step when the
          // sequencer transport lands.
        },
        {
          kind: 'info',
          title: 'Nozzle (3BSM)',
          body: 'Connect the 3BSM controller in 3BSM Config and run the servo ID wizard if this is a fresh module. Sweep the nozzle through its full range and check for binding.',
        },
        {
          kind: 'check',
          title: 'Radio and safety',
          body: 'Transmitter on; verify the labeled switches move the right channels on the Setup tab.',
          checks: [
            { label: 'RC input seen', type: 'rcSeen' },
            { label: 'Vehicle disarmed', type: 'disarmed' },
            // TODO(product): param checks against the full baseline.
            { label: 'Radio failsafe enabled', type: 'param', param: 'FS_THR_ENABLE', value: 1 },
          ],
        },
        {
          kind: 'check',
          title: 'Pre-hover',
          body: 'Move outdoors with a clear GPS view. Refit blades only after this step passes.',
          checks: [{ label: '3D GPS fix', type: 'gpsFix3d' }],
        },
        {
          kind: 'info',
          title: 'First hover',
          body: 'Refit blades, clear the area, and hover in QSTABILIZE at low altitude. Verify nozzle response and door state before any transition attempt.',
        },
      ],
    },
  ],
}
