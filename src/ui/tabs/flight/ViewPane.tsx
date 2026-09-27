import { LaButton, LaSwitch } from '../../components/La'
import { useFlightLayoutStore } from '../../../stores/flight-layout-store'

// How the flight window is arranged, as a pane rather than a flyout.
//
// These switches have moved twice. They were a strip of six across the top,
// which gave arranging the window the same weight as flying the aircraft;
// then a "View ▾" menu, which fixed that but left one control on the
// command bar doing something no other control there does -- everything
// beside it commands the vehicle, and this one moves furniture.
//
// The lower pane is where a second thing goes, and this is a second thing:
// something you look at and set in the space under the controls, one at a
// time, exactly like Messages and Preflight. It also gets room a 210px
// flyout never had, so the groups can sit side by side instead of stacking
// into a column taller than the screen.

export default function ViewPane() {
  const layout = useFlightLayoutStore()
  return (
    <div className="view-pane">
      <section className="view-pane__group">
        <h4 className="view-pane__head">Panels</h4>
        <LaSwitch label="Map" checked={layout.showMap} onChange={() => layout.toggle('showMap')} />
        <LaSwitch label="HUD" checked={layout.showHud} onChange={() => layout.toggle('showHud')} />
        <LaSwitch
          label="Messages"
          checked={layout.showMessages}
          onChange={() => layout.toggle('showMessages')}
        />
        <LaSwitch
          label="Plot"
          checked={layout.showPlot}
          onChange={() => layout.toggle('showPlot')}
        />
      </section>

      <section className="view-pane__group">
        <h4 className="view-pane__head">HUD layers</h4>
        <LaSwitch
          label="Horizon"
          checked={layout.hudHorizon}
          disabled={!layout.showHud}
          onChange={() => layout.toggle('hudHorizon')}
        />
        <LaSwitch
          label="Instruments"
          checked={layout.hudOverlays}
          disabled={!layout.showHud}
          onChange={() => layout.toggle('hudOverlays')}
        />
      </section>

      <section className="view-pane__group">
        {/* A map layer, not a panel: it draws over the map rather than
            taking room from anything. On by default, because a vehicle with
            no receiver draws nothing anyway -- the switch is for the field
            where the sky is busy and the markers are over the plan. */}
        <h4 className="view-pane__head">Map layers</h4>
        <LaSwitch
          label="ADS-B traffic"
          checked={layout.showTraffic}
          disabled={!layout.showMap}
          onChange={() => layout.toggle('showTraffic')}
        />
      </section>

      <section className="view-pane__group">
        <h4 className="view-pane__head">Arrangement</h4>
        <div className="view-pane__actions">
          <LaButton variant="secondary" onClick={layout.swap}>
            Swap panels
          </LaButton>
          <LaButton variant="ghost" onClick={layout.reset}>
            Reset
          </LaButton>
        </div>
      </section>
    </div>
  )
}
