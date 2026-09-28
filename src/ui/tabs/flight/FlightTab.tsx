import { useEffect, useRef, useState } from 'react'
import { useVehicleStore } from '../../../stores/vehicle-store'
import { useConnectionStore } from '../../../stores/connection-store'
import {
  LOG_PANES,
  useFlightLayoutStore,
  type LogPane as LogPaneId,
} from '../../../stores/flight-layout-store'
import { gotoGuided, setHome, setRoi } from '../../../services/flight'
import MapView from './MapView'
import Hud from './Hud'
import Divider from '../../components/Divider'
import FlightControls from './FlightControls'
import MapContextMenu, { type MapMenuPoint } from './MapContextMenu'
import HudContextMenu, { type HudMenuPoint } from './HudContextMenu'
import PlotPanel from './PlotPanel'
import FieldPicker from './FieldPicker'
import StatusList from './StatusList'
import PreflightPanel from './PreflightPanel'
import CameraPanel from './CameraPanel'
import JoystickPanel from './JoystickPanel'
import VideoPane from './VideoPane'
import ViewPane from './ViewPane'
import { LaButton, LaModal } from '../../components/La'
import { useCompact } from '../../compact'

// The flight screen, laid out like Mission Planner's: one panel pinned left
// at a fixed aspect ratio with the controls and messages beneath it, and the
// other panel taking the full height on the right. Dragging the divider
// widens the left column, making its panel taller and the stack below it
// shorter. Swap exchanges which panel is pinned.
//
// It renders with or without a vehicle; everything that commands the
// aircraft is disabled without a connection (see FlightControls).
export default function FlightTab() {
  const [follow, setFollow] = useState(true)
  const [menu, setMenu] = useState<MapMenuPoint | null>(null)
  const [hudMenu, setHudMenu] = useState<HudMenuPoint | null>(null)
  const [target, setTarget] = useState<{ lat: number; lon: number } | null>(null)
  const [home, setHomePin] = useState<{ lat: number; lon: number } | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  const gridRef = useRef<HTMLDivElement>(null)
  const belowRef = useRef<HTMLDivElement>(null)
  const layout = useFlightLayoutStore()
  const compact = useCompact()

  // The controls wrap as the column narrows, so their height is measured and
  // the pinned panel is capped to leave room for them and the lower pane.
  const [controlsH, setControlsH] = useState(0)
  useEffect(() => {
    const controls = belowRef.current?.querySelector('.flight-controls')
    if (!controls) return
    const ro = new ResizeObserver(() =>
      setControlsH(Math.ceil(controls.getBoundingClientRect().height)),
    )
    ro.observe(controls)
    return () => ro.disconnect()
    // Remeasured on leaving compact mode, which renders no desktop controls.
  }, [compact])

  // The HUD's right-click shortcut to the video settings. Opens the lower
  // pane too, in case it is switched off.
  const showVideoPane = () => {
    layout.setLogPane('video')
    if (!layout.showMessages) layout.toggle('showMessages')
  }

  // The guided target and home pins belong to the connected vehicle, so they
  // are cleared when it goes.
  const linked = useConnectionStore((s) => s.phase === 'connected' || s.phase === 'linkLost')
  useEffect(() => {
    if (linked) return
    setTarget(null)
    setHomePin(null)
  }, [linked])

  const mapPanel = (
    <MapView
      follow={follow}
      onFollowChange={setFollow}
      onContextMenu={setMenu}
      target={target}
      home={home}
    />
  )
  const hudPanel = (
    <Hud horizon={layout.hudHorizon} overlays={layout.hudOverlays} onContextMenu={setHudMenu} />
  )

  if (compact) {
    return (
      <CompactFlight
        mapPanel={mapPanel}
        hudPanel={hudPanel}
        menus={menus()}
        plotted={layout.plotFields}
        onTogglePlot={layout.togglePlotField}
      />
    )
  }

  const aspectIsHud = layout.aspectPanel === 'hud'
  const aspectVisible = aspectIsHud ? layout.showHud : layout.showMap
  const fillVisible = aspectIsHud ? layout.showMap : layout.showHud

  // One grid rather than two columns: the top row is sized by the
  // fixed-aspect panel and the bottom row takes the rest, so the controls on
  // the left and the plot on the right always match in height.
  const grid = (
    <div
      className={`flight-grid${fillVisible ? '' : ' flight-grid--single'}${aspectVisible ? '' : ' flight-grid--no-aspect'}${layout.showMessages ? '' : ' flight-grid--no-pane'}`}
      ref={gridRef}
      style={
        {
          '--ratio': layout.ratio.toFixed(4),
          '--controls-h': `${controlsH}px`,
        } as React.CSSProperties
      }
    >
      {aspectVisible && (
        <div className="flight-grid__aspect">{aspectIsHud ? hudPanel : mapPanel}</div>
      )}
      {fillVisible && (
        <Divider containerRef={gridRef} ratio={layout.ratio} onRatio={layout.setRatio} />
      )}
      {fillVisible && (
        <div className={`flight-grid__fill${layout.showPlot ? '' : ' is-tall'}`}>
          {aspectIsHud ? mapPanel : hudPanel}
        </div>
      )}
      {/* Always present: it carries the controls even when the panel above
          them is switched off. */}
      <div className="flight-grid__below" ref={belowRef}>
        <FlightControls />
        {layout.showMessages && (
          <LogPane
            pane={layout.logPane}
            onPane={layout.setLogPane}
            plotted={layout.plotFields}
            onTogglePlot={layout.togglePlotField}
          />
        )}
      </div>
      {fillVisible && layout.showPlot && (
        <div className="flight-grid__plot">
          <PlotPanel
            fields={layout.plotFields}
            axisField={layout.plotAxisField}
            onAxisField={layout.setPlotAxisField}
            onRemove={layout.togglePlotField}
            onPick={() => setPickerOpen(true)}
            onClose={() => layout.toggle('showPlot')}
          />
        </div>
      )}
    </div>
  )

  return (
    <div className="flight-screen">
      <div className="flight-panels">{grid}</div>

      <FieldPicker
        open={pickerOpen}
        selected={layout.plotFields}
        onToggle={layout.togglePlotField}
        onClose={() => setPickerOpen(false)}
      />

      {menus()}
    </div>
  )

  // The HUD's and the map's context menus, the same in both layouts.
  function menus() {
    return (
      <>
        {hudMenu && (
          <HudContextMenu
            point={hudMenu}
            onClose={() => setHudMenu(null)}
            onVideo={showVideoPane}
          />
        )}

        {menu && (
          <MapContextMenu
            point={menu}
            onClose={() => setMenu(null)}
            onFlyHere={(alt) => {
              gotoGuided(menu.lat, menu.lon, alt)
              setTarget({ lat: menu.lat, lon: menu.lon })
            }}
            onPointCamera={() => void setRoi(menu.lat, menu.lon)}
            onSetHome={() => {
              void setHome(menu.lat, menu.lon)
              setHomePin({ lat: menu.lat, lon: menu.lon })
            }}
          />
        )}
      </>
    )
  }
}

/**
 * Compact mode's Fly screen: one panel fills the window with the other as an
 * inset (tap ⇄ to swap), and the flight actions in a column on the right,
 * where a thumb rests on a handheld. Everything else (the adjustments and
 * the lower pane's views) is in a sheet behind More and Messages.
 */
function CompactFlight({
  mapPanel,
  hudPanel,
  menus,
  plotted,
  onTogglePlot,
}: {
  mapPanel: React.ReactNode
  hudPanel: React.ReactNode
  menus: React.ReactNode
  plotted: readonly string[]
  onTogglePlot: (name: string) => void
}) {
  const layout = useFlightLayoutStore()
  const [sheet, setSheet] = useState(false)
  const statusTexts = useVehicleStore((s) => s.statusTexts)
  // Messages that arrived since the sheet was last open.
  const [seenAt, setSeenAt] = useState(() => Date.now())
  const unread = sheet ? 0 : statusTexts.filter((t) => t.at > seenAt).length

  const open = (pane?: LogPaneId) => {
    if (pane) layout.setLogPane(pane)
    setSheet(true)
  }
  const close = () => {
    setSeenAt(Date.now())
    setSheet(false)
  }

  // The inset is the panel the desktop layout pins at a fixed aspect.
  const insetIsHud = layout.aspectPanel === 'hud'
  return (
    <div className="flight-compact">
      <div className="flight-compact__main">{insetIsHud ? mapPanel : hudPanel}</div>
      <div className="flight-compact__inset">
        {insetIsHud ? hudPanel : mapPanel}
        <button
          type="button"
          className="flight-compact__swap"
          aria-label="Swap map and HUD"
          onClick={layout.swap}
        >
          ⇄
        </button>
      </div>
      <div className="flight-compact__actions">
        <FlightControls part="primary" compact />
        <LaButton variant="ghost" onClick={() => open()}>
          More
        </LaButton>
      </div>
      <button type="button" className="flight-compact__messages" onClick={() => open('messages')}>
        {unread > 0 ? `Messages · ${unread}` : 'Messages'}
      </button>

      <LaModal
        open={sheet}
        title="Flight"
        actions={
          <LaButton variant="primary" onClick={close}>
            Done
          </LaButton>
        }
      >
        <div className="flight-sheet">
          <FlightControls part="secondary" compact />
          <LogPane
            pane={layout.logPane}
            onPane={layout.setLogPane}
            plotted={plotted}
            onTogglePlot={onTogglePlot}
          />
        </div>
      </LaModal>
      {menus}
    </div>
  )
}

/**
 * The lower pane: one view at a time, chosen by its tab.
 *
 * Each pane is mounted only while showing. The joystick depends on this: it
 * reads the gamepad only while mounted.
 */
function LogPane({
  pane,
  onPane,
  plotted,
  onTogglePlot,
}: {
  pane: LogPaneId
  onPane: (p: LogPaneId) => void
  plotted: readonly string[]
  onTogglePlot: (name: string) => void
}) {
  return (
    <div className="log-pane">
      <div className="log-pane__head" role="tablist" aria-label="Lower pane">
        {LOG_PANES.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={pane === tab.id}
            className={`log-pane__tab${pane === tab.id ? ' is-active' : ''}`}
            onClick={() => onPane(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {pane === 'messages' && <FlightMessages />}
      {pane === 'status' && <StatusList plotted={plotted} onTogglePlot={onTogglePlot} />}
      {pane === 'preflight' && <PreflightPanel />}
      {pane === 'camera' && <CameraPanel />}
      {pane === 'joystick' && <JoystickPanel />}
      {pane === 'video' && <VideoPane />}
      {pane === 'view' && <ViewPane />}
    </div>
  )
}

function FlightMessages() {
  const statusTexts = useVehicleStore((s) => s.statusTexts)
  const logRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [statusTexts])
  return (
    // The same empty-state placeholder as the Status pane.
    <textarea
      ref={logRef}
      className="la-log flight-log"
      readOnly
      aria-label="Status messages"
      placeholder="Waiting for telemetry…"
      value={statusTexts.map((s) => s.text).join('\n')}
    />
  )
}
