import { useEffect, useRef, useState } from 'react'
import MissionMap from './MissionMap'
import MissionTable from './MissionTable'
import MissionSettings from './MissionSettings'
import NewItemDefaults from './NewItemDefaults'
import TerrainWarning from './TerrainWarning'
import OfflineMapsPanel from './OfflineMapsPanel'
import type { LatLonBounds } from '../../../services/tile-math'
import SurveyPanel from './SurveyPanel'
import PlanKindSwitch from './PlanKindSwitch'
import FencePanel from './FencePanel'
import RallyPanel from './RallyPanel'
import PlanActions from './PlanActions'
import GeoExchange from './GeoExchange'
import ItemPalette from './ItemPalette'
import FencePalette from './FencePalette'
import AltitudeProfile from './AltitudeProfile'
import ItemEditor, { ItemList, useItemEditor } from './ItemEditor'
import Divider from '../../components/Divider'
import { LaButton, LaModal, LaSwitch } from '../../components/La'
import { useMissionStore } from '../../../stores/mission-store'
import { useCompact } from '../../compact'
import ColumnShell, { ColumnToggle, closeColumn, useColumnOpen } from '../../components/ColumnShell'

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
// The table sits under the map rather than beside it because its rows are
// wide. The split is draggable and remembered. Actions live in the right
// column, as in Mission Planner.
//
// With an empty plan the lower pane collapses to its header; once the first
// item exists it takes the remembered split (a third by default).

export default function MissionTab() {
  const [view, setView] = useState<{ bounds: LatLonBounds; zoom: number } | null>(null)
  // Not persisted: a one-off check, not a permanent overlay.
  const [coverage, setCoverage] = useState(false)
  // Which command the next map click places; null means a waypoint.
  const [tool, setTool] = useState<number | null>(null)
  const [showProfile, setShowProfile] = useState(true)
  const [firstAt, setFirstAt] = useState<{ x: number; y: number } | null>(null)
  const mainRef = useRef<HTMLDivElement>(null)

  const items = useMissionStore((s) => s.plan.items.length)
  const addItem = useMissionStore((s) => s.addItem)
  const split = useMissionStore((s) => s.split)
  const editing = useMissionStore((s) => s.editing)
  const setSplit = useMissionStore((s) => s.setSplit)

  const profileVisible = showProfile && items > 0
  const compact = useCompact()
  // Compact mode: the item sheet that rises from the bottom, whether it shows
  // the profile, and the side panel with the plan's actions. One of the two
  // is open at a time.
  const [sheetOpen, setSheetOpen] = useState(false)
  const [compactProfile, setCompactProfile] = useState(false)
  const editorUid = useItemEditor((s) => s.uid)
  const closeEditor = useItemEditor((s) => s.close)
  const panelOpen = useColumnOpen()
  // Tapping an item opens the sheet on its editor; closing the sheet ends the
  // edit.
  useEffect(() => {
    if (editorUid) setSheetOpen(true)
  }, [editorUid])
  useEffect(() => {
    if (sheetOpen) closeColumn()
    else closeEditor()
  }, [sheetOpen, closeEditor])
  useEffect(() => {
    if (panelOpen) setSheetOpen(false)
  }, [panelOpen])
  useEffect(() => closeEditor, [closeEditor])

  const mapArea = (
    <div className="mission-map-area">
      {editing === 'mission' && <ItemPalette tool={tool} onTool={setTool} />}
      {/* The same strip for the fence tools. */}
      {editing === 'fence' && <FencePalette />}
      <MissionMap
        tool={tool}
        onPlaced={() => setTool(null)}
        onFirstItem={setFirstAt}
        onView={setView}
        coverage={coverage}
      />
    </div>
  )

  const lower = (
    <div className="mission-lower">
      <div className="mission-lower__head">
        <h3 className="mission-lower__title">
          Items {items > 0 && <span className="mission-lower__count">{items}</span>}
        </h3>
        {/* Beside the rows they apply to. Shown on every plan; the
            altitude also applies to new rally points. */}
        <NewItemDefaults />
        <span className="la-grow" />
        {items > 0 && <TerrainWarning />}
        <span className="la-grow" />
        {items > 0 && (
          <LaSwitch
            label="Show altitude profile"
            checked={showProfile}
            onChange={(e) => setShowProfile(e.target.checked)}
          />
        )}
      </div>
      {profileVisible && <AltitudeProfile />}
      <MissionTable />
    </div>
  )

  const sideContent = (
    <>
      {/* Everything that belongs to a plan scrolls. */}
      <div className="app-col mission-side__scroll">
        <PlanKindSwitch />
        {/* Read, write and clear, shared by all three plans. */}
        <PlanActions />
        {/* Files apply to whichever plan is selected. */}
        <GeoExchange />
        {editing === 'mission' && (
          <>
            <SurveyPanel />
            <MissionSettings />
          </>
        )}
        {/* Lists come last because they are the only sections that grow. */}
        {editing === 'fence' && <FencePanel />}
        {editing === 'rally' && <RallyPanel />}
      </div>

      {/* Pinned to the foot: offline maps are not about the plan, so they
          stay put when the plan switch changes the column above. */}
      <div className="mission-side__foot">
        <OfflineMapsPanel
          bounds={view?.bounds ?? null}
          zoom={view?.zoom ?? 15}
          coverage={coverage}
          onCoverage={setCoverage}
        />
      </div>
    </>
  )
  const side = <aside className="app-col-shell mission-side">{sideContent}</aside>

  const firstPrompt = (
    <FirstItemPrompt
      at={firstAt}
      onClose={() => setFirstAt(null)}
      onWaypoint={(at) => {
        addItem(16, at)
        setFirstAt(null)
      }}
      onTakeoff={(at) => {
        // Takeoff first, then a waypoint at the point that was clicked.
        addItem(22)
        addItem(16, at)
        setFirstAt(null)
      }}
    />
  )

  // Compact mode: the map fills the window, and the item list and the plan
  // column open as drawers over its right side.
  if (compact) {
    return (
      <div className={`mission-screen mission-compact${panelOpen ? ' has-panel' : ''}`}>
        {mapArea}
        {/* The screen's side panel, as on every screen with a column: the
            plan's actions. */}
        <div className="mission-compact__corner">
          <ColumnToggle label="Plan panel" />
        </div>
        <ColumnShell base="app-col-shell mission-panel">
          <div className="mission-side">{sideContent}</div>
        </ColumnShell>
        {/* The items rise from the bottom, where the route stays in view
            above them; the handle rides on the sheet's top edge. */}
        <div className={`plan-sheet${sheetOpen ? ' is-open' : ''}`}>
          <button
            type="button"
            className="plan-sheet__handle"
            aria-expanded={sheetOpen}
            onClick={() => setSheetOpen(!sheetOpen)}
          >
            {items > 0 ? `Items · ${items}` : 'Items'}
            <svg viewBox="0 0 10 6" aria-hidden="true">
              <path d="M1 5l4-4 4 4" />
            </svg>
          </button>
          {sheetOpen && (
            <div className="plan-sheet__body">
              {editorUid ? (
                <ItemEditor />
              ) : (
                <div className="mission-lower">
                  <div className="mission-lower__head">
                    <NewItemDefaults />
                    <span className="la-grow" />
                    {items > 0 && (
                      <LaSwitch
                        label="Profile"
                        checked={compactProfile}
                        onChange={(e) => setCompactProfile(e.target.checked)}
                      />
                    )}
                  </div>
                  {items > 0 && <TerrainWarning />}
                  {compactProfile && items > 0 && <AltitudeProfile />}
                  <ItemList />
                </div>
              )}
            </div>
          )}
        </div>
        {firstPrompt}
      </div>
    )
  }

  return (
    <div className="mission-screen">
      <div className="mission-body">
        <div
          className={`mission-main${items === 0 ? ' is-collapsed' : ''}`}
          ref={mainRef}
          style={
            {
              '--split-top': `${split.toFixed(3)}fr`,
              '--split-bottom': `${(1 - split).toFixed(3)}fr`,
            } as React.CSSProperties
          }
        >
          {mapArea}

          {/* No divider on an empty plan, so no split is stored against an
              empty table. */}
          {items > 0 && (
            <Divider
              orientation="horizontal"
              containerRef={mainRef}
              ratio={split}
              onRatio={setSplit}
            />
          )}

          {lower}
        </div>

        {side}
      </div>

      {firstPrompt}
    </div>
  )
}

/**
 * The first click on an empty plan. An Auto mission usually starts with a
 * takeoff, but adding one silently would be a guess, so this asks.
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
  // Escape closes it, as it does every other menu here.
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
