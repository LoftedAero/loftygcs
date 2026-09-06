import { useMissionStore } from '../../../stores/mission-store'
import {
  groundProfile,
  homeElevation,
  itemAltitudes,
  minClearance,
} from '../../../services/mission-terrain'
import { useTerrain } from './use-terrain'

// Whether this mission hits the ground.
//
// The profile already draws the answer -- the ground under the route, with
// the offending stretch in red. This says the one thing a drawing cannot:
// that there is something to look at. So it sits on the header above that
// drawing, appears only when it has something to report, and says nothing
// about how far or where, which the picture shows better than a number.
//
// It warns; it does not block. Flying low is a legitimate thing to plan --
// a survey at 40 m over a ridge is somebody's job -- so the station's part
// is to make sure nobody discovers the ridge from the telemetry.

export default function TerrainWarning() {
  const plan = useMissionStore((s) => s.plan)
  const terrain = useTerrain(plan, true)

  const home = homeElevation(plan, terrain.grids)
  const items = itemAltitudes(plan, home.amslM, terrain.grids)
  const ground = groundProfile(terrain.samples, terrain.grids)
  const worst = home.source === 'none' ? null : minClearance(ground, items)

  if (worst && worst.minM < 0) {
    return <span className="mission-lower__warn">Mission intersects terrain</span>
  }
  if (terrain.state === 'unavailable' && plan.items.length > 0) {
    return <span className="mission-lower__note">No elevation for this area</span>
  }
  return null
}
