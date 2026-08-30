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

// The flight screen. Two panels the user arranges -- resize, swap, or turn
// either off so the survivor fills the window -- with the commands that get
// used in the air along the top and the messages log along the bottom.
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

  const mapPanel = (
    <MapView
      follow={follow}
      onContextMenu={setMenu}
      target={target}
      home={home}
    />
  )
  const hudPanel = <Hud horizon={layout.hudHorizon} overlays={layout.hudOverlays} />

  const first = layout.first === 'map' ? mapPanel : hudPanel
  const second = layout.first === 'map' ? hudPanel : mapPanel
  // Which slot survives when the other panel is switched off.
  const only =
    layout.showMap && layout.showHud
      ? undefined
      : layout.showMap
        ? layout.first === 'map'
          ? ('first' as const)
          : ('second' as const)
        : layout.first === 'hud'
          ? ('first' as const)
          : ('second' as const)

  return (
    <div className="flight-screen">
      <FlightActionsBar />

      <div className="flight-toolbar la-row la-row--wrap">
        <LaSwitch
          label="Follow"
          checked={follow}
          onChange={(e) => setFollow(e.target.checked)}
        />
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
        <LaButton variant="ghost" size="sm" onClick={layout.swap} disabled={only !== undefined}>
          Swap
        </LaButton>
        <LaButton
          variant="ghost"
          size="sm"
          onClick={() =>
            layout.setOrientation(layout.orientation === 'row' ? 'column' : 'row')
          }
          disabled={only !== undefined}
        >
          {layout.orientation === 'row' ? 'Stack' : 'Side by side'}
        </LaButton>
        <LaButton variant="ghost" size="sm" onClick={layout.reset}>
          Reset layout
        </LaButton>
      </div>

      <div className="flight-panels">
        <SplitPane
          orientation={layout.orientation}
          ratio={layout.ratio}
          onRatio={layout.setRatio}
          first={first}
          second={second}
          only={only}
        />
      </div>

      {layout.showMessages && <FlightMessages />}

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
