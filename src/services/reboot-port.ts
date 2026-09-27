// Which serial port to reopen after a reboot.
//
// A flight controller often exposes several USB serial ports with the same
// ids: a Cube Orange has a MAVLink port and an SLCAN port, both 2dae:1016.
// Web Serial offers no port name or interface number to tell them apart, and
// a reboot re-enumerates both as new port objects.
//
// The board enumerates its ports in the same order each time, so the port
// picked by hand is found again by its position among its siblings. The rest
// follow as fallbacks: a stale port that will not open is skipped, and one
// that opens but sends no heartbeat is skipped on the next try.

/** Ports sharing this port's USB ids, in the order the platform lists them. */
export function siblingsOf(ports: readonly SerialPort[], held: SerialPort): SerialPort[] {
  const want = held.getInfo()
  if (want.usbVendorId === undefined) return []
  return ports.filter((p) => {
    const info = p.getInfo()
    return info.usbVendorId === want.usbVendorId && info.usbProductId === want.usbProductId
  })
}

/**
 * The ports to try, in order, after a reboot.
 *
 * `rank` is where the port picked by hand sat among its siblings when it was
 * opened; `skip` counts reopened ports that opened but sent no heartbeat
 * during this reboot. Every sibling appears once, starting from the preferred.
 */
export function rebootCandidates(
  siblings: readonly SerialPort[],
  rank: number,
  skip: number,
): SerialPort[] {
  const n = siblings.length
  if (n === 0) return []
  const start = (((rank + skip) % n) + n) % n
  return siblings.map((_, i) => siblings[(start + i) % n]!)
}
