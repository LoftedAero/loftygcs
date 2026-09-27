import L from 'leaflet'
import type { PlanItem } from '../../../protocol/mission-plan'
import { hasCoords } from '../../../protocol/mission-plan'

// The mission, drawn on the flying map.
//
// Read-only and faint, so the vehicle stays the brightest thing on the map;
// only the leg in progress is drawn solid.
//
// Imperative like the rest of this map: rebuilding a Leaflet layer through
// React at telemetry rate fights the map's own DOM.

/** The route in muted orange; the active leg in the brand action color. */
const ROUTE = '#F7941D'
const ACTIVE = '#F7941D'
const ROUTE_OPACITY = 0.35

export interface MissionOverlay {
  /** Redraw for a plan and the item the vehicle says it is flying. */
  update(items: readonly PlanItem[], currentSeq: number | null): void
  remove(): void
}

export function createMissionOverlay(map: L.Map): MissionOverlay {
  const layer = L.layerGroup().addTo(map)
  let lastKey = ''

  return {
    update(items, currentSeq) {
      // Keyed on what it draws, so telemetry-rate calls are skipped unless
      // the plan or the current item changed.
      const located = items.filter((it) => hasCoords(it))
      const key = `${currentSeq}|${located.map((it) => `${it.x},${it.y}`).join(';')}`
      if (key === lastKey) return
      lastKey = key
      layer.clearLayers()
      if (located.length === 0) return

      const points = located.map((it) => L.latLng(it.x / 1e7, it.y / 1e7))
      L.polyline(points, { color: ROUTE, weight: 2, opacity: ROUTE_OPACITY }).addTo(layer)

      located.forEach((it, i) => {
        // The vehicle's sequence number (item 0 is home), not the index
        // into `located`.
        const seq = items.indexOf(it)
        const active = currentSeq !== null && seq === currentSeq
        L.circleMarker(points[i]!, {
          radius: active ? 7 : 5,
          color: active ? ACTIVE : ROUTE,
          weight: active ? 3 : 2,
          opacity: active ? 1 : ROUTE_OPACITY + 0.2,
          fillColor: active ? ACTIVE : '#FFFFFF',
          fillOpacity: active ? 0.9 : 0.5,
        }).addTo(layer)
      })

      // The leg being flown, drawn last so it sits over the faint route.
      if (currentSeq === null) return
      const currentIdx = located.findIndex((it) => items.indexOf(it) === currentSeq)
      if (currentIdx > 0) {
        L.polyline([points[currentIdx - 1]!, points[currentIdx]!], {
          color: ACTIVE,
          weight: 4,
          opacity: 0.95,
        }).addTo(layer)
      }
    },
    remove() {
      layer.remove()
    },
  }
}
