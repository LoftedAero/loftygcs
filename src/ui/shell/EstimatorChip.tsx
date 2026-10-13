import { useVehicleStore } from '../../stores/vehicle-store'
import { useParamStore } from '../../stores/param-store'
import { useUiStore } from '../../stores/ui-store'
import { SENSOR_BITS } from '../../protocol/sensors'
import { estimatorIndicator, isFailsafeState } from '../../protocol/estimator'

// The estimator in charge (EKF3, EKF2 or DCM), colored by its health, and the
// way into the EKF window. The first piece of the bar's vehicle status, shaped
// as the readiness pill beside it; drawn only with a vehicle, as that row is.
export default function EstimatorChip() {
  const sensorsPresent = useVehicleStore((s) => s.sensorsPresent)
  const sensorsHealth = useVehicleStore((s) => s.sensorsHealth)
  const ekf = useVehicleStore((s) => s.ekf)
  const announced = useVehicleStore((s) => s.estimatorAnnounced)
  const ekfFailsafe = useVehicleStore((s) => s.ekfFailsafe && isFailsafeState(s.systemStatus))
  const ahrsEkfType = useParamStore((s) => s.entries.get('AHRS_EKF_TYPE')?.value)
  const open = useUiStore((s) => s.estimatorOpen)
  const setOpen = useUiStore((s) => s.setEstimatorOpen)

  const { label, tone } = estimatorIndicator({
    ahrsEkfType,
    sensorsPresent,
    sensorsHealth,
    ahrsBit: SENSOR_BITS.ahrs,
    ekf,
    announced,
    ekfFailsafe,
  })

  return (
    <button
      type="button"
      // 'none' (no AHRS report yet) keeps the untinted ground.
      className={`app-status__state app-status__ekf app-status__state--${tone}`}
      title="EKF status"
      aria-label={`EKF status: ${label}`}
      aria-pressed={open}
      onClick={() => setOpen(!open)}
    >
      <span className="app-status__dot" aria-hidden="true" />
      <span className="app-status__word app-status__ekf-word">{label}</span>
    </button>
  )
}
