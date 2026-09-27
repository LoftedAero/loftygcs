import { describe, expect, it } from 'vitest'
import { describeSilentLink } from './link-error'

// A port that opens and then says nothing is usually the wrong one of a
// flight controller's ports, and Chrome's chooser does not label them, so the
// message has to say which to pick.

describe('a serial link that opened and went quiet', () => {
  it('names the likely wrong port when the vendor is a flight controller', () => {
    // A Cube enumerates as VID_1209&PID_5740, shared by its MAVLink and SLCAN
    // interfaces, so the vendor is all this can go on.
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
    // An FTDI cable is not a Cube, so there is no MAVLink port to suggest.
    const said = describeSilentLink({ usbVendorId: 0x0403, usbProductId: 0x6001 })
    expect(said).toMatch(/No heartbeat/)
    expect(said).not.toMatch(/SLCAN/)
  })

  it('stays generic when the port will not say what it is', () => {
    // getInfo() may report nothing.
    expect(describeSilentLink(undefined)).toMatch(/No heartbeat/)
    expect(describeSilentLink({})).toMatch(/No heartbeat/)
  })
})
