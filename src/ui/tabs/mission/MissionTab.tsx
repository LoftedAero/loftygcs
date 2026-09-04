import { useEffect, useRef, useState } from 'react'
import MissionMap from './MissionMap'
import MissionTable from './MissionTable'
import MissionSettings from './MissionSettings'
import SurveyPanel from './SurveyPanel'
import MissionToolbar from './MissionToolbar'
import ItemPalette from './ItemPalette'
import AltitudeProfile from './AltitudeProfile'
import Divider from '../../components/Divider'
import { LaButton, LaModal } from '../../components/La'
import { useMissionStore } from '../../../stores/mission-store'

// Mission planning: Mission Planner's shape with QGroundControl's ideas
// where they are better.
//
//   ┌───────────────────────────────┬──────────┐
//   │ map, with the add palette     │ file and │
//   │ down its left edge            │ vehicle  │
//   ├─ ── ── drag to resize ── ── ──┤ actions, │
//   │ altitude profile              │ then     │
//   │ item table                    │ settings │
//   └───────────────────────────────┴──────────┘
//
// The map is the primary surface because planning is a spatial task, and the
// table sits underneath rather than beside it because rows are wide and a map
// squeezed into half a window stops being a map. How that height is split is
// the user's call, and it is remembered.
//
// Actions live in the right column rather than a strip along the top: it is
// where Mission Planner keeps them, and the column had room the map did not.

export default function MissionTab() {
  // Which command the next map click places. Null means the default, which
  // is a waypoint -- see MissionMap for why clicking does something rather
  // than nothing.
  const [tool, setTool] = useState<number | null>(null)
  const [showProfile, setShowProfile] = useState(true)
  const [firstAt, setFirstAt] = useState<{ x: number; y: number } | null>(null)
  const mainRef = useRef<HTMLDivElement>(null)

  const items = useMissionStore((s) => s.plan.items.length)
  const addItem = useMissionStore((s) => s.addItem)
  const split = useMissionStore((s) => s.split)
  const setSplit = useMissionStore((s) => s.setSplit)

  const profileVisible = showProfile && items > 0

  return (
    <div className="mission-screen">
      <div className="mission-body">
        <div
          className="mission-main"
          ref={mainRef}
          style={
            {
              '--split-top': `${split.toFixed(3)}fr`,
              '--split-bottom': `${(1 - split).toFixed(3)}fr`,
            } as React.CSSProperties
          }
        >
          <div className="mission-map-area">
            <ItemPalette tool={tool} onTool={setTool} />
            <MissionMap
              tool={tool}
              onPlaced={() => setTool(null)}
              onFirstItem={setFirstAt}
            />
          </div>

          <Divider
            orientation="horizontal"
            containerRef={mainRef}
            ratio={split}
            onRatio={setSplit}
          />

          <div className="mission-lower">
            <div className="mission-lower__head">
              <h3 className="mission-lower__title">
                Items {items > 0 && <span className="mission-lower__count">{items}</span>}
              </h3>
              {/* Nothing to show and nothing to hide until there are items. */}
              {items > 0 && (
                <LaButton
                  variant="ghost"
                  size="sm"
                  aria-pressed={showProfile}
                  onClick={() => setShowProfile((v) => !v)}
                >
                  {showProfile ? 'Hide profile' : 'Show profile'}
                </LaButton>
              )}
            </div>
            {profileVisible && <AltitudeProfile />}
            <MissionTable />
          </div>
        </div>

        <aside className="mission-side">
          <MissionToolbar />
          {/* Above the settings: while an area is being drawn it is what the
              map clicks mean, so it should be the first thing in reach. */}
          <SurveyPanel />
          <MissionSettings />
        </aside>
      </div>

      <FirstItemPrompt
        at={firstAt}
        onClose={() => setFirstAt(null)}
        onWaypoint={(at) => {
          addItem(16, at)
          setFirstAt(null)
        }}
        onTakeoff={(at) => {
          // Takeoff first, then the point that was actually clicked -- the
          // click meant "go here", and a takeoff alone would throw that away.
          addItem(22)
          addItem(16, at)
          setFirstAt(null)
        }}
      />
    </div>
  )
}

/**
 * The first click on an empty plan. ArduPilot will not start an Auto mission
 * that does not begin with a takeoff, so the overwhelmingly common first item
 * is one -- but placing it silently would be guessing, and a mission that
 * begins with an unwanted climb is worse than one that asks.
 */
function FirstItemPrompt({
  at,
  onClose,
  onWaypoint,
  onTakeoff,
}: {
  at: { x: number; y: number } | null
  onClose: () => void
  onWaypoint: (at: { x: number; y: number }) => void
  onTakeoff: (at: { x: number; y: number }) => void
}) {
  // Escape closes it, as it closes every other menu here. Without this the
  // only ways out were the two buttons, and a dialog you cannot dismiss the
  // habitual way reads as a stuck app rather than a question.
  useEffect(() => {
    if (!at) return
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [at, onClose])

  if (!at) return null
  return (
    <LaModal
      open
      narrow
      title="Start with a takeoff?"
      actions={
        <div className="la-prompt-actions">
          <LaButton variant="primary" size="block" onClick={() => onTakeoff(at)}>
            Takeoff
          </LaButton>
          <LaButton variant="secondary" size="block" onClick={() => onWaypoint(at)}>
            Waypoint
          </LaButton>
          <LaButton variant="ghost" size="block" onClick={onClose}>
            Cancel
          </LaButton>
        </div>
      }
    />
  )
}
