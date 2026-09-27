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

// The flight screen, arranged as Mission Planner arranges it: one panel
// pinned left at a fixed aspect ratio, the controls and messages filling the
// space beneath it, and the other panel taking the full height on the right.
//
// The two columns are the same height by construction, so dragging the
// divider widens the left one, which makes its fixed-aspect panel taller,
// which the stack underneath absorbs. Swap exchanges which panel is pinned;
// whichever lands on the left inherits the aspect rule.
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

  // How tall the controls are right now. They wrap as the column narrows, so
  // their height is measured rather than assumed, and the pinned panel is
  // capped to leave room for them and for a usable lower pane beneath.
  const [controlsH, setControlsH] = useState(0)
  useEffect(() => {
    const controls = belowRef.current?.querySelector('.flight-controls')
    if (!controls) return
    const ro = new ResizeObserver(() =>
      setControlsH(Math.ceil(controls.getBoundingClientRect().height)),
    )
    ro.observe(controls)
    return () => ro.disconnect()
  }, [])

  // The HUD's right-click shortcut to the video settings. It has to open the
  // pane as well as select it: with the lower pane switched off, changing
  // which tab is active would have done nothing anyone could see.
  const showVideoPane = () => {
    layout.setLogPane('video')
    if (!layout.showMessages) layout.toggle('showMessages')
  }

  // Pins belong to the vehicle that was sent them: a guided target is where
  // *that* aircraft was told to go, and a home pin is where it said its
  // home was. Both are meaningless once it is gone, and leaving them up
  // reads as instructions still standing.
  const linked = useConnectionStore((s) => s.phase === 'connected' || s.phase === 'linkLost')
  useEffect(() => {
    if (linked) return
    setTarget(null)
    setHomePin(null)
  }, [linked])

  // Drawn with or without a vehicle. It used to be a card saying what the
  // screen would have shown, which meant the app opened on a description of
  // itself -- and the map is useful before a vehicle exists: it is where you
  // look at the field, and where a mission drawn next door is already
  // visible. Everything that commands the aircraft is disabled without a
  // connection (see FlightControls), and the instruments read zero, which is
  // what an instrument does when nothing is driving it.

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

  const aspectIsHud = layout.aspectPanel === 'hud'
  const aspectVisible = aspectIsHud ? layout.showHud : layout.showMap
  const fillVisible = aspectIsHud ? layout.showMap : layout.showHud

  // One grid rather than two independent columns. The top row is sized by
  // the fixed-aspect panel and the bottom row takes the rest, so the
  // controls on the left and the plot on the right are the same height by
  // construction -- there is no way to express "as tall as the other
  // column's remainder" between siblings.
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

      {hudMenu && (
        <HudContextMenu point={hudMenu} onClose={() => setHudMenu(null)} onVideo={showVideoPane} />
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
    </div>
  )
}

/**
 * The lower pane: the vehicle's own messages, or every telemetry field it is
 * sending. Two views of "what is it telling me", so they share one space and
 * a header rather than competing for the screen.
 */
/**
 * The lower pane: one thing at a time, chosen by its tab.
 *
 * Camera and joystick live here rather than as panels of their own. They
 * are things you look at in the space under the controls, which is what
 * this pane is for -- and as separate panels they competed with it for the
 * same room while being switched on from a menu about window layout.
 *
 * Each pane is mounted only while it is showing, which the joystick
 * depends on: it starts reading the gamepad when it mounts and stops when
 * it unmounts, so nothing is polled while you are reading messages.
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
    // The placeholder gives this the same empty state the Status pane has.
    // A vehicle that has said nothing yet and no vehicle at all otherwise
    // look identical here -- an empty box, which reads as a fault.
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
