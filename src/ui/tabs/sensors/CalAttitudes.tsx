import { ORIENTATIONS, TURNS_REQUIRED } from '../../../protocol/cal-orientation'
import { orientationDone, type MagCalState } from '../../../stores/cal-store'
import AttitudeTiles, { type AttitudeTile } from './AttitudeTiles'

// Six attitudes, spin each one twice.
//
// The procedure Mission Planner and QGroundControl both give: six attitudes,
// each an obvious physical action.
//
// ArduPilot reports compass coverage as magnetic directions, not attitudes,
// so the tiles are driven from ATTITUDE instead (see `cal-orientation.ts`),
// which needs no magnetic model, GPS fix or calibration state.
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
      // the accelerometer only wants it held still, so the caller supplies
      // the arrow.
      spin: true,
      progress: here ? (magCal.turns[o.id] ?? 0) / (2 * Math.PI) / TURNS_REQUIRED : null,
    }
  })
  return <AttitudeTiles tiles={tiles} />
}
