import { describe, expect, it } from 'vitest'
import { bestVersion, parsePdefXml, parseVersionIndex } from './param-metadata'

// The XML below is copied from the published
// /Parameters/versioned/Copter/stable-4.5.7/apm.pdef.xml. Note that a Range
// is space separated, and <values> under a bitmask parameter lists mask
// values rather than bit numbers.

const XML = `<?xml version="1.0" encoding="utf-8"?>
<paramfile>
  <vehicles>
    <parameters name="ArduCopter">
      <param humanName="Throttle filter cutoff" name="ArduCopter:PILOT_THR_FILT" documentation="Throttle filter cutoff (Hz) - active whenever altitude control is inactive - 0 to disable" user="Advanced">
        <field name="Units">Hz</field>
        <field name="UnitText">hertz</field>
        <field name="Range">0 10</field>
        <field name="Increment">.5</field>
      </param>
      <param humanName="Pilot options" name="ArduCopter:PILOT_TKOFF_RPT" documentation="Options" user="Advanced">
        <values>
          <value code="0">None</value>
          <value code="1">Feedback from mid stick</value>
          <value code="2">High throttle cancels landing</value>
          <value code="4">Disarm on land detection</value>
        </values>
        <field name="Bitmask">0:Feedback from mid stick,1:High throttle cancels landing,2:Disarm on land detection</field>
      </param>
      <param humanName="Eeprom format version number" name="ArduCopter:FORMAT_VERSION" documentation="This value is incremented when changes are made" user="Advanced">
        <field name="ReadOnly">True</field>
      </param>
    </parameters>
  </vehicles>
  <libraries>
    <parameters name="ATC_">
      <param humanName="Yaw target slew rate" name="ATC_SLEW_YAW" documentation="Maximum rate the yaw target can be updated" user="Advanced">
        <field name="Units">cdeg/s</field>
        <field name="RebootRequired">True</field>
        <values>
          <value code="0">Disabled</value>
          <value code="1">Enabled</value>
        </values>
      </param>
    </parameters>
  </libraries>
</paramfile>`

describe('reading the versioned XML', () => {
  const meta = parsePdefXml(XML)

  it('drops the vehicle prefix, so names match what the vehicle sends', () => {
    // The wire calls it PILOT_THR_FILT; the file calls it
    // ArduCopter:PILOT_THR_FILT.
    expect(meta.PILOT_THR_FILT).toBeDefined()
    expect(meta['ArduCopter:PILOT_THR_FILT']).toBeUndefined()
    // Library parameters carry no prefix and must survive unchanged.
    expect(meta.ATC_SLEW_YAW).toBeDefined()
  })

  it('reads the human name, description and units', () => {
    expect(meta.PILOT_THR_FILT!.displayName).toBe('Throttle filter cutoff')
    expect(meta.PILOT_THR_FILT!.description).toMatch(/altitude control is inactive/)
    expect(meta.PILOT_THR_FILT!.units).toBe('Hz')
  })

  it('reads a range that is space separated, not two attributes', () => {
    // The JSON form is {low, high}; the XML is "0 10" in one element.
    expect(meta.PILOT_THR_FILT!.range).toEqual({ low: 0, high: 10 })
  })

  it('reads an increment written without a leading zero', () => {
    expect(meta.PILOT_THR_FILT!.increment).toBe(0.5)
  })

  it('prefers the Bitmask field over the values beside it', () => {
    // Both are present on a bitmask parameter: <values> lists 0,1,2,4 (mask
    // values) where Bitmask lists 0,1,2 (bit numbers).
    expect(meta.PILOT_TKOFF_RPT!.bitmask).toEqual({
      0: 'Feedback from mid stick',
      1: 'High throttle cancels landing',
      2: 'Disarm on land detection',
    })
    expect(meta.PILOT_TKOFF_RPT!.values).toBeUndefined()
  })

  it('reads values as an enumeration where there is no bitmask', () => {
    expect(meta.ATC_SLEW_YAW!.values).toEqual({ 0: 'Disabled', 1: 'Enabled' })
  })

  it('reads RebootRequired', () => {
    expect(meta.ATC_SLEW_YAW!.rebootRequired).toBe(true)
    expect(meta.PILOT_THR_FILT!.rebootRequired).toBeUndefined()
  })

  it('keeps a parameter that has nothing but a name', () => {
    expect(meta.FORMAT_VERSION).toBeDefined()
    expect(meta.FORMAT_VERSION!.range).toBeUndefined()
  })

  it('refuses something that is not the file it was given', () => {
    expect(() => parsePdefXml('<<< not xml')).toThrow(/XML/)
  })
})

describe('finding the published versions', () => {
  const index = `<html><body><h1>Index of /Parameters/versioned/Copter</h1>
    <a href="/Parameters/versioned/">Parent</a>
    <a href="stable-4.4.4/">stable-4.4.4/</a>
    <a href="stable-4.5.0/">stable-4.5.0/</a>
    <a href="stable-4.5.7/">stable-4.5.7/</a>
    <a href="stable-4.6.0/">stable-4.6.0/</a>
    </body></html>`

  it('harvests the version directories from the listing', () => {
    expect(parseVersionIndex(index).sort()).toEqual(['4.4.4', '4.5.0', '4.5.7', '4.6.0'])
  })

  it('is not confused by an empty or unrelated page', () => {
    expect(parseVersionIndex('<html>nothing here</html>')).toEqual([])
  })
})

describe('choosing which version to ask for', () => {
  const available = ['4.4.4', '4.5.0', '4.5.7', '4.6.0']

  it('takes the exact version when it is published', () => {
    expect(bestVersion(available, { major: 4, minor: 5, patch: 7 })).toBe('4.5.7')
  })

  it('rounds down, never up', () => {
    // 4.5.9 has no published metadata; round down to 4.5.7, not up to a
    // newer release.
    expect(bestVersion(available, { major: 4, minor: 5, patch: 9 })).toBe('4.5.7')
    expect(bestVersion(available, { major: 4, minor: 5, patch: 3 })).toBe('4.5.0')
  })

  it('crosses a minor version to find the nearest older one', () => {
    expect(bestVersion(available, { major: 4, minor: 4, patch: 9 })).toBe('4.4.4')
  })

  it('compares numbers, not strings', () => {
    // "4.10.0" sorts before "4.9.0" as text and after it as a version.
    expect(bestVersion(['4.9.0', '4.10.0'], { major: 4, minor: 10, patch: 0 })).toBe('4.10.0')
    expect(bestVersion(['4.9.0', '4.10.0'], { major: 4, minor: 9, patch: 5 })).toBe('4.9.0')
  })

  it('has no answer for firmware older than anything published', () => {
    expect(bestVersion(available, { major: 3, minor: 6, patch: 0 })).toBeNull()
    expect(bestVersion([], { major: 4, minor: 5, patch: 7 })).toBeNull()
  })
})
