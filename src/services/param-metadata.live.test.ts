import { describe, expect, it } from 'vitest'
import { fetchParamMetadata } from './param-metadata'

// Runs against the real autotest.ardupilot.org to catch path changes. The
// versioned tree spells vehicles differently from the current one and
// publishes XML where the current one publishes JSON. Parsing has its own
// fixture tests.
//
// Skipped unless requested:
//   NET=1 npm test

const live = process.env.NET === '1' ? describe : describe.skip

live('parameter metadata, live', () => {
  it('fetches metadata matched to a firmware version', async () => {
    const { params, source } = await fetchParamMetadata('Copter', {
      major: 4,
      minor: 5,
      patch: 7,
      type: 255,
    })
    expect(source).toBe('4.5.7')
    // A Copter has well over a thousand documented parameters.
    expect(Object.keys(params).length).toBeGreaterThan(1000)
    // Names arrive as the vehicle sends them, not as the file spells them.
    expect(params.SYSID_THISMAV).toBeDefined()
    expect(params.ATC_SLEW_YAW?.units).toBeTruthy()
    expect(params.FLTMODE1?.values).toBeDefined()
  }, 120000)

  it('rounds down to the newest published version that is not newer', async () => {
    // 4.5.99 has never existed; the answer must be a real 4.5.x.
    const { source } = await fetchParamMetadata('Copter', {
      major: 4,
      minor: 5,
      patch: 99,
      type: 255,
    })
    expect(source).toMatch(/^4\.5\.\d+$/)
  }, 120000)

  it('falls back to the current release for firmware older than anything published', async () => {
    const { params, source } = await fetchParamMetadata('Copter', {
      major: 3,
      minor: 2,
      patch: 1,
      type: 255,
    })
    expect(source).toBe('latest release')
    expect(Object.keys(params).length).toBeGreaterThan(1000)
  }, 120000)
})
