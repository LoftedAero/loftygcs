import { useEffect, useRef, useState } from 'react'
import { LaCard } from '../../components/La'
import { useConnectionStore } from '../../../stores/connection-store'
import { useVehicleStore } from '../../../stores/vehicle-store'
import { useFlightLayoutStore } from '../../../stores/flight-layout-store'
import { gotoGuided, setHome, setRoi } from '../../../services/flight'
import MapView from './MapView'
import Hud from './Hud'
import Divider from './Divider'
import FlightControls from './FlightControls'
import MapContextMenu, { type MapMenuPoint } from './MapContextMenu'
import PlotPanel from './PlotPanel'
import FieldPicker from './FieldPicker'
import StatusList from './StatusList'

// The flight screen, arranged as Mission Planner arranges it: one panel
// pinned left at a fixed aspect ratio, the controls and messages filling the
// space beneath it, and the other panel taking the full height on the right.
//
// The two columns are the same height by construction, so dragging the
// divider widens the left one, which makes its fixed-aspect panel taller,
// which the stack underneath absorbs. Swap exchanges which panel is pinned;
// whichever lands on the left inherits the aspect rule.
export default function FlightTab() {
  const phase = useConnectionStore((s) => s.phase)
  const [follow, setFollow] = useState(true)
  const [menu, setMenu] = useState<MapMenuPoint | null>(null)
  const [target, setTarget] = useState<{ lat: number; lon: number } | null>(null)
  const [home, setHomePin] = useState<{ lat: number; lon: number } | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const gridRef = useRef<HTMLDivElement>(null)
  const layout = useFlightLayoutStore()

  if (phase !== 'connected' && phase !== 'linkLost') {
    return (
      <LaCard title="Flight" note="Connect a vehicle (or start demo mode) to fly.">
        <p className="app-placeholder">
          Live map with vehicle trail, artificial horizon, status messages, and guided
          click-to-go.
        </p>
      </LaCard>
    )
  }

  const mapPanel = (
    <MapView
      follow={follow}
      onFollowChange={setFollow}
      onContextMenu={setMenu}
      target={target}
      home={home}
    />
  )
  const hudPanel = <Hud horizon={layout.hudHorizon} overlays={layout.hudOverlays} />

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
      className={`flight-grid${fillVisible ? '' : ' flight-grid--single'}`}
      ref={gridRef}
      style={{ '--split': `${(layout.ratio * 100).toFixed(2)}%` } as React.CSSProperties}
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
      <div className="flight-grid__below">
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
function LogPane({
  pane,
  onPane,
  plotted,
  onTogglePlot,
}: {
  pane: 'messages' | 'status'
  onPane: (p: 'messages' | 'status') => void
  plotted: readonly string[]
  onTogglePlot: (name: string) => void
}) {
  return (
    <div className="log-pane">
      <div className="log-pane__head" role="tablist" aria-label="Lower pane">
        <button
          type="button"
          role="tab"
          aria-selected={pane === 'messages'}
          className={`log-pane__tab${pane === 'messages' ? ' is-active' : ''}`}
          onClick={() => onPane('messages')}
        >
          Messages
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={pane === 'status'}
          className={`log-pane__tab${pane === 'status' ? ' is-active' : ''}`}
          onClick={() => onPane('status')}
        >
          Status
        </button>
      </div>
      {pane === 'messages' ? (
        <FlightMessages />
      ) : (
        <StatusList plotted={plotted} onTogglePlot={onTogglePlot} />
      )}
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
    <textarea
      ref={logRef}
      className="la-log flight-log"
      readOnly
      aria-label="Status messages"
      value={statusTexts.map((s) => s.text).join('\n')}
    />
  )
}
