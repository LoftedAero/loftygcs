import LiveVehiclePanel from './LiveVehiclePanel'

// The landing screen: what the vehicle is doing right now, in the shape of
// Betaflight's setup tab. Configuration lives in the rail beside it, so this
// stays a status screen rather than another form.
//
// It draws with or without a vehicle, for the reason the Fly screen does:
// this was a card describing what the screen would have shown, which is a
// worse answer to "what is this" than the screen itself. Readouts with
// nothing behind them read as null rather than as zero -- see `Stat` -- so
// the panel says "no data" everywhere instead of quietly claiming a
// disarmed aircraft with no satellites.
//
// Nothing is said about being disconnected except in the model's own well,
// where the absence is already visible. A banner above the panel said it a
// second time, in the largest object on a page about the vehicle, which is
// the habit the description it replaced had.
export default function OverviewTab() {
  return <LiveVehiclePanel />
}
