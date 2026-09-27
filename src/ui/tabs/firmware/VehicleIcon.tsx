import type { ReactNode } from 'react'
import {
  mdiAirplane,
  mdiCarSide,
  mdiChip,
  mdiHelicopter,
  mdiQuadcopter,
  mdiSatelliteUplink,
  mdiSubmarine,
} from '@mdi/js'

/**
 * The eight ArduPilot vehicle types as symbols, Mission Planner's arrangement.
 *
 * Material Design Icons (`@mdi/js`, Apache-2.0, compatible with GPL-3.0),
 * chosen for a consistent family; MDI covers all but one of the subjects.
 * 24x24 filled paths taking `currentColor`, drawn at 40px.
 *
 * Keyed by the manifest's `mav-type`; an unknown type gets a generic chip.
 */
export default function VehicleIcon({ vehicle }: { vehicle: string }) {
  return (
    <svg className="fw-vehicle__icon" viewBox="0 0 24 24" width="40" height="40" aria-hidden="true">
      <g fill="currentColor">{DRAWN[vehicle] ?? <path d={PATHS[vehicle] ?? GENERIC} />}</g>
    </svg>
  )
}

/**
 * Glyphs drawn here because MDI has no airship (only hot-air and party
 * balloons).
 *
 * The blimp is hull, tail fin and gondola. The gondola underneath tells it
 * from `mdiSubmarine`, whose tower is on top; a slim fin keeps the hull from
 * reading as a capsule without turning it into a fish.
 */
const DRAWN: Record<string, ReactNode> = {
  Blimp: (
    <>
      <path d="M2 9.4C2 6.5 5.9 4.3 10.6 4.3c4.7 0 8.6 2.2 8.6 5.1s-3.9 5.1-8.6 5.1C5.9 14.5 2 12.3 2 9.4Z" />
      <path d="M18.2 5.6h1.5l2.3 3.8-2.3 3.8h-1.5Z" />
      <path d="M8.1 13.8h5v1.8a1.6 1.6 0 0 1-1.6 1.6H9.7a1.6 1.6 0 0 1-1.6-1.6Z" />
    </>
  ),
}

/** Anything the manifest gains that this file has not learned yet. */
const GENERIC = mdiChip

const PATHS: Record<string, string> = {
  Copter: mdiQuadcopter,
  HELICOPTER: mdiHelicopter,
  FIXED_WING: mdiAirplane,
  // Side view; MDI's plain `car` reads as a hatchback.
  GROUND_ROVER: mdiCarSide,
  SUBMARINE: mdiSubmarine,
  // A dish: the tracker is a ground antenna pointing at the aircraft.
  ANTENNA_TRACKER: mdiSatelliteUplink,
  // Blimp is in DRAWN above.
  // A CAN node, not a vehicle.
  CAN_PERIPHERAL: mdiChip,
}
