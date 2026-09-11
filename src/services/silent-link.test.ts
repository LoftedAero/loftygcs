import { describe, expect, it } from 'vitest'
import { describeSilentLink } from './link-error'

// A port that opens and then says nothing is the most confusing failure the
// browser build has, because Chrome's port chooser is the browser's own
// dialog and labels neither of a flight controller's two ports. The message
// is the only place the app can say which one to pick, so which message
// comes out is pinned here.

describe('a serial link that opened and went quiet', () => {
  it('names the likely wrong port when the vendor is a flight controller', () => {
    // 0x1209 is what the bench Cube enumerates as (VID_1209&PID_5740), and
    // its MAVLink and SLCAN interfaces share it -- which is exactly why the
    // vendor is all this can go on.
    const said = describeSilentLink({ usbVendorId: 0x1209, usbProductId: 0x5740 })
    expect(said).toMatch(/MAVLink/)
    expect(said).toMatch(/SLCAN/)
  })

  it('covers the other flight-controller vendors seen on hardware', () => {
    for (const vendor of [0x2dae, 0x26ac]) {
      expect(describeSilentLink({ usbVendorId: vendor })).toMatch(/MAVLink/)
    }
  })

  it('stays generic for anything else, rather than guessing at SLCAN', () => {
    // An FTDI cable with nothing on the end of it is not a Cube, and being
    // told to pick the MAVLink port would send someone looking for a port
    // that does not exist.
    const said = describeSilentLink({ usbVendorId: 0x0403, usbProductId: 0x6001 })
    expect(said).toMatch(/No heartbeat/)
    expect(said).not.toMatch(/SLCAN/)
  })

  it('stays generic when the port will not say what it is', () => {
    // getInfo() is allowed to report nothing, and an unknown port is not
    // evidence of anything.
    expect(describeSilentLink(undefined)).toMatch(/No heartbeat/)
    expect(describeSilentLink({})).toMatch(/No heartbeat/)
  })
})
