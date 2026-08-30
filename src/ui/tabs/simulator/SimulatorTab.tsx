import { LaCard } from '../../components/La'
import { isElectron } from '../../../env'
import SimulatorCard from '../overview/SimulatorCard'

// Running a simulator is its own activity -- not configuring a vehicle, not
// flying one -- so it sits alongside Setup, Fly and Mission rather than
// buried in a tab.
export default function SimulatorTab() {
  if (!isElectron()) {
    return (
      <LaCard title="Simulator" note="Running a simulator needs the desktop app.">
        <p className="app-placeholder">
          The desktop build downloads and runs ArduPilot SITL for you, then connects to it — real
          firmware, the full parameter set, real arming checks. A browser cannot start a process
          or open the raw TCP socket SITL listens on.
        </p>
        <p className="app-placeholder">
          From a browser you can still reach a simulator someone else is running, if it is exposed
          through a WebSocket bridge such as mavlink-server: choose WebSocket in the connection
          menu at the top. Otherwise, Demo mode on the Overview tab needs nothing at all.
        </p>
      </LaCard>
    )
  }
  return <SimulatorCard />
}
