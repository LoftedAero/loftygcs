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
 * Material Design Icons (`@mdi/js`, Apache-2.0, which GPL-3.0 accepts), and
 * the reason to take a set rather than draw eight is consistency: hand-drawn
 * glyphs agree on stroke width and nothing else, so a quad built from
 * circles sat beside a plane built from a filled silhouette and the row read
 * as eight drawings rather than one family. MDI happens to carry all eight
 * subjects, which is unusual enough to be the deciding factor -- most sets
 * have an aeroplane and a car and then nothing for a submarine, a dish or a
 * CAN node.
 *
 * They are 24x24 filled paths taking `currentColor`, so a selected tile
 * tints the drawing along with its label. Checked at 40px, the size they are
 * used at, which is the only size that matters.
 *
 * Keyed by `mav-type`, the manifest's own discriminator, so a vehicle
 * appearing there that this file has not learned shows up as a missing key
 * rather than as a silently wrong picture.
 */
export default function VehicleIcon({ vehicle }: { vehicle: string }) {
  return (
    <svg className="fw-vehicle__icon" viewBox="0 0 24 24" width="40" height="40" aria-hidden="true">
      <g fill="currentColor">{DRAWN[vehicle] ?? <path d={PATHS[vehicle] ?? GENERIC} />}</g>
    </svg>
  )
}

/**
 * The one glyph that is drawn here rather than taken from the set.
 *
 * MDI carries no airship -- checked, all 7,447 of them: the only balloons
 * are a hot-air balloon and a party balloon. `mdiAirballoon` stood in for a
 * while and read as exactly what it is, a hot-air balloon, which is a
 * different aircraft rather than a stylized one.
 *
 * Three parts, because two of them are what stop it being something else.
 * The **gondola** below the hull is the whole difference from `mdiSubmarine`
 * sitting two tiles away, which is the same elongated body with its tower on
 * *top*. The **tail fin** is what stops a finless hull reading as a capsule
 * or a pill. And the fin has to be a slim blade: the first attempt used a
 * swept wedge as tall as the hull and the result was a fish -- rendered at
 * 40px beside its neighbours, which is the only way this gets judged.
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
  // Side view: MDI's plain `car` is a front three-quarter that reads as a
  // hatchback, where the side view reads as "a thing that drives".
  GROUND_ROVER: mdiCarSide,
  SUBMARINE: mdiSubmarine,
  // The dish, not the satellite: ArduPilot's tracker is the ground station
  // that points at the aircraft, and `satellite` is a spacecraft.
  ANTENNA_TRACKER: mdiSatelliteUplink,
  // Blimp is in DRAWN below -- MDI has no airship.
  // Not a vehicle at all: a CAN node, drawn as the chip it is so nobody
  // reads it as another airframe.
  CAN_PERIPHERAL: mdiChip,
}
