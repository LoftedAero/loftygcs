import { useEffect, useMemo, useRef, useState } from 'react'
import { loadTerrainTiles } from '../../../services/terrain'
import { gridKey, terrainTilesFor, type TerrainGrids } from '../../../services/terrain-math'
import { routeSamples, type RouteSample } from '../../../services/mission-terrain'
import type { MissionPlan } from '../../../protocol/mission-plan'

// Ground elevation for whatever the mission currently covers.
//
// Keyed on the *tiles* rather than the plan: dragging a waypoint changes
// the samples on every animation frame, and one terrain tile is ten
// kilometers across, so the fetch that matters happens once when the
// mission first reaches new ground. Everything after that is a synchronous
// lookup in an already decoded grid.

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
  const tiles = useMemo(() => (enabled ? terrainTilesFor(samples) : []), [samples, enabled])
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
      // Nothing came back: offline with no cached terrain, or the source is
      // unreachable. The profile then draws without ground rather than
      // drawing a flat plain that isn't there.
      setState(g.size > 0 ? 'ready' : 'unavailable')
    })
    return () => {
      live = false
    }
  }, [key, enabled])

  return { grids, state, samples }
}
