import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { parseDataflash, type MessageTable, type ParsedLog } from './dataflash'
import { airframeFrom, airframeFromLog, frameName, knownAirframe } from './airframe'

// Real banner strings. The wording differs between versions, which is why
// the matcher looks for "Frame:" rather than a phrase:
//   4.2.2 (every existing log):  "QuadPlane Frame: F-35B"
//   4.6.3 (the current build):   "QuadPlane initialised, Frame: F-35B"
const V406 = 'QuadPlane initialised'
const V416 = 'QuadPlane Frame: F-35B/'
const V422 = 'QuadPlane Frame: F-35B'
const V463 = 'QuadPlane initialised, Frame: F-35B'

describe('reading the frame out of a boot banner', () => {
  it('takes the name after "Frame:", whatever leads up to it', () => {
    expect(frameName([V422])).toBe('F-35B')
    expect(frameName([V463])).toBe('F-35B')
    expect(frameName(['Frame: QUAD/PLUS'])).toBe('QUAD/PLUS')
  })

  it('finds it among the other lines a vehicle says at boot', () => {
    expect(
      frameName([
        'ArduPlane V4.2.2 (75038c0a)',
        'Param space used: 1180/4096',
        V422,
        'GPS 1: detected u-blox',
      ]),
    ).toBe('F-35B')
  })

  it('says nothing when no line announces a frame', () => {
    expect(frameName([])).toBeNull()
    expect(frameName(['ArduPlane V4.2.2', 'Ready to fly'])).toBeNull()
    // "Frame" as a word in passing is not an announcement.
    expect(frameName(['Frame rate 400 Hz'])).toBeNull()
  })
})

describe('recognizing an airframe we can draw', () => {
  it('knows the F-35B by every spelling its firmwares have used', () => {
    expect(knownAirframe('F-35B')).toBe('f35b')
    expect(knownAirframe('f35b')).toBe('f35b')
    expect(airframeFrom([V416])).toBe('f35b')
    expect(airframeFrom([V422])).toBe('f35b')
    expect(airframeFrom([V463])).toBe('f35b')
  })

  it('matches the frame class, not the class/type pair', () => {
    // 4.1.6 logs "F-35B/": the frame class with an unset type.
    expect(knownAirframe('F-35B/')).toBe('f35b')
    expect(frameName([V416])).toBe('F-35B/')
    // The same shape with the type filled in still must not match.
    expect(knownAirframe('QUAD/PLUS')).toBeNull()
  })

  it('says nothing for a firmware that does not report a frame', () => {
    // 4.0.6 announces the quadplane without naming the frame.
    expect(airframeFrom([V406, 'ArduPlane V4.0.6 (dc9e9b6a)'])).toBeNull()
  })

  it('does not claim an aircraft it has no model for', () => {
    // Each known airframe needs a model whose license lets it ship here.
    expect(knownAirframe('QUAD/PLUS')).toBeNull()
    expect(knownAirframe('F-22')).toBeNull()
    expect(knownAirframe(null)).toBeNull()
    expect(knownAirframe('')).toBeNull()
    // Near misses stay misses rather than matching loosely.
    expect(knownAirframe('F-35B-TEST')).toBeNull()
    expect(knownAirframe('NOTF35B')).toBeNull()
  })
})

// Runs against real logs: point F35B_LOGS at a directory of .BIN files.
// Skipped otherwise.
describe.runIf(process.env.F35B_LOGS !== undefined)('real F-35B logs', () => {
  it('recognizes every log the aircraft has recorded', async () => {
    const { readdirSync } = await import('node:fs')
    const path = await import('node:path')
    const dir = process.env.F35B_LOGS!
    const files = readdirSync(dir).filter((f) => /\.bin$/i.test(f))
    expect(files.length).toBeGreaterThan(0)
    for (const f of files) {
      const log = parseDataflash(new Uint8Array(readFileSync(path.join(dir, f))))
      expect(airframeFromLog(log), `${f} should be recognized as the F-35B`).toBe('f35b')
    }
  }, 120000)
})

describe('reading it out of a log', () => {
  const logWith = (messages: string[]): ParsedLog => {
    const table: MessageTable = {
      format: { type: 1, name: 'MSG', length: 0, fields: [{ name: 'Message', format: 'Z' }] },
      count: messages.length,
      columns: new Map([['Message', messages as unknown as Float64Array]]),
    }
    return {
      messages: new Map([['MSG', table]]),
      params: new Map(),
      problems: [],
      skippedBytes: 0,
    }
  }

  it('finds the F-35B in the boot records', () => {
    expect(airframeFromLog(logWith(['ArduPlane V4.2.2 (75038c0a)', V422]))).toBe('f35b')
  })

  it('answers null for a log that never said, rather than guessing', () => {
    // A recording started after boot has no frame line, and nothing else in
    // a log names the airframe.
    expect(airframeFromLog(logWith(['Arming motors']))).toBeNull()
    expect(
      airframeFromLog({
        messages: new Map(),
        params: new Map(),
        problems: [],
        skippedBytes: 0,
      }),
    ).toBeNull()
  })

  it('leaves an ordinary copter log alone', () => {
    const real = parseDataflash(
      new Uint8Array(gunzipSync(readFileSync('src/test-fixtures/copter-sitl.bin.gz'))),
    )
    // This log says "Frame: QUAD/PLUS": a frame line that is read and
    // correctly not recognized.
    expect(frameName(real.messages.get('MSG')!.columns.get('Message') as unknown as string[])).toBe(
      'QUAD/PLUS',
    )
    expect(airframeFromLog(real)).toBeNull()
  })
})

describe('latching it off the live boot banner', () => {
  it('remembers the frame after the status feed has scrolled past it', async () => {
    const { useVehicleStore } = await import('../stores/vehicle-store')
    useVehicleStore.getState().reset()
    expect(useVehicleStore.getState().airframe).toBeNull()

    const say = (text: string) =>
      useVehicleStore.getState().appendStatusText({ severity: 6, text, at: 0 })
    say('ArduPlane V4.2.2 (75038c0a)')
    say(V422)
    expect(useVehicleStore.getState().airframe).toBe('f35b')

    // The status feed is a capped ring, so the frame must outlive the banner
    // line that reported it.
    for (let i = 0; i < 260; i++) say(`chatter ${i}`)
    expect(useVehicleStore.getState().statusTexts.some((s) => /Frame:/.test(s.text))).toBe(false)
    expect(useVehicleStore.getState().airframe).toBe('f35b')
  })

  it('forgets it when the vehicle goes away', async () => {
    const { useVehicleStore } = await import('../stores/vehicle-store')
    useVehicleStore.getState().appendStatusText({ severity: 6, text: V463, at: 0 })
    expect(useVehicleStore.getState().airframe).toBe('f35b')
    // A different vehicle is a different aircraft.
    useVehicleStore.getState().reset()
    expect(useVehicleStore.getState().airframe).toBeNull()
  })

  it('is not set by an ordinary vehicle', async () => {
    const { useVehicleStore } = await import('../stores/vehicle-store')
    useVehicleStore.getState().reset()
    useVehicleStore.getState().appendStatusText({ severity: 6, text: 'Frame: QUAD/PLUS', at: 0 })
    expect(useVehicleStore.getState().airframe).toBeNull()
  })
})
