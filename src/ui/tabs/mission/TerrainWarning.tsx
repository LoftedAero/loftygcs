import { useMissionStore } from '../../../stores/mission-store'
import {
  groundProfile,
  homeElevation,
  itemAltitudes,
  minClearance,
} from '../../../services/mission-terrain'
import { useTerrain } from './use-terrain'

// Flags a mission that intersects terrain, on the header above the profile
// that shows where. It warns but does not block, since low flight can be
// intentional.

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
