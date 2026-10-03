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
import Hud, { type HudProps } from './Hud'
import type { HudAvoid } from './hud-paint'
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
import { LaButton } from '../../components/La'
import { useCompact } from '../../compact'
import CommandStrip from './CommandStrip'
import FlightSheet, { sectionLabel, type SheetSection } from './FlightSheet'
import BottomSheet from '../../components/BottomSheet'
import { videoService, type VideoStatus } from '../../../services/video'

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
  // Compact mode draws the HUD differently in the inset and full screen.
  const hud = (props: Partial<HudProps>) => (
    <Hud
      horizon={layout.hudHorizon}
      overlays={layout.hudOverlays}
      onContextMenu={setHudMenu}
      {...props}
    />
  )

  if (compact) {
    return <CompactFlight mapPanel={mapPanel} hud={hud} menus={menus} />
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
  function menus(onVideo = showVideoPane) {
    return (
      <>
        {hudMenu && (
          <HudContextMenu point={hudMenu} onClose={() => setHudMenu(null)} onVideo={onVideo} />
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
 * Compact mode's Fly screen, after QGroundControl's: the map or the video
 * fills the window and the other sits in a picture-in-picture inset that a
 * tap swaps in. Arm sits over the bottom; modes, readings and messages are in
 * the app bar. Adjustments, camera, video, joystick and the rest are in a
 * sheet that rises from the bottom.
 *
 * The desktop layout's pinned panel is the inset, so the two layouts share
 * `aspectPanel`: pinning the HUD on the desktop means the map fills here.
 */
function CompactFlight({
  mapPanel,
  hud,
  menus,
}: {
  mapPanel: React.ReactNode
  hud: (props: Partial<HudProps>) => React.ReactNode
  /** The context menus, given what their HUD video item opens. */
  menus: (onVideo: () => void) => React.ReactNode
}) {
  const layout = useFlightLayoutStore()
  const [sheet, setSheet] = useState(false)
  const [section, setSection] = useState<SheetSection>('controls')
  const [insetShown, setInsetShown] = useState(true)
  const [video, setVideo] = useState<VideoStatus>(videoService.current)
  useEffect(() => videoService.onStatus(setVideo), [])

  const open = (s?: SheetSection) => {
    if (s) setSection(s)
    setSheet(true)
  }

  const videoMain = layout.aspectPanel === 'map'
  const hudOn = layout.hudHorizon || layout.hudOverlays

  // What lies over the full-screen HUD, measured so it keeps its readings
  // clear: the map inset or the button that brings it back, the sheet's
  // handle, and the command row.
  const mainRef = useRef<HTMLDivElement>(null)
  const insetRef = useRef<HTMLDivElement>(null)
  const insetShowRef = useRef<HTMLButtonElement>(null)
  const handleRef = useRef<HTMLButtonElement>(null)
  const commandsRef = useRef<HTMLDivElement>(null)
  const [avoid, setAvoid] = useState<HudAvoid | null>(null)
  // The command row comes and goes with these, and the measurement below has
  // to see it do so.
  useConnectionStore((s) => s.phase === 'connected')
  useVehicleStore((s) => s.armed)
  useEffect(() => {
    const main = mainRef.current
    if (!videoMain || !main) {
      setAvoid(null)
      return
    }
    const measure = () => {
      const m = main.getBoundingClientRect()
      const box = (el: HTMLElement | null) => el?.getBoundingClientRect() ?? null
      const inset = box(insetRef.current ?? insetShowRef.current)
      const handle = box(handleRef.current)
      const commands = box(commandsRef.current)
      const next: HudAvoid = {
        bottomLeft: inset && { w: inset.right - m.left, h: m.bottom - inset.top },
        bottomRight: handle && { w: m.right - handle.left, h: m.bottom - handle.top },
        bottomCenter: commands && { w: commands.width, h: m.bottom - commands.top },
      }
      // Only a change re-renders, since this runs after every render.
      setAvoid((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
    }
    const ro = new ResizeObserver(measure)
    const covering = [
      insetRef.current,
      insetShowRef.current,
      handleRef.current,
      commandsRef.current,
    ]
    for (const el of [main, ...covering]) {
      if (el) ro.observe(el)
    }
    measure()
    return () => ro.disconnect()
    // The command row mounts and unmounts with the link and arm state; its
    // observer is renewed with each re-run.
  })

  // Too small for the overlay to be read: a faint horizon (none over video,
  // which shows the real one) and the speed and altitude.
  const insetHud = hud({ mini: true, horizon: video.state !== 'playing' })
  // With the sheet up the readings would lie half under it, with Arm and the
  // handle over the rest, so the full-screen HUD draws its horizon alone, as
  // the inset does. The app bar still has the readings that matter.
  const mainHud = hud(sheet ? { overlays: false } : { avoid })
  return (
    <div
      className={['flight-compact', videoMain ? 'flight-compact--video' : '']
        .filter(Boolean)
        .join(' ')}
    >
      <div className="flight-compact__main" ref={mainRef}>
        {videoMain ? mainHud : mapPanel}
      </div>

      {videoMain && !hudOn && video.state !== 'playing' && (
        <div className="flight-compact__novideo">
          <p>{video.text || 'No video'}</p>
          <LaButton variant="secondary" onClick={() => open('video')}>
            Video settings
          </LaButton>
        </div>
      )}

      {insetShown ? (
        <div className="flight-compact__inset" ref={insetRef}>
          {videoMain ? mapPanel : insetHud}
          {/* Over the panel, so a tap swaps rather than reaching the map. */}
          <button
            type="button"
            className="flight-compact__inset-tap"
            aria-label={videoMain ? 'Show the map' : 'Show the video'}
            onClick={layout.swap}
          />
          <button
            type="button"
            className="flight-compact__inset-hide"
            aria-label="Hide the inset"
            onClick={() => setInsetShown(false)}
          >
            ×
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="flight-compact__inset-show"
          ref={insetShowRef}
          onClick={() => setInsetShown(true)}
        >
          {videoMain ? 'Show map' : 'Show video'}
        </button>
      )}

      {/* The rest rises from the bottom, as Plan's items do. The command
          row rides up with the sheet, so Disarm stays in reach; the handle, a
          caret alone so it stays out of the view's way, sits to its right,
          since Arm has the middle. The sections mount only while open, since
          they poll and subscribe. */}
      <BottomSheet
        id="flight-sheet-body"
        className="flight-dock"
        align="right"
        name={sectionLabel(section)}
        open={sheet}
        onOpen={setSheet}
        handleRef={handleRef}
        row={<CommandStrip ref={commandsRef} />}
      >
        <FlightSheet section={section} onSection={setSection} />
      </BottomSheet>
      {menus(() => open('video'))}
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
