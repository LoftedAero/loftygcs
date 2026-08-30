import { useEffect, useRef, useState } from 'react'
import { LaButton, LaCard, LaSwitch } from '../../components/La'
import { useConnectionStore } from '../../../stores/connection-store'
import { useVehicleStore } from '../../../stores/vehicle-store'
import { useFlightLayoutStore } from '../../../stores/flight-layout-store'
import { gotoGuided, setHome, setRoi } from '../../../services/flight'
import MapView from './MapView'
import Hud from './Hud'
import SplitPane from './SplitPane'
import FlightActionsBar from './FlightActionsBar'
import MapContextMenu, { type MapMenuPoint } from './MapContextMenu'

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

  const mapPanel = <MapView follow={follow} onContextMenu={setMenu} target={target} home={home} />
  const hudPanel = <Hud horizon={layout.hudHorizon} overlays={layout.hudOverlays} />

  const aspectIsHud = layout.aspectPanel === 'hud'
  const aspectVisible = aspectIsHud ? layout.showHud : layout.showMap
  const fillVisible = aspectIsHud ? layout.showMap : layout.showHud

  // The left column always exists -- it carries the controls and messages
  // even when the panel above them is switched off.
  const leftColumn = (
    <div className="flight-col">
      {aspectVisible && (
        <div className="flight-aspect">{aspectIsHud ? hudPanel : mapPanel}</div>
      )}
      <div className="flight-below">
        <FlightActionsBar />
        {layout.showMessages && <FlightMessages />}
      </div>
    </div>
  )

  const rightColumn = <div className="flight-fill">{aspectIsHud ? mapPanel : hudPanel}</div>

  return (
    <div className="flight-screen">
      <div className="flight-toolbar la-row la-row--wrap">
        <LaSwitch label="Follow" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
        <span className="flight-toolbar__sep" />
        <LaSwitch label="Map" checked={layout.showMap} onChange={() => layout.toggle('showMap')} />
        <LaSwitch label="HUD" checked={layout.showHud} onChange={() => layout.toggle('showHud')} />
        <LaSwitch
          label="Horizon"
          checked={layout.hudHorizon}
          disabled={!layout.showHud}
          onChange={() => layout.toggle('hudHorizon')}
        />
        <LaSwitch
          label="Overlays"
          checked={layout.hudOverlays}
          disabled={!layout.showHud}
          onChange={() => layout.toggle('hudOverlays')}
        />
        <LaSwitch
          label="Messages"
          checked={layout.showMessages}
          onChange={() => layout.toggle('showMessages')}
        />
        <span className="la-grow" />
        <LaButton variant="ghost" size="sm" onClick={layout.swap}>
          Swap
        </LaButton>
        <LaButton variant="ghost" size="sm" onClick={layout.reset}>
          Reset layout
        </LaButton>
      </div>

      <div className="flight-panels">
        <SplitPane
          ratio={layout.ratio}
          onRatio={layout.setRatio}
          first={leftColumn}
          second={rightColumn}
          only={fillVisible ? undefined : 'first'}
        />
      </div>

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
