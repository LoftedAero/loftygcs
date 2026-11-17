import { describe, expect, it } from 'vitest'
import { downloadRelease, latestRelease } from './pfd-install'

// Runs against GitHub to catch a moved release, a manifest this build cannot
// read, or a file whose hash no longer matches what raw.githubusercontent
// serves. Skipped unless requested:
//   NET=1 npm test

const live = process.env.NET === '1' ? describe : describe.skip

live('Lofty PFD release, live', () => {
  it('downloads and checks every file for every radio', async () => {
    const release = await latestRelease()
    expect(release.radios.map((r) => r.key).sort()).toEqual(['edgetx', 'ethos'])
    for (const radio of release.radios) {
      const data = await downloadRelease(release, radio, () => {})
      expect(data.size).toBe(radio.files.length)
    }
  }, 120000)
})
