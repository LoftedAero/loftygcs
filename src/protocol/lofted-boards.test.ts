import { describe, expect, it } from 'vitest'
import {
  boardForId,
  boardsIn,
  releaseLabels,
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
  it('takes a board facts from the first release in the index that lists it', () => {
    const first = parseRelease('first', release({ date: '2026-11-01', version: '2' }))
    const second = parseRelease(
      'second',
      release({ date: '2026-11-13', version: '1' }, { name: 'LoftedAero-SRX' }),
    )
    const [entry] = boardsIn([first, second])
    expect(entry!.board.name).toBe('F405-SRX')
    expect(entry!.releases.map((r) => r.release.version)).toEqual(['2', '1'])
    expect(boardForId([entry!], 5999)).toBe(entry)
    expect(boardForId([entry!], 0)).toBeNull()
    expect(boardForId([entry!], 140)).toBeNull()
  })
})

describe('the index sets the release order, not the date', () => {
  // A 4.7 build made after the 4.8 ones is listed last, and stays last.
  const index = parseCatalogIndex({
    format: 1,
    releases: ['2026-11-16', '2026-11-14', '2026-11-20'],
  })
  const versions: Record<string, string> = {
    '2026-11-16': 'StabRX-4.8.0-dev (262cde4d)',
    '2026-11-14': 'StabRX-4.8.0-dev (78b82326)',
    '2026-11-20': 'StabRX-4.7.1 (0a1b2c3d)',
  }
  const releases = index.map((name) =>
    parseRelease(name, release({ date: name, version: versions[name] })),
  )

  it('lists the releases in the index’s order', () => {
    const [entry] = boardsIn(releases)
    expect(entry!.releases.map((r) => r.release.name)).toEqual([
      '2026-11-16',
      '2026-11-14',
      '2026-11-20',
    ])
    expect(releaseLabels(entry!.releases.map((r) => r.release))).toEqual([
      'StabRX-4.8.0-dev (262cde4d) · latest',
      'StabRX-4.8.0-dev (78b82326)',
      'StabRX-4.7.1 (0a1b2c3d)',
    ])
  })

  it('takes an option’s current release from the first release that has it', () => {
    // Only the last release has the ArduPilot option; the others have StabRX alone.
    const stabOnly = (name: string) =>
      parseRelease(
        name,
        release(
          { date: name, version: versions[name] },
          { firmware: [release().boards[0]!.firmware[0]] },
        ),
      )
    const [entry] = boardsIn([stabOnly('2026-11-16'), stabOnly('2026-11-14'), releases[2]!])
    const withOption = (id: string) =>
      entry!.releases.filter((r) => r.board.firmware.some((f) => f.id === id))
    expect(withOption('stabrx')[0]!.release.name).toBe('2026-11-16')
    expect(withOption('ardupilot').map((r) => r.release.name)).toEqual(['2026-11-20'])
  })

  it('handles a catalog with no option for a known id', () => {
    const [entry] = boardsIn([
      parseRelease(
        '2026-11-16',
        release({ date: '2026-11-16' }, { firmware: [release().boards[0]!.firmware[0]] }),
      ),
    ])
    expect(entry!.releases[0]!.board.firmware.map((f) => f.id)).toEqual(['stabrx'])
  })
})

describe('release labels', () => {
  it('tells apart two releases whose versions read the same, and only those', () => {
    const r = (name: string, version: string) =>
      parseRelease(name, release({ date: '2026-11-16', version }))
    expect(
      releaseLabels([
        r('2026-11-16b', 'StabRX-4.8.0-dev (262cde4d)'),
        r('2026-11-16', 'StabRX-4.8.0-dev (262cde4d)'),
        r('2026-11-14', 'StabRX-4.8.0-dev (78b82326)'),
      ]),
    ).toEqual([
      'StabRX-4.8.0-dev (262cde4d) · 2026-11-16b · latest',
      'StabRX-4.8.0-dev (262cde4d) · 2026-11-16',
      'StabRX-4.8.0-dev (78b82326)',
    ])
  })

  it('shortens a label too long for its box rather than clipping it', () => {
    const current = parseRelease('2026-11-16', release({ version: 'StabRX-4.8.0-dev (262cde4d)' }))
    const other = parseRelease('2026-11-15', release({ version: 'F35B-70-4.8.0-dev (1234abcd)' }))
    const fits = (label: string) => label.length <= 29
    // The product is on the tile; the ArduPilot version and the hash stay.
    expect(releaseLabels([current, other], fits, 'StabRX')).toEqual([
      '4.8.0-dev (262cde4d) · latest',
      'F35B-70-4.8.0-dev (1234abcd)',
    ])
    expect(releaseLabels([current], (l) => l.length <= 12, 'StabRX')).toEqual(['4.8.0-dev (…'])
  })
})
