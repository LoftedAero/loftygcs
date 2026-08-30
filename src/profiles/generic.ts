// Class-layer profiles: the generic guides every user can see for their
// vehicle type. Deliberately modest -- the differentiated content lives in
// product profiles, which extend these.
import type { ProfileDef } from './types'

export const MULTIROTOR: ProfileDef = {
  id: 'class-multirotor',
  name: 'Multirotor',
  layer: 'class',
  matchVehicleTypes: [2, 3, 4, 13, 14, 15, 29],
  guides: [
    {
      id: 'copter-first-setup',
      title: 'Multirotor first setup',
      summary: 'The bench checklist for a new Copter build: frame, calibrations, radio, motors.',
      steps: [
        {
          kind: 'info',
          title: 'Before you start',
          body: 'Have the vehicle on a bench with props removed, USB connected, and the transmitter on. Each step tells the vehicle what to do and confirms it answered.',
        },
        {
          kind: 'manual',
          title: 'Props off',
          body: 'Remove all propellers. Later steps spin motors.',
          confirmLabel: 'Props are removed',
        },
        {
          kind: 'calibration',
          title: 'Accelerometer',
          body: 'Six orientations, a few seconds each.',
          cal: 'accel',
        },
        {
          kind: 'calibration',
          title: 'Compass',
          body: 'Rotate the vehicle around every axis until coverage completes.',
          cal: 'compass',
        },
        {
          kind: 'check',
          title: 'Radio link',
          body: 'Turn the transmitter on and move the sticks; then calibrate the radio from the Setup tab if endpoints are new.',
          checks: [
            { label: 'RC input seen', type: 'rcSeen' },
            { label: 'Vehicle disarmed', type: 'disarmed' },
          ],
        },
        {
          kind: 'info',
          title: 'Motor order',
          body: 'Use Motors & Outputs to spin each motor briefly and confirm order and direction match the frame diagram. Then refit props and run a hover check in an open area.',
        },
      ],
    },
  ],
}

export const QUADPLANE: ProfileDef = {
  id: 'class-quadplane',
  name: 'VTOL quadplane',
  layer: 'class',
  matchVehicleTypes: [1, 19, 20, 21, 22, 23, 24, 25],
  guides: [],
}

export const CLASS_PROFILES = [MULTIROTOR, QUADPLANE]
