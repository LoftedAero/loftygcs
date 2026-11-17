// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { parseApj } from '../protocol/bootloader/apj'
import { parseIntelHex } from '../protocol/bootloader/intel-hex'
import { downloadCatalogFile, loadCatalog } from './lofted-catalog'

// Runs against LoftedAero/ardupilot-builds to catch a
// catalog this build cannot read, a file whose hash no longer matches what
// raw.githubusercontent serves, an .apj for another board, or a .hex that is
// not its .apj with a bootloader in front. Skipped unless requested:
//   NET=1 npm test

const live = process.env.NET === '1' ? describe : describe.skip

/** Whether `image` lies whole in the flash contents the segments describe. */
function holds(segments: { address: number; data: Uint8Array }[], image: Uint8Array): boolean {
  return segments.some(({ data }) => {
    for (let at = data.indexOf(image[0]!); at >= 0; at = data.indexOf(image[0]!, at + 1)) {
      if (at + image.length > data.length) return false
      if (image.every((b, i) => data[at + i] === b)) return true
    }
    return false
  })
}

live('Lofted Aero firmware catalog, live', () => {
  it('reads every release and checks every file', async () => {
    const entries = await loadCatalog()
    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) {
      for (const { release, board } of entry.releases) {
        for (const option of board.firmware) {
          const where = `${release.name} ${option.file}`
          const bytes = await downloadCatalogFile(release, option)
          const apj = await parseApj(new TextDecoder().decode(bytes))
          expect(apj.boardId, where).toBe(board.boardId)
          const hex = await downloadCatalogFile(release, option.withBootloader)
          const segments = parseIntelHex(new TextDecoder().decode(hex))
          expect(Math.min(...segments.map((s) => s.address)), where).toBe(0x08000000)
          expect(holds(segments, apj.image), where).toBe(true)
        }
      }
    }
  }, 120000)
})
