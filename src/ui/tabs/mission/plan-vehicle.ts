import { useConnectionStore } from '../../../stores/connection-store'
import { usePreferencesStore } from '../../../stores/preferences-store'
import { useVehicleStore } from '../../../stores/vehicle-store'
import { vehicleClass, type VehicleClass } from '../../../protocol/modes'

/**
 * The aircraft a plan is being written for, which decides the command set
 * (spline waypoints and payload place are Copter-only; ArduPlane refuses them
 * on upload). A connected vehicle answers this itself; the stored preference
 * is used only while disconnected.
 */
export function usePlanVehicleClass(): VehicleClass {
  const connected = useConnectionStore((s) => s.phase === 'connected' || s.phase === 'linkLost')
  const present = useVehicleStore((s) => s.present)
  const mavType = useVehicleStore((s) => s.vehicleType)
  const planFor = usePreferencesStore((s) => s.planFor)
  return connected && present ? vehicleClass(mavType) : planFor
}

/** Whether the class is a guess this app made rather than one the vehicle gave. */
export function usePlanVehicleIsAssumed(): boolean {
  const connected = useConnectionStore((s) => s.phase === 'connected' || s.phase === 'linkLost')
  const present = useVehicleStore((s) => s.present)
  return !(connected && present)
}
