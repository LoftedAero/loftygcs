// Which serial port to reopen after a reboot.
//
// A flight controller is often several USB serial ports under one set of ids:
// a Cube Orange is a MAVLink port and an SLCAN port, both 2dae:1016. Web Serial
// gives the page nothing else to tell them apart by -- no port name, no
// interface number -- and a reboot re-enumerates both as new port objects
// (traced on a Cube with LOFTGCS_DEBUG_SERIAL: COM36 and COM38 removed, then
// re-added 0.4 s later under new ids). The reconnect used to take the newest
// match, which on that board was the SLCAN port: it opened, never sent a
// heartbeat, and the app sat on "Rebooting" for 45 s before reporting that
// nothing had answered.
//
// What does survive is order: the board announces its ports in the same order
// each time it enumerates, so the port picked by hand is found again by its
// position among its siblings. That is the first candidate; the rest follow,
// so a stale object that can no longer open is stepped over, and a port that
// opens but says nothing is skipped on the next try -- the backstop if some
// platform lists siblings differently.

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
