import ParamCard, { NeedsVehicle } from '../../components/ParamCard'
import SetupDoc from '../../components/SetupDoc'
import { useConnectionStore } from '../../../stores/connection-store'

// What the vehicle does when something goes wrong. Battery failsafe actions
// live on the Power tab, next to the thresholds that trigger them.
export default function FailsafesTab() {
  const connected = useConnectionStore((s) => s.phase === 'connected' || s.phase === 'linkLost')
  if (!connected) {
    return (
      <NeedsVehicle title="Failsafes" />
    )
  }
  return (
    <SetupDoc>
      {/* Worth doing before a new airframe flies: switch the transmitter off
          on the bench with the props removed and confirm the vehicle reacts.
          A standing instruction on the card is one people learn to skip. */}
      <ParamCard
        title="Radio failsafe"
        fields={[
          { param: 'FS_THR_ENABLE', label: 'Throttle failsafe' },
          { param: 'FS_THR_VALUE', label: 'Trigger PWM', unit: 'µs' },
          { param: 'FS_OPTIONS', label: 'Options' },
          { param: 'THR_FAILSAFE', label: 'Throttle failsafe' },
          { param: 'THR_FS_VALUE', label: 'Trigger PWM', unit: 'µs' },
        ]}
      />
      {/* Only useful when the vehicle is genuinely flown from the GCS: on a
          hobby link this fires on ordinary telemetry dropouts. */}
      <ParamCard
        title="Ground station failsafe"
        fields={[
          { param: 'FS_GCS_ENABLE', label: 'GCS failsafe' },
          { param: 'FS_GCS_TIMEOUT', label: 'Timeout', unit: 's' },
        ]}
      />
      <ParamCard
        title="Return to launch"
        fields={[
          { param: 'RTL_ALT', label: 'RTL altitude', unit: 'cm' },
          { param: 'RTL_ALT_FINAL', label: 'Final altitude', unit: 'cm' },
          { param: 'RTL_LOIT_TIME', label: 'Loiter before descent', unit: 'ms' },
          { param: 'RTL_CLIMB_MIN', label: 'Minimum climb', unit: 'cm' },
        ]}
      />
      <ParamCard
        title="Estimator and crash"
        fields={[
          { param: 'FS_EKF_ACTION', label: 'EKF failsafe action' },
          { param: 'FS_EKF_THRESH', label: 'EKF threshold' },
          { param: 'FS_CRASH_CHECK', label: 'Crash check' },
          { param: 'FS_VIBE_ENABLE', label: 'Vibration failsafe' },
        ]}
      />
      <ParamCard
        title="Fence"
        fields={[
          { param: 'FENCE_ENABLE', label: 'Fence' },
          { param: 'FENCE_TYPE', label: 'Fence type' },
          { param: 'FENCE_ACTION', label: 'Breach action' },
          { param: 'FENCE_ALT_MAX', label: 'Maximum altitude', unit: 'm' },
          { param: 'FENCE_RADIUS', label: 'Radius', unit: 'm' },
          { param: 'FENCE_MARGIN', label: 'Margin', unit: 'm' },
        ]}
      />
      {/* These are what keep a misconfigured vehicle on the ground. The
          warning against leaving them off belongs where somebody turns them
          off, not standing on the card. */}
      <ParamCard
        title="Arming checks"
        fields={[
          { param: 'ARMING_CHECK', label: 'Checks enabled' },
          { param: 'ARMING_RUDDER', label: 'Rudder arming' },
          { param: 'DISARM_DELAY', label: 'Auto-disarm delay', unit: 's' },
        ]}
      />
    </SetupDoc>
  )
}
