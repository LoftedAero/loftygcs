import { ORIENTATIONS, type OrientationId } from '../../../protocol/cal-orientation'
import { useVehicleStore } from '../../../stores/vehicle-store'
import planeSheet from './cal-attitudes-plane.png'
import f35bSheet from './cal-attitudes-f35b.png'

// Six attitude tiles, shared by the compass and accelerometer calibrations.
//
// The pictures are a sprite sheet pre-rendered from the real model
// (`npm run cal-art`, scripts/make-cal-art.mjs), since a WebGL context is not
// worth it for six small static images. Frames are in `ORIENTATIONS` order,
// so the orientation index is the frame number.

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
    : // The airplane even for a multirotor: a flat quad on its side is an
      // unreadable sliver, while a wing and fin read in all six attitudes.
      { url: planeSheet, credit: true }
}

/**
 * The requested turn about vertical, drawn on every attitude still to do
 * (faint until its tile is active). The arc is in earth frame, so one shape
 * fits all six pictures.
 */
function SpinArrow() {
  // Behind the aircraft, as the path it travels.
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
              {/* Every tile reserves the bar's space so the row does not jump;
                  the empty one is a hidden spacer, not a progressbar. */}
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
      {/* The biplane is CC-BY-4.0 and a rendering of it still needs the
          credit. See src/models/ATTRIBUTION.md. */}
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
