import { LaButton, LaSwitch } from '../../components/La'
import { useFlightLayoutStore } from '../../../stores/flight-layout-store'
import { usePreferencesStore } from '../../../stores/preferences-store'

// Flight window layout switches, as a tab of the lower pane. Keeping them off
// the command bar leaves that bar for commands to the vehicle, and the pane
// has room for the groups to sit side by side.

/** The callouts' master switch, within reach in flight (Preferences has the rest). */
function SoundGroup() {
  const enabled = usePreferencesStore((s) => s.voice.enabled)
  const setEnabled = usePreferencesStore((s) => s.setVoiceEnabled)
  return (
    <section className="view-pane__group">
      <h4 className="view-pane__head">Sound</h4>
      <LaSwitch label="Callouts" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
    </section>
  )
}

/** `compact` keeps only the layers; compact Fly has no panels to arrange. */
export default function ViewPane({ compact = false }: { compact?: boolean }) {
  const layout = useFlightLayoutStore()
  if (compact) {
    return (
      <div className="view-pane">
        <section className="view-pane__group">
          <h4 className="view-pane__head">HUD layers</h4>
          <LaSwitch
            label="Horizon"
            checked={layout.hudHorizon}
            onChange={() => layout.toggle('hudHorizon')}
          />
          <LaSwitch
            label="Instruments"
            checked={layout.hudOverlays}
            onChange={() => layout.toggle('hudOverlays')}
          />
        </section>
        <section className="view-pane__group">
          <h4 className="view-pane__head">Map layers</h4>
          <LaSwitch
            label="ADS-B traffic"
            checked={layout.showTraffic}
            onChange={() => layout.toggle('showTraffic')}
          />
        </section>
        <SoundGroup />
      </div>
    )
  }
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
        {/* A map overlay rather than a panel. On by default, since without
            a receiver it draws nothing. */}
        <h4 className="view-pane__head">Map layers</h4>
        <LaSwitch
          label="ADS-B traffic"
          checked={layout.showTraffic}
          disabled={!layout.showMap}
          onChange={() => layout.toggle('showTraffic')}
        />
      </section>

      <SoundGroup />

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
