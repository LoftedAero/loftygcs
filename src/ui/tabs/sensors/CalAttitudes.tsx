import { ORIENTATIONS, TURNS_REQUIRED } from '../../../protocol/cal-orientation'
import { orientationDone, type MagCalState } from '../../../stores/cal-store'
import AttitudeTiles, { type AttitudeTile } from './AttitudeTiles'

// Six attitudes, spin each one twice.
//
// This is the instruction Mission Planner and QGroundControl both give, and
// the reason it beats a coverage sphere is that it is a *procedure* rather
// than a readout: six things to do, in order, each with an obvious physical
// action. The sphere told you the truth and left you to work out what to do
// with it.
//
// What the vehicle is doing now is measured rather than asked for -- see
// `cal-orientation.ts`. ArduPilot reports coverage as magnetic directions and
// has no notion of "you have done four of the six", so the tiles are driven
// from ATTITUDE, which every vehicle sends and which needs no magnetic model,
// no GPS fix and no calibration state.
export default function CalAttitudes({ magCal }: { magCal: MagCalState }) {
  const tiles: AttitudeTile[] = ORIENTATIONS.map((o) => {
    const done = orientationDone(magCal, o.id)
    const here = magCal.at === o.id && !done
    return {
      id: o.id,
      label: o.label,
      done,
      here,
      // The compass wants the vehicle turned about vertical in each attitude;
      // the accelerometer only wants it held still, which is why the arrow
      // belongs to this caller rather than to the tiles.
      spin: true,
      progress: here ? (magCal.turns[o.id] ?? 0) / (2 * Math.PI) / TURNS_REQUIRED : null,
    }
  })
  return <AttitudeTiles tiles={tiles} />
}
