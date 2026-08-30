import ParamCard, { NeedsVehicle } from '../../components/ParamCard'
import { useConnectionStore } from '../../../stores/connection-store'

// The tuning parameters people actually reach for, in the spirit of Mission
// Planner's extended tuning screen -- rate and angle gains, speeds, and the
// autotune entry point. Cards whose parameters this vehicle does not have
// hide themselves, so the same declaration serves Copter and Plane.
export default function TuningTab() {
  const connected = useConnectionStore((s) => s.phase === 'connected' || s.phase === 'linkLost')
  if (!connected) {
    return (
      <NeedsVehicle
        title="Tuning"
        body="The commonly adjusted rate and angle gains, navigation speeds, and autotune. The full set lives on the Parameters tab."
      />
    )
  }
  return (
    <>
      <ParamCard
        title="Rate roll"
        subtitle="Copter"
        fields={[
          { param: 'ATC_RAT_RLL_P', label: 'P' },
          { param: 'ATC_RAT_RLL_I', label: 'I' },
          { param: 'ATC_RAT_RLL_D', label: 'D' },
          { param: 'ATC_RAT_RLL_FLTD', label: 'D filter', unit: 'Hz' },
        ]}
      />
      <ParamCard
        title="Rate pitch"
        subtitle="Copter"
        fields={[
          { param: 'ATC_RAT_PIT_P', label: 'P' },
          { param: 'ATC_RAT_PIT_I', label: 'I' },
          { param: 'ATC_RAT_PIT_D', label: 'D' },
          { param: 'ATC_RAT_PIT_FLTD', label: 'D filter', unit: 'Hz' },
        ]}
      />
      <ParamCard
        title="Rate yaw"
        subtitle="Copter"
        fields={[
          { param: 'ATC_RAT_YAW_P', label: 'P' },
          { param: 'ATC_RAT_YAW_I', label: 'I' },
          { param: 'ATC_RAT_YAW_D', label: 'D' },
        ]}
      />
      <ParamCard
        title="Angle gains"
        fields={[
          { param: 'ATC_ANG_RLL_P', label: 'Roll angle P' },
          { param: 'ATC_ANG_PIT_P', label: 'Pitch angle P' },
          { param: 'ATC_ANG_YAW_P', label: 'Yaw angle P' },
          { param: 'ATC_ACCEL_R_MAX', label: 'Roll accel max', unit: 'cdeg/s/s' },
          { param: 'ATC_ACCEL_P_MAX', label: 'Pitch accel max', unit: 'cdeg/s/s' },
        ]}
      />
      <ParamCard
        title="Altitude and position"
        fields={[
          { param: 'PSC_ACCZ_P', label: 'Throttle accel P' },
          { param: 'PSC_ACCZ_I', label: 'Throttle accel I' },
          { param: 'PSC_POSZ_P', label: 'Altitude P' },
          { param: 'PSC_POSXY_P', label: 'Position P' },
        ]}
      />
      <ParamCard
        title="Speeds and limits"
        fields={[
          { param: 'WPNAV_SPEED', label: 'Waypoint speed', unit: 'cm/s' },
          { param: 'WPNAV_SPEED_UP', label: 'Climb speed', unit: 'cm/s' },
          { param: 'WPNAV_SPEED_DN', label: 'Descent speed', unit: 'cm/s' },
          { param: 'WPNAV_ACCEL', label: 'Waypoint accel', unit: 'cm/s/s' },
          { param: 'PILOT_SPEED_UP', label: 'Pilot climb speed', unit: 'cm/s' },
          { param: 'PILOT_SPEED_DN', label: 'Pilot descent speed', unit: 'cm/s' },
          { param: 'ANGLE_MAX', label: 'Lean angle max', unit: 'cdeg' },
        ]}
      />
      <ParamCard
        title="Plane attitude"
        subtitle="Plane"
        fields={[
          { param: 'RLL_RATE_P', label: 'Roll rate P' },
          { param: 'RLL_RATE_I', label: 'Roll rate I' },
          { param: 'RLL_RATE_D', label: 'Roll rate D' },
          { param: 'PTCH_RATE_P', label: 'Pitch rate P' },
          { param: 'PTCH_RATE_I', label: 'Pitch rate I' },
          { param: 'PTCH_RATE_D', label: 'Pitch rate D' },
        ]}
      />
      <ParamCard
        title="Autotune"
        note="Autotune flies the vehicle to find its own gains. Read the ArduPilot procedure before switching into it — it needs space and calm air."
        fields={[
          { param: 'AUTOTUNE_AXES', label: 'Axes to tune' },
          { param: 'AUTOTUNE_AGGR', label: 'Aggressiveness' },
          { param: 'AUTOTUNE_MIN_D', label: 'Minimum D' },
        ]}
      />
    </>
  )
}
