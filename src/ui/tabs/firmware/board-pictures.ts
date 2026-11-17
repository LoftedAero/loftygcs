// What the setup wizard shows for each Lofted Aero board, keyed on the
// catalog's board id. It ships with the app rather than with the catalog, so
// nothing downloaded is put on screen as instructions.

// A KiCad render of the board with its production blue solder mask, the
// shadow and background removed (transparent, for either theme).
import srxTop from './boards/f405-srx-top.webp'

/** A spot to point at, in the picture's own 1000-wide coordinates. */
export interface Mark {
  x: number
  y: number
  /** The part's name, drawn beside the ring on that side. */
  label?: { text: string; side: 'left' | 'right' }
}

export interface BoardPicture {
  src: string
  /** Width over height of the image file. */
  aspect: number
}

export interface BoardGuide {
  top: BoardPicture
  /** Pointed at on the top view while the board is put into DFU. */
  dfuMarks: Mark[]
  /** Pointed at on the top view when USB must be reconnected. */
  usbMark: Mark
  /** What to do to get the board into DFU, one line each. */
  prepare: string[]
}

const SRX_ASPECT = 1000 / 394

const GUIDES: Record<string, BoardGuide> = {
  'f405-srx': {
    top: { src: srxTop, aspect: SRX_ASPECT },
    // SW101. The USB socket needs no pointing out to plug a cable in.
    dfuMarks: [{ x: 534, y: 246, label: { text: 'DFU', side: 'left' } }],
    usbMark: { x: 638, y: 60, label: { text: 'USB', side: 'right' } },
    // The GPS port (PA10) is a ROM bootloader UART, and a GPS talking on it
    // keeps the ROM from picking USB DFU. Servo power is off for the whole
    // setup because rev A latches the servo rail onto USB power when servo
    // power goes first.
    prepare: ['Remove servo power and unplug the GPS.', 'Hold the DFU button and connect USB.'],
  },
}

export function boardGuide(boardId: string): BoardGuide | null {
  return GUIDES[boardId] ?? null
}
