import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { parseDataflash } from './dataflash'
import { channelLabels, fieldLabel, rcOptionName, servoFunctionName } from './log-labels'

const log = parseDataflash(
  new Uint8Array(gunzipSync(readFileSync('src/test-fixtures/copter-sitl.bin.gz'))),
)

describe('labelling channels from the log’s own parameters', () => {
  it('names the servo outputs of the aircraft that actually flew', () => {
    // From the log's PARM dump: the configuration the flight used.
    const out = channelLabels(log.params, 'RCOU')
    expect(out.get('C1')).toBe('Motor 1')
    expect(out.get('C4')).toBe('Motor 4')
    // A quad has four; disabled outputs stay unlabeled.
    expect(out.has('C5')).toBe(false)
  })

  it('names the RC inputs, sticks and switches alike', () => {
    const rc = channelLabels(log.params, 'RCIN')
    expect(rc.get('C1')).toBe('Roll')
    expect(rc.get('C3')).toBe('Throttle')
    expect(rc.get('C5')).toBe('Flight mode')
    expect(rc.get('C7')).toBe('Save waypoint')
  })

  it('lets a stick win over an option on the same channel', () => {
    // RCMAP is the more specific statement about what a channel is for.
    const params = new Map([
      ['RCMAP_ROLL', 6],
      ['RC6_OPTION', 4],
    ])
    expect(channelLabels(params, 'RCIN').get('C6')).toBe('Roll')
  })

  it('follows a remapped stick rather than assuming the default', () => {
    const params = new Map([['RCMAP_THROTTLE', 2]])
    const rc = channelLabels(params, 'RCIN')
    expect(rc.get('C2')).toBe('Throttle')
    expect(rc.has('C3')).toBe(false)
  })

  it('reports an unknown function as itself instead of guessing', () => {
    expect(servoFunctionName(33)).toBe('Motor 1')
    expect(servoFunctionName(70)).toBe('Throttle')
    expect(servoFunctionName(51)).toBe('RC in 1')
    expect(servoFunctionName(9999)).toBe('Function 9999')
    expect(rcOptionName(4)).toBe('RTL')
    expect(rcOptionName(9999)).toBe('Option 9999')
  })

  it('says nothing at all when the log carried no parameters', () => {
    // A truncated log that never reached the PARM dump: no guess.
    expect(channelLabels(new Map(), 'RCOU').size).toBe(0)
    expect(fieldLabel(new Map(), 'RCOU', 'C1')).toBeNull()
  })

  it('has no opinion about fields that are not channels', () => {
    expect(fieldLabel(log.params, 'ATT', 'Roll')).toBeNull()
    expect(fieldLabel(log.params, 'RCOU', 'TimeUS')).toBeNull()
  })
})
