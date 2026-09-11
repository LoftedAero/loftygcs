import { useConnectionStore } from '../../../stores/connection-store'
import { usePreferencesStore } from '../../../stores/preferences-store'
import { useVehicleStore } from '../../../stores/vehicle-store'
import { vehicleClass, type VehicleClass } from '../../../protocol/modes'

/**
 * The aircraft a plan is being written for.
 *
 * A connected vehicle answers this itself; with nothing connected the plan
 * still has to be for *something*, because the command set differs -- spline
 * waypoints and payload place are Copter-only and ArduPlane refuses them on
 * upload. Offering them anyway is a menu entry that can only ever fail,
 * which is the open issue Mission Planner has for exactly this.
 *
 * The stored preference is only consulted while disconnected. A connected
 * vehicle is never overridden by it: what is on the end of the link is not a
 * matter of opinion.
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
