import { useMissionStore } from '../../../stores/mission-store'
import { LaHint } from '../../components/La'
import {
  groundProfile,
  homeElevation,
  itemAltitudes,
  minClearance,
} from '../../../services/mission-terrain'
import { useTerrain } from './use-terrain'

// Whether this mission hits the ground.
//
// The profile already draws the answer -- the ground under the route, and
// the stretch that is below it in red. This says the one thing a drawing
// cannot: that there *is* something to look at. So it appears only when it
// has something to report and is otherwise absent, rather than standing
// there restating a picture nobody has to be told to read.
//
// It warns; it does not block. Flying low is a legitimate thing to plan --
// a survey at 40 m over a ridge is somebody's job -- so the station's part
// is to make sure nobody discovers the ridge from the telemetry.

export default function TerrainPanel() {
  const plan = useMissionStore((s) => s.plan)
  const terrain = useTerrain(plan, true)

  const home = homeElevation(plan, terrain.grids)
  const items = itemAltitudes(plan, home.amslM, terrain.grids)
  const ground = groundProfile(terrain.samples, terrain.grids)
  const worst = home.source === 'none' ? null : minClearance(ground, items)

  const message =
    worst && worst.minM < 0
      ? { error: true, text: 'Mission intersects terrain.' }
      : terrain.state === 'unavailable' && plan.items.length > 0
        ? { error: false, text: 'No elevation for this area.' }
        : null

  if (!message) return null

  return (
    <section className="app-col__group">
      <h3 className="app-col__head">Terrain</h3>
      <LaHint error={message.error}>{message.text}</LaHint>
    </section>
  )
}
