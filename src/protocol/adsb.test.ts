import { describe, expect, it } from 'vitest'
import { bearingDeg, decodeAdsbVehicle, distanceM, targetLabel } from './adsb'
import { isClose, relativeTo } from '../stores/traffic-store'

// The flags are the whole test. A transponder report carries every field
// whatever the receiver actually knows, so the difference between a real
// number and noise is a bit, not a value -- and the failure mode of getting
// it wrong is an aeroplane drawn where there is none.

const report = (over: Record<string, unknown> = {}) => ({
  ICAOAddress: 0xa1b2c3,
  lat: 399500000,
  lon: -1052500000,
  altitudeType: 0,
  altitude: 1524000, // 1,524 m = 5,000 ft, in millimeters
  heading: 27000, // centidegrees
  horVelocity: 5144, // cm/s = 51.44 m/s = 100 kt
  verVelocity: -254, // cm/s, descending
  callsign: 'N172SP\0\0\0',
  emitterType: 1,
  tslc: 2,
  flags: 1 | 2 | 4 | 8 | 16 | 32 | 128,
  squawk: 1200,
  ...over,
})

describe('decoding a transponder report', () => {
  it('converts every unit out of the wire form', () => {
    const t = decodeAdsbVehicle(report(), 1000)!
    expect(t.latDeg).toBeCloseTo(39.95, 7)
    expect(t.lonDeg).toBeCloseTo(-105.25, 7)
    // Millimeters for altitude, centimeters for the velocities, centidegrees
    // for heading -- three different scales in one message.
    expect(t.altMslM).toBeCloseTo(1524, 3)
    expect(t.headingDeg).toBeCloseTo(270, 3)
    expect(t.groundSpeedMs).toBeCloseTo(51.44, 3)
    expect(t.climbMs).toBeCloseTo(-2.54, 3)
    expect(t.at).toBe(1000)
  })

  it('reads the ICAO address from the one key that is not camelCase', () => {
    // `ICAOAddress`, where every other field is `horVelocity` and friends.
    // A wrong key reads as undefined, and every aircraft in the sky then
    // shares identity 0 -- one target that teleports.
    expect(decodeAdsbVehicle(report())!.icao).toBe(0xa1b2c3)
  })

  it('drops a report with no valid position rather than placing it at zero', () => {
    // lat/lon are still populated here, as a real receiver populates them:
    // with whatever it last had. Trusting them is a phantom on the map.
    expect(decodeAdsbVehicle(report({ flags: 2 | 16 }))).toBeNull()
  })

  it('nulls each field whose flag is missing, rather than reporting noise', () => {
    const t = decodeAdsbVehicle(report({ flags: VALID_COORDS_ONLY }))!
    expect(t.altMslM).toBeNull()
    expect(t.headingDeg).toBeNull()
    expect(t.groundSpeedMs).toBeNull()
    expect(t.climbMs).toBeNull()
    expect(t.callsign).toBeNull()
    expect(t.squawk).toBeNull()
    // The position survives: that is the one thing the flag vouched for.
    expect(t.latDeg).toBeCloseTo(39.95, 7)
  })

  it('has a separate flag for vertical velocity, and honors it', () => {
    // A receiver can have an aircraft's ground track without its climb rate,
    // so VALID_VELOCITY does not imply the vertical one.
    const t = decodeAdsbVehicle(report({ flags: 1 | 8 }))!
    expect(t.groundSpeedMs).toBeCloseTo(51.44, 3)
    expect(t.climbMs).toBeNull()
  })

  it('trims the fixed-width callsign, and calls a blank one blank', () => {
    expect(decodeAdsbVehicle(report())!.callsign).toBe('N172SP')
    expect(decodeAdsbVehicle(report({ callsign: '   \0\0\0\0\0\0' }))!.callsign).toBeNull()
  })

  it('marks simulated traffic and surface objects for what they are', () => {
    expect(decodeAdsbVehicle(report({ flags: 1 | 64 }))!.simulated).toBe(true)
    expect(decodeAdsbVehicle(report())!.onSurface).toBe(false)
    // A point obstacle is a tower, not an aeroplane in the circuit.
    expect(decodeAdsbVehicle(report({ emitterType: 19 }))!.onSurface).toBe(true)
  })
})

const VALID_COORDS_ONLY = 1

describe('naming an aircraft', () => {
  it('prefers the callsign, then the squawk, then the address', () => {
    expect(targetLabel(decodeAdsbVehicle(report())!)).toBe('N172SP')
    expect(targetLabel(decodeAdsbVehicle(report({ flags: 1 | 32, squawk: 40 }))!)).toBe(
      'Squawk 0040',
    )
    // Six hex digits, uppercase: how an ICAO address is written.
    expect(targetLabel(decodeAdsbVehicle(report({ flags: 1 }))!)).toBe('A1B2C3')
  })
})

describe('where it is from here', () => {
  it('measures a distance against a known one', () => {
    // One degree of latitude is 111.19 km on a sphere of this radius.
    const d = distanceM({ latDeg: 39, lonDeg: -105 }, { latDeg: 40, lonDeg: -105 })
    expect(d).toBeCloseTo(111195, -2)
  })

  it('measures a bearing', () => {
    expect(bearingDeg({ latDeg: 39, lonDeg: -105 }, { latDeg: 40, lonDeg: -105 })).toBeCloseTo(0, 1)
    expect(bearingDeg({ latDeg: 39, lonDeg: -105 }, { latDeg: 38, lonDeg: -105 })).toBeCloseTo(
      180,
      1,
    )
  })

  it('gives the initial great-circle course, not the rhumb line', () => {
    // Due east along a parallel is 090 only at the equator. The great circle
    // to a point at the same latitude starts poleward of east and curves
    // back -- 89.7 at latitude 39. Asserting a flat 90 here would have been
    // asserting the wrong geometry, and a heading that is a third of a
    // degree off is the same shape of error as one that is thirty.
    const east = bearingDeg({ latDeg: 39, lonDeg: -105 }, { latDeg: 39, lonDeg: -104 })
    expect(east).toBeLessThan(90)
    expect(east).toBeCloseTo(89.69, 1)
    // Southern hemisphere: poleward is the other way, so it starts south.
    const south = bearingDeg({ latDeg: -39, lonDeg: -105 }, { latDeg: -39, lonDeg: -104 })
    expect(south).toBeGreaterThan(90)
  })
})

describe('the picture from here', () => {
  const own = { latDeg: 39.95, lonDeg: -105.25, altMslM: 1600 }
  const at = (icao: number, latDeg: number, altMslM: number) =>
    decodeAdsbVehicle(
      report({ ICAOAddress: icao, lat: Math.round(latDeg * 1e7), altitude: altMslM * 1000 }),
    )!

  it('sorts nearest first, because that is the one that matters', () => {
    const far = at(1, 40.5, 2000)
    const near = at(2, 39.96, 2000)
    expect(relativeTo([far, near], own).map((t) => t.icao)).toEqual([2, 1])
  })

  it('reports height above this vehicle, signed', () => {
    const [above] = relativeTo([at(1, 39.96, 2100)], own)
    expect(above!.relAltM).toBeCloseTo(500, 3)
    const [below] = relativeTo([at(1, 39.96, 1000)], own)
    expect(below!.relAltM).toBeCloseTo(-600, 3)
  })

  it('says nothing rather than guessing when either altitude is missing', () => {
    // A target whose report had no VALID_ALTITUDE: the relative height is
    // unknown, not zero, and zero on a traffic display means co-altitude.
    const noAlt = decodeAdsbVehicle(report({ flags: 1 }))!
    expect(relativeTo([noAlt], own)[0]!.relAltM).toBeNull()
    // And before this vehicle has a fix of its own, nothing is relative to
    // anything -- but the target is still listed, because it is still there.
    const blind = relativeTo([at(1, 39.96, 2000)], null)
    expect(blind).toHaveLength(1)
    expect(blind[0]!.rangeM).toBeNull()
    expect(blind[0]!.relAltM).toBeNull()
  })

  it('keeps unrangeable targets, and puts them last', () => {
    const sorted = relativeTo([at(1, 39.96, 2000), at(2, 39.955, 2000)], own)
    expect(sorted).toHaveLength(2)
    expect(sorted[0]!.rangeM!).toBeLessThan(sorted[1]!.rangeM!)
  })
})

describe('which contacts stand out', () => {
  const own = { latDeg: 39.95, lonDeg: -105.25, altMslM: 1600 }
  const near = (altM: number | null, flags = 1 | 2) =>
    relativeTo(
      [
        decodeAdsbVehicle(
          report({ lat: Math.round(39.955 * 1e7), altitude: (altM ?? 0) * 1000, flags }),
        )!,
      ],
      own,
    )[0]!

  it('marks a contact that is near in both range and height', () => {
    expect(isClose(near(1700))).toBe(true)
    // Same range, comfortably above: not close.
    expect(isClose(near(3000))).toBe(false)
  })

  it('treats an unknown altitude as close, not as clear', () => {
    // The first version required a *known* relative height, which made the
    // least-known aircraft the least visible: a contact whose altitude
    // nobody reported was drawn calmer than one with 200 m of separation.
    expect(isClose(near(null, 1))).toBe(true)
  })

  it('is not close when it is simply far away', () => {
    const far = relativeTo([decodeAdsbVehicle(report({ lat: Math.round(40.5 * 1e7) }))!], own)[0]!
    expect(isClose(far)).toBe(false)
  })

  it('says nothing about a contact it cannot place relative to anything', () => {
    // No fix of our own: there is no range, so there is no claim to make.
    const blind = relativeTo([decodeAdsbVehicle(report())!], null)[0]!
    expect(isClose(blind)).toBe(false)
  })
})

describe('what a bench with no fix can still say', () => {
  it('keeps the report even when nothing is relative to anything', () => {
    // The case a real receiver on a desk produces: the aircraft is fully
    // described, and this vehicle does not know where it is, so range,
    // bearing and relative height are all unknown together -- which is why
    // three dashes at once mean "no fix", not "bad report".
    const [t] = relativeTo([decodeAdsbVehicle(report())!], null)
    expect(t!.rangeM).toBeNull()
    expect(t!.bearingDeg).toBeNull()
    expect(t!.relAltM).toBeNull()
    // The one height that survives: the aircraft's own, straight from the
    // report, which is what the map tag falls back to on a bench.
    expect(t!.altMslM).toBeCloseTo(1524, 3)
    expect(t!.callsign).toBe('N172SP')
    expect(t!.groundSpeedMs).toBeCloseTo(51.44, 3)
  })
})
