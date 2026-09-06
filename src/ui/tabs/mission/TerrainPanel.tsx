import { useMemo } from 'react'
import { LaHint, LaSwitch } from '../../components/La'
import { useMissionStore } from '../../../stores/mission-store'
import { useUnits } from '../../../stores/preferences-store'
import { distanceLabel, formatDistance } from '../../../units'
import { TERRAIN_ATTRIBUTION } from '../../../services/terrain'
import {
  groundProfile,
  homeElevation,
  itemAltitudes,
  minClearance,
} from '../../../services/mission-terrain'
import { useTerrain } from './use-terrain'

// The one number the profile cannot show at a glance: how close the mission
// comes to the ground, and where.
//
// It is a readout rather than a block on upload. Flying low is a legitimate
// thing to plan -- a survey at 40 m over a ridge is somebody's job -- so the
// station's part is to make sure nobody discovers the ridge from the
// telemetry.

export default function TerrainPanel() {
  const units = useUnits()
  const plan = useMissionStore((s) => s.plan)
  const on = useMissionStore((s) => s.terrain)
  const setTerrain = useMissionStore((s) => s.setTerrain)
  const terrain = useTerrain(plan, on)

  const home = homeElevation(plan, terrain.grids)
  const items = itemAltitudes(plan, home.amslM, terrain.grids)
  const ground = groundProfile(terrain.samples, terrain.grids)
  const worst = home.source === 'none' ? null : minClearance(ground, items)

  // The leg, not the distance: "between 3 and 4" is somewhere a planner can
  // look, where "17,375 m along the route" has to be counted out first.
  const seqOf = useMemo(() => {
    const map = new Map<string, number>()
    plan.items.forEach((it, i) => map.set(it.uid, i + 1))
    return map
  }, [plan])
  const where = (c: { from: string | null; to: string | null }) => {
    const a = c.from ? seqOf.get(c.from) : undefined
    const b = c.to ? seqOf.get(c.to) : undefined
    if (a && b) return `between ${a} and ${b}`
    if (a) return `at ${a}`
    return 'along the route'
  }

  return (
    <section className="app-col__group">
      <h3 className="app-col__head">Terrain</h3>

      <LaSwitch
        label="Ground under the mission"
        checked={on}
        onChange={(e) => setTerrain(e.target.checked)}
      />

      {on && terrain.state === 'loading' && <LaHint>Reading elevation…</LaHint>}

      {on && terrain.state === 'unavailable' && (
        <LaHint>No elevation for this area yet — download the map for it.</LaHint>
      )}

      {on && terrain.state === 'ready' && home.source === 'none' && (
        <LaHint>Set a home position to measure heights against.</LaHint>
      )}

      {on && worst && worst.minM < 0 && (
        <LaHint error>
          Mission passes {formatDistance(-worst.minM, units.distance)}{' '}
          {distanceLabel(units.distance)} below ground {where(worst)}.
        </LaHint>
      )}

      {on && worst && worst.minM >= 0 && (
        <LaHint>
          Lowest clearance {formatDistance(worst.minM, units.distance)}{' '}
          {distanceLabel(units.distance)}, {where(worst)}.
        </LaHint>
      )}

      {on &&
        terrain.state === 'ready' &&
        (home.source === 'terrain' || home.source === 'route') && (
          <LaHint>
            No vehicle has set home, so heights are measured from the ground{' '}
            {home.source === 'route' ? 'under the first waypoint' : 'under home'} —{' '}
            {formatDistance(home.amslM, units.distance)} {distanceLabel(units.distance)} above sea
            level.
          </LaHint>
        )}

      {on && <LaHint>{TERRAIN_ATTRIBUTION}</LaHint>}
    </section>
  )
}
