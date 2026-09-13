import { ORIENTATIONS, type OrientationId } from '../../../protocol/cal-orientation'
import { useVehicleStore } from '../../../stores/vehicle-store'
import planeSheet from './cal-attitudes-plane.png'
import f35bSheet from './cal-attitudes-f35b.png'

// Six attitudes as six pictures: the shared part of both calibrations.
//
// **The aircraft is a picture of the real model, rendered ahead of time**
// (`npm run cal-art`, scripts/make-cal-art.mjs). Six hand-drawn silhouettes
// came first and were the weakest part of the screen: a vehicle on its side
// or nose down is hard to draw as a flat shape, and each view had to be
// authored separately, so the six looked like six different aircraft. These
// are the same airframe, in the same six attitudes and the same held yaw --
// but as a sprite sheet, because they are 72px and static, and a WebGL
// context plus a GLTF parse for that is a cost with nothing to show for it.
// Frames are in `ORIENTATIONS` order, which is what makes the index below the
// frame number.
//
// The accelerometer wizard drew a live three.js airframe here instead, turning
// to whichever side the vehicle asked for. It was the better picture and the
// worse screen: the same six attitudes are the subject of both calibrations,
// and showing them two different ways made two screens out of one idea. The
// tiles also say what the model could not -- which sides are done.

export interface AttitudeTile {
  /** Which attitude, and so which frame of the sheet. */
  id: OrientationId
  label: string
  done: boolean
  /** The one being worked on now. */
  here: boolean
  /** Draw the turn arrow: the compass asks for a rotation, the accelerometer does not. */
  spin: boolean
  /** 0..1 across the bar under the tile, or null for the reserved empty slot. */
  progress: number | null
}

/** Which sheet to draw. The F-35B when the vehicle said it is one. */
function useSheet() {
  const airframe = useVehicleStore((s) => s.airframe)
  return airframe === 'f35b'
    ? { url: f35bSheet, credit: false }
    : // Always the aircraft, whatever the vehicle is: a multirotor is nearly
      // flat, so on its side it is a sliver with no up or down to it, where a
      // wing and a fin read in all six.
      { url: planeSheet, credit: true }
}

/**
 * The turn being asked for: around the vertical, whichever way up it is.
 *
 * Drawn on every attitude that is still to do, not only the one in progress.
 * It is the *instruction* -- the same turn is wanted in all six -- and with it
 * on the active tile alone the other five looked like a different kind of
 * thing, as though only one of them involved turning. Faint until its tile is
 * the one being worked on.
 *
 * The ellipse is in earth frame and needs no variant per attitude: the
 * aircraft is rotated inside a world whose horizontal stays horizontal on
 * screen, so one arc lies in the plane of the turn in all six pictures.
 */
function SpinArrow() {
  // Behind the aircraft rather than under it, so it reads as the path the
  // vehicle travels rather than as a label stuck below the picture.
  return (
    <svg className="cal-att__spin" viewBox="0 0 72 72" aria-hidden="true">
      <path d="M12 50 A 24 10 0 1 0 56 44" fill="none" />
      <path d="M56 44 l-5 -4 l8 -2 Z" stroke="none" />
    </svg>
  )
}

export default function AttitudeTiles({ tiles }: { tiles: AttitudeTile[] }) {
  const sheet = useSheet()
  const frames = ORIENTATIONS.length
  return (
    <>
      <ol className="cal-att">
        {tiles.map((tile) => {
          const frame = ORIENTATIONS.findIndex((o) => o.id === tile.id)
          return (
            <li
              key={tile.id}
              className={`cal-att__tile${tile.done ? ' is-done' : ''}${tile.here ? ' is-here' : ''}`}
            >
              <span className="cal-att__art">
                {tile.spin && !tile.done && <SpinArrow />}
                <span
                  className="cal-att__craft"
                  style={{
                    backgroundImage: `url(${sheet.url})`,
                    // Six frames across: 0%, 20% … 100% lands on each in turn.
                    backgroundPositionX: `${(frame / (frames - 1)) * 100}%`,
                  }}
                />
              </span>
              <span className="cal-att__label">{tile.label}</span>
              {/* Progress without a word for it: the bar under the current
                  tile fills as the turns are made. Every tile keeps the space
                  for it, drawn or not -- otherwise the tile being worked on is
                  the one that grows, and the row jumps each time the highlight
                  moves. The empty one is a spacer and says so, rather than
                  being a progressbar announcing itself six times over. */}
              {tile.progress === null ? (
                <span className="cal-att__bar cal-att__bar--empty" aria-hidden="true" />
              ) : (
                <span
                  className="cal-att__bar"
                  role="progressbar"
                  aria-valuenow={Math.round(tile.progress * 100)}
                  aria-label={tile.label}
                >
                  <span
                    className="cal-att__bar-fill"
                    style={{ width: `${Math.min(100, tile.progress * 100)}%` }}
                  />
                </span>
              )}
            </li>
          )
        })}
      </ol>
      {/* CC-BY is owed for showing the biplane, and a rendering of it is still
          it. See src/models/ATTRIBUTION.md, which says to add a line anywhere
          else it appears -- this is the third. */}
      {sheet.credit && (
        <p className="la-card__note model-credit">
          Aircraft model:{' '}
          <a
            href="https://sketchfab.com/3d-models/low-poly-biplane-755175daea384176813e7dc90b2245a5"
            target="_blank"
            rel="noreferrer noopener"
          >
            Low-Poly Biplane
          </a>{' '}
          by lord_syrup, CC-BY-4.0, recolored.
        </p>
      )}
    </>
  )
}
