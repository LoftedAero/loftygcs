import { useState } from 'react'
import MissionMap from './MissionMap'
import MissionTable from './MissionTable'
import MissionSettings from './MissionSettings'
import MissionToolbar from './MissionToolbar'
import ItemPalette from './ItemPalette'
import AltitudeProfile from './AltitudeProfile'
import { LaButton } from '../../components/La'
import { useMissionStore } from '../../../stores/mission-store'

// Mission planning: Mission Planner's shape with QGroundControl's ideas
// where they are better.
//
//   ┌───────────────────────────────┬──────────┐
//   │ map, with the add palette on  │ settings │
//   │ it and the route drawn        │          │
//   ├───────────────────────────────┴──────────┤
//   │ altitude profile (toggleable)            │
//   ├──────────────────────────────────────────┤
//   │ item table                               │
//   └──────────────────────────────────────────┘
//
// The map is the primary surface because planning is a spatial task; the
// table is underneath rather than beside it because rows are wide and a
// map squeezed into half a window stops being a map. The profile sits
// between them because it is read against both.
//
// Unlike the Fly screen this is not a resizable grid: nothing here changes
// at telemetry rate, and a fixed arrangement that is right beats an
// adjustable one that has to be arranged before it can be used.

export default function MissionTab() {
  // Which command the next map click places, or null to select instead.
  const [tool, setTool] = useState<number | null>(null)
  const [showProfile, setShowProfile] = useState(true)
  const items = useMissionStore((s) => s.plan.items.length)

  return (
    <div className="mission-screen">
      <MissionToolbar />

      <div className="mission-body">
        <div className="mission-main">
          <div className="mission-map-area">
            <ItemPalette tool={tool} onTool={setTool} />
            <MissionMap tool={tool} onPlaced={() => setTool(null)} />
          </div>

          <div className="mission-lower">
            <div className="mission-lower__head">
              <h3 className="mission-lower__title">
                Items {items > 0 && <span className="mission-lower__count">{items}</span>}
              </h3>
              <LaButton
                variant="ghost"
                size="sm"
                aria-pressed={showProfile}
                onClick={() => setShowProfile((v) => !v)}
              >
                {showProfile ? 'Hide profile' : 'Show profile'}
              </LaButton>
            </div>
            {showProfile && items > 0 && <AltitudeProfile />}
            <MissionTable />
          </div>
        </div>

        <aside className="mission-side">
          <MissionSettings />
        </aside>
      </div>
    </div>
  )
}
