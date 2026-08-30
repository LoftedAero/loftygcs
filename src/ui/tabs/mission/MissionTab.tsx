import { LaCard } from '../../components/La'

// Waypoint planning. The mission transfer engine and map editing are the
// next phase; this states the shape so the mode is real in the nav rather
// than appearing later out of nowhere.
export default function MissionTab() {
  return (
    <div className="mission-empty">
      <LaCard title="Mission planning" note="Arriving in the next release.">
        <p className="app-placeholder">
          Click-to-place waypoints on the map, with altitude and command per point; upload and
          download to the vehicle; survey grids; and geofence and rally point editing through the
          same interface.
        </p>
        <p className="app-placeholder">
          The protocol work underneath — mission, fence, and rally transfer — shares one engine, so
          all three arrive together.
        </p>
      </LaCard>
    </div>
  )
}
