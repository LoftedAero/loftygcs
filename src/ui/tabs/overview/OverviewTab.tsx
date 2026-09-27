import LiveVehiclePanel from './LiveVehiclePanel'

// The landing screen: what the vehicle is doing right now, modeled on
// Betaflight's setup tab. Configuration lives in the rail beside it.
//
// It draws with or without a vehicle. Readouts with no data show as empty
// rather than zero (see `Stat`), so a disconnected panel does not claim a
// disarmed aircraft with no satellites.
export default function OverviewTab() {
  return <LiveVehiclePanel />
}
