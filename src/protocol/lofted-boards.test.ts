import { describe, expect, it } from 'vitest'
import {
  boardForId,
  boardsIn,
  parseCatalogIndex,
  parseRelease,
  safeRelativePath,
} from './lofted-boards'

const SHA = 'a'.repeat(64)

function release(over: Record<string, unknown> = {}, board: Record<string, unknown> = {}) {
  return {
    format: 1,
    version: '4.7.0-srx1',
    date: '2026-11-13',
    boards: [
      {
        id: 'f405-srx',
        name: 'F405-SRX',
        boardId: 5999,
        receiver: {
          target: 'newbeedrone.rx_2400.c324d',
          serial: 2,
          bootPin: 71,
          enPin: 70,
          baud: 420000,
        },
        firmware: [
          {
            id: 'stabrx',
            name: 'StabRX',
            file: 'StabRX.apj',
            size: 800000,
            sha256: SHA,
            withBootloader: { file: 'StabRX_with_bl.hex', size: 1800000, sha256: SHA },
            passthroughProtocol: 28,
          },
          {
            id: 'ardupilot',
            name: 'ArduPilot',
            file: 'F405-SRX.apj',
            size: 818806,
            sha256: SHA,
            withBootloader: { file: 'F405-SRX_with_bl.hex', size: 2600000, sha256: SHA },
            passthroughProtocol: 28,
          },
        ],
        ...board,
      },
    ],
    ...over,
  }
}

describe('parseRelease', () => {
  it('reads a board, its receiver wiring and firmware options', () => {
    const r = parseRelease('2026-11-13', release())
    const b = r.boards[0]!
    expect(b.firmware[0]!.withBootloader.file).toBe('StabRX_with_bl.hex')
    expect(b.receiver).toEqual({
      target: 'newbeedrone.rx_2400.c324d',
      serial: 2,
      bootPin: 71,
      enPin: 70,
      baud: 420000,
    })
    expect(b.firmware.map((f) => f.name)).toEqual(['StabRX', 'ArduPilot'])
  })

  it('takes a board without an onboard receiver', () => {
    expect(parseRelease('r1', release({}, { receiver: undefined })).boards[0]!.receiver).toBeNull()
  })

  it('refuses what would be unsafe or ambiguous to act on', () => {
    expect(() => parseRelease('r1', release({ format: 2 }))).toThrow(/format 2/)
    const option = (over: Record<string, unknown>) => ({
      id: 'a',
      name: 'A',
      file: 'a.apj',
      size: 1,
      sha256: SHA,
      withBootloader: { file: 'a.hex', size: 1, sha256: SHA },
      passthroughProtocol: 28,
      ...over,
    })
    const withOption = (over: Record<string, unknown>) =>
      parseRelease('r1', release({}, { firmware: [option(over)] }))
    expect(() =>
      withOption({ withBootloader: { file: '../a.hex', size: 1, sha256: SHA } }),
    ).toThrow(/outside the release/)
    expect(() => withOption({ withBootloader: { file: 'a.hex', size: 1, sha256: 'zz' } })).toThrow(
      /sha256/,
    )
    expect(() => withOption({ withBootloader: undefined })).toThrow(/withBootloader/)
    expect(() => withOption({ withBootloader: { file: 'a.bin', size: 1, sha256: SHA } })).toThrow(
      /\.hex/,
    )
    expect(() => withOption({ file: 'a.hex' })).toThrow(/\.apj/)
    expect(() => parseRelease('r1', release({}, { firmware: [] }))).toThrow(/lists nothing/)
    expect(() => parseRelease('../r1', release())).toThrow(/release name/)
  })
})

describe('parseCatalogIndex', () => {
  it('lists release folders and refuses anything that is not one', () => {
    expect(parseCatalogIndex({ format: 1, releases: ['2026-11-13', 'srx-1.0'] })).toEqual([
      '2026-11-13',
      'srx-1.0',
    ])
    expect(() => parseCatalogIndex({ format: 1, releases: ['a/b'] })).toThrow(/release name/)
    expect(() => parseCatalogIndex({ format: 9, releases: [] })).toThrow(/format/)
  })
})

describe('safeRelativePath', () => {
  it('keeps paths inside their folder', () => {
    expect(safeRelativePath('a/b.apj')).toBe(true)
    for (const bad of ['', '/a', 'a/../b', 'a//b', 'C:x', 'a\\b', './a']) {
      expect(safeRelativePath(bad)).toBe(false)
    }
  })
})

describe('boardsIn', () => {
  it('takes a board facts from its newest release, whatever the index order', () => {
    const older = parseRelease(
      'old',
      release({ date: '2026-11-01', version: '1' }, { name: 'LoftedAero-SRX' }),
    )
    const newer = parseRelease('new', release({ date: '2026-11-13', version: '2' }))
    const [entry] = boardsIn([older, newer])
    expect(entry!.board.name).toBe('F405-SRX')
    expect(entry!.releases.map((r) => r.release.version)).toEqual(['2', '1'])
    expect(boardForId([entry!], 5999)).toBe(entry)
    expect(boardForId([entry!], 0)).toBeNull()
    expect(boardForId([entry!], 140)).toBeNull()
  })
})
