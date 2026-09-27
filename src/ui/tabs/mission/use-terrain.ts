import { useEffect, useMemo, useRef, useState } from 'react'
import { loadTerrainTiles, MAX_AREA_TERRAIN_TILES } from '../../../services/terrain'
import { gridKey, terrainTilesFor, type TerrainGrids } from '../../../services/terrain-math'
import { routeSamples, type RouteSample } from '../../../services/mission-terrain'
import type { MissionPlan } from '../../../protocol/mission-plan'

// Ground elevation for whatever the mission currently covers.
//
// Keyed on the tiles rather than the plan: dragging a waypoint changes the
// samples every frame, but a terrain tile is ten kilometers across, so a
// fetch happens only when the mission reaches new ground.

export type TerrainState = 'off' | 'loading' | 'ready' | 'unavailable'

export interface Terrain {
  grids: TerrainGrids
  state: TerrainState
  /** Route samples the profile should ask about, already computed. */
  samples: RouteSample[]
}

const EMPTY: TerrainGrids = new Map()

export function useTerrain(plan: MissionPlan, enabled: boolean): Terrain {
  const samples = useMemo(() => routeSamples(plan), [plan])
  const tiles = useMemo(() => {
    if (!enabled) return []
    const needed = terrainTilesFor(samples)
    // Same cap as the offline download: a continent-wide mission would need
    // hundreds of tiles.
    return needed.length > MAX_AREA_TERRAIN_TILES ? [] : needed
  }, [samples, enabled])
  const key = useMemo(() => tiles.map(gridKey).sort().join(','), [tiles])

  const [grids, setGrids] = useState<TerrainGrids>(EMPTY)
  const [state, setState] = useState<TerrainState>('off')
  const tilesRef = useRef(tiles)
  tilesRef.current = tiles

  useEffect(() => {
    if (!enabled || key === '') {
      setGrids(EMPTY)
      setState('off')
      return
    }
    let live = true
    setState((s) => (s === 'ready' ? s : 'loading'))
    void loadTerrainTiles(tilesRef.current).then((g) => {
      if (!live) return
      setGrids(g)
      // Nothing came back (offline and uncached, or unreachable): the
      // profile draws without ground rather than a flat plain.
      setState(g.size > 0 ? 'ready' : 'unavailable')
    })
    return () => {
      live = false
    }
  }, [key, enabled])

  return { grids, state, samples }
}
