import type { ReactNode } from 'react'
import { mdiAirplane, mdiAxisArrow } from '@mdi/js'

/**
 * The firmware Lofted Aero publishes, as tiles in the order the card shows
 * them. Keyed by the catalog's firmware option id. The tiles ship with the app
 * and the catalog only says which a board has, so a board without one shows
 * it dimmed and the strip keeps its shape; an id the app does not know is not
 * offered until the app learns it.
 */
export const PRODUCTS: { id: string; label: string }[] = [
  { id: 'ardupilot', label: 'ArduPlane' },
  { id: 'stabrx', label: 'StabRX' },
  { id: 'f35b-70', label: 'F-35B 70mm' },
  { id: 'f35b-90', label: 'F-35B 90mm' },
]

/** What the app calls a firmware option, whatever the catalog names it. */
export function productLabel(option: { id: string; name: string }): string {
  return PRODUCTS.find((p) => p.id === option.id)?.label ?? option.name
}

/** Drawn at the Firmware card's vehicle icon size, in `currentColor`. */
export function ProductIcon({ id }: { id: string }) {
  return (
    <svg className="fw-vehicle__icon" viewBox="0 0 24 24" width="40" height="40" aria-hidden="true">
      <g fill="currentColor">{DRAWN[id] ?? <path d={PATHS[id] ?? mdiAirplane} />}</g>
    </svg>
  )
}

const PATHS: Record<string, string> = {
  ardupilot: mdiAirplane,
  // Three axes: StabRX is the gyro build.
  stabrx: mdiAxisArrow,
}

/**
 * MDI has no fighter. The F-35B's top view, traced from the app's own model
 * (src/models/f35b.glb, Lofted Aero's CAD) and simplified to 0.06 units, nose
 * up. Both sizes share it; the label tells them apart.
 */
const F35B = (
  <path d="M12 1.5 12.46 2.38 12.6 2.87 13.07 6.71 13.35 7.73 13.98 7.2 14.24 7.59 14.37 10.94 14.83 11.92 19.15 14.85 19.15 16.94 18.31 17.15 14.45 18.12 14.65 18.58 16.62 19.9 16.62 21.7 13.43 22.5 13.15 20.54 12.78 19.48 12.59 20.07 12.42 20.1 11.42 20.09 11.27 19.51 11.18 19.49 10.83 20.57 10.58 22.5 7.36 21.7 7.36 19.9 9.29 18.62 9.54 18.12 5.67 17.15 4.84 16.94 4.84 14.85 9.08 12 9.61 11 9.77 7.52 9.99 7.18 10.63 7.73 10.91 6.78 11.37 2.94 11.51 2.43Z" />
)

const DRAWN: Record<string, ReactNode> = {
  'f35b-70': F35B,
  'f35b-90': F35B,
}
