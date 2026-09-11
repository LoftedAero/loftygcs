import { describe, expect, it } from 'vitest'
import {
  compareVersions,
  defaultRelease,
  dropPinnedTwins,
  allPlatforms,
  isTunedFor,
  platformsFor,
  versionsFor,
  releasesFor,
  vehiclesIn,
  VEHICLES,
  type FirmwareOption,
} from './firmware-manifest'

// Choosing *which release* of a firmware, as opposed to which board.
//
// The numbers in these comments are measured against the live
// firmware.ardupilot.org manifest (97,248 entries, 33,915 of them flashable
// .apj rows with a board id), not estimated.

const opt = (o: Partial<FirmwareOption> & { version: string }): FirmwareOption => ({
  vehicle: 'Copter',
  vehicleLabel: 'Copter (multirotor)',
  channel: 'stable',
  current: false,
  platform: 'CubeOrange',
  boardId: 140,
  url: `https://example/${o.channel ?? 'stable'}-${o.version}/${o.platform ?? 'CubeOrange'}.apj`,
  bootloaderStr: ['CubeOrange-BL'],
  brandName: null,
  ...o,
})

describe('which releases the manifest carries', () => {
  it('keeps the pinned copy of a release that is not the current one', () => {
    // `mav-firmware-version-type` is OFFICIAL/BETA/DEV *and* STABLE-4.6.3
    // for every release ever published. Reading only the first three threw
    // away 28,143 of the 33,915 flashable rows -- every firmware older than
    // today's, which is exactly what a downgrade needs.
    const all = dropPinnedTwins([
      opt({ version: '4.7.1', current: true }),
      opt({ version: '4.6.3' }),
    ])
    expect(all.map((o) => o.version)).toEqual(['4.7.1', '4.6.3'])
  })

  it('drops the pinned twin of the current release, keeping the /stable/ row', () => {
    const all = dropPinnedTwins([
      opt({ version: '4.7.1', current: true, url: 'https://example/stable/CubeOrange.apj' }),
      opt({ version: '4.7.1', url: 'https://example/stable-4.7.1/CubeOrange.apj' }),
    ])
    expect(all).toHaveLength(1)
    expect(all[0]!.url).toBe('https://example/stable/CubeOrange.apj')
  })

  it('keeps a beta that shares its version number with the current stable', () => {
    // ArduPilot cuts beta and stable at the same version, so all 1,787 beta
    // rows collide with a stable row on (board, vehicle, platform,
    // version). A dedupe key without the channel drops every one of them,
    // which is a whole channel disappearing with nothing to show for it.
    const all = dropPinnedTwins([
      opt({ version: '4.7.1', current: true }),
      opt({ version: '4.7.1', channel: 'beta' }),
    ])
    expect(all.map((o) => o.channel)).toEqual(['stable', 'beta'])
  })

  it('keeps a current release that has no pinned directory at all', () => {
    // 103 of the 1,786 current rows have no stable-<version> twin.
    const all = dropPinnedTwins([opt({ version: '4.7.1', current: true })])
    expect(all).toHaveLength(1)
  })
})

describe('ordering releases', () => {
  it('sorts by number, not as text', () => {
    // "4.10.0" < "4.9.0" as a string, which would put a two-year-old build
    // at the top of the list and make it the default.
    expect(compareVersions('4.10.0', '4.9.0')).toBeLessThan(0)
    expect(compareVersions('4.9.0', '4.10.0')).toBeGreaterThan(0)
  })

  it('treats a missing segment as zero rather than as smaller', () => {
    expect(compareVersions('4.7', '4.7.0')).toBe(0)
    expect(compareVersions('4.7.1', '4.7')).toBeLessThan(0)
  })

  it('puts stable above beta above dev, and newest first inside each', () => {
    const all = [
      opt({ version: '4.8.0', channel: 'dev' }),
      opt({ version: '4.6.3' }),
      opt({ version: '4.7.1', channel: 'beta' }),
      opt({ version: '4.7.1', current: true }),
    ]
    expect(
      releasesFor(all, 'Copter', 'CubeOrange').map((o) => `${o.channel} ${o.version}`),
    ).toEqual(['stable 4.7.1', 'stable 4.6.3', 'beta 4.7.1', 'dev 4.8.0'])
  })

  it('separates two boards that share a platform name once the board is known', () => {
    const all = [opt({ version: '4.7.1' }), opt({ version: '3.5.0', boardId: 123 })]
    expect(releasesFor(all, 'Copter', 'CubeOrange', 140).map((o) => o.version)).toEqual(['4.7.1'])
  })
})

describe('what is offered without being asked', () => {
  it('is the current stable', () => {
    const all = [
      opt({ version: '4.8.0', channel: 'dev' }),
      opt({ version: '4.7.1', current: true }),
      opt({ version: '4.6.3' }),
    ]
    expect(defaultRelease(releasesFor(all, 'Copter', 'CubeOrange'))?.version).toBe('4.7.1')
  })

  it('believes the /stable/ row over the highest version number', () => {
    // These agree for every board in the live manifest, so this fixture is
    // deliberately one the manifest does not contain: it pins the rule
    // rather than the coincidence. The manifest does already carry rows
    // whose reported version disagrees with the directory serving them
    // (Rover's stable-3.4.2 reports 3.5.0), which is how they could part.
    const all = [opt({ version: '4.9.0' }), opt({ version: '4.7.1', current: true })]
    expect(defaultRelease(releasesFor(all, 'Copter', 'CubeOrange'))?.version).toBe('4.7.1')
  })

  it('falls back to the newest build for a vehicle that has never had a stable', () => {
    // Blimp is DEV-only in the manifest -- it has no OFFICIAL or BETA row at
    // all. A strict "current stable or nothing" leaves one of the eight
    // vehicle symbols permanently dead.
    const all = [
      opt({ version: '4.8.0', channel: 'dev', vehicle: 'Blimp' }),
      opt({ version: '4.7.0', channel: 'dev', vehicle: 'Blimp' }),
    ]
    const picked = defaultRelease(releasesFor(all, 'Blimp', 'CubeOrange'))
    expect(picked?.version).toBe('4.8.0')
  })

  it('is nothing when the board has no build for this vehicle', () => {
    expect(defaultRelease([])).toBeUndefined()
  })
})

describe('the board list', () => {
  it('offers only boards that still have a current build', () => {
    // A platform that existed in 4.3 and was dropped is not a board anyone
    // is holding; beside a live one it is an unmakeable choice.
    const all = [
      opt({ version: '4.7.1', current: true, platform: 'CubeOrange' }),
      opt({ version: '4.3.0', platform: 'CubeOrange-retired' }),
    ]
    expect(platformsFor(all, 'Copter', null)).toEqual(['CubeOrange'])
  })

  it('falls back to every release for a vehicle that was dropped from the board', () => {
    // 87 of 317 board ids have no current build on some vehicle. An empty
    // list there reads as "this app does not know your board", where the
    // truth is that this vehicle stopped being built for it.
    const all = [opt({ version: '4.3.0', platform: 'CubeOrange' })]
    expect(platformsFor(all, 'Copter', null)).toEqual(['CubeOrange'])
  })

  it('narrows to a detected board', () => {
    const all = [
      opt({ version: '4.7.1', current: true, platform: 'CubeOrange', boardId: 140 }),
      opt({ version: '4.7.1', current: true, platform: 'Pixhawk1', boardId: 9 }),
    ]
    expect(platformsFor(all, 'Copter', 140)).toEqual(['CubeOrange'])
  })
})

describe('the vehicle symbols', () => {
  it('offers the commonest airframes first, not alphabetically', () => {
    // Alphabetical opens the grid with "Antenna Tracker".
    const all = [
      opt({ version: '1', vehicle: 'ANTENNA_TRACKER', vehicleLabel: 'Antenna Tracker' }),
      opt({ version: '1', vehicle: 'FIXED_WING', vehicleLabel: 'Plane' }),
      opt({ version: '1', vehicle: 'Copter', vehicleLabel: 'Copter' }),
    ]
    expect(
      vehiclesIn(all)
        .map((v) => v.vehicle)
        .slice(0, 3),
    ).toEqual(['Copter', 'HELICOPTER', 'FIXED_WING'])
    expect(vehiclesIn(all).at(-1)?.vehicle).toBe('CAN_PERIPHERAL')
  })

  it('draws the whole grid before the manifest has arrived', () => {
    // The symbols are the first thing on the screen and the question
    // everything else follows from, so they must not wait on a 97,000-entry
    // download -- and must not gain or reorder tiles when it lands.
    const empty = vehiclesIn([])
    expect(empty).toEqual(VEHICLES)
    expect(empty.map((v) => v.label)).toContain('Copter')
    expect(empty.map((v) => v.label)).toContain('Heli')
    expect(empty.map((v) => v.label)).toContain('AP Periph')

    const loaded = vehiclesIn([opt({ version: '1', vehicle: 'Copter', vehicleLabel: 'Copter' })])
    expect(loaded.map((v) => v.vehicle)).toEqual(empty.map((v) => v.vehicle))
  })

  it('puts a vehicle it has never heard of last rather than first', () => {
    // indexOf returns -1 for an unknown key, which sorts it ahead of
    // everything -- so a new mav-type would silently take the first tile.
    const all = [
      opt({ version: '1', vehicle: 'SPACESHIP', vehicleLabel: 'SPACESHIP' }),
      opt({ version: '1', vehicle: 'Copter', vehicleLabel: 'Copter' }),
    ]
    const order = vehiclesIn(all).map((v) => v.vehicle)
    expect(order[0]).toBe('Copter')
    expect(order.at(-1)).toBe('SPACESHIP')
  })
})

describe('the airframes this app actually understands', () => {
  it('warns for anything that is not Copter, Heli or Plane', () => {
    // Everything flashes; the warning is about the screens downstream. Heli
    // is inside the set because it *is* ArduCopter -- the manifest splits it
    // off for the image, not for the firmware.
    expect(isTunedFor('Copter')).toBe(true)
    expect(isTunedFor('FIXED_WING')).toBe(true)
    expect(isTunedFor('HELICOPTER')).toBe(true)
    expect(isTunedFor('GROUND_ROVER')).toBe(false)
    expect(isTunedFor('CAN_PERIPHERAL')).toBe(false)
  })
})

describe('the releases offered for a vehicle', () => {
  it('does not depend on the board, because a release does not', () => {
    // The board is not known when this list is drawn -- it is identified at
    // flash time. Keyed on a platform, the list came out empty and the
    // control sat permanently disabled reading "No build for this board".
    const all = [
      opt({ platform: 'CubeOrange', boardId: 140, version: '4.7.1' }),
      opt({ platform: 'Pixhawk1', boardId: 9, version: '4.7.1' }),
      opt({ platform: 'MatekH743', boardId: 1013, version: '4.6.3', current: false }),
    ]
    expect(versionsFor(all, 'Copter').map((r) => r.version)).toEqual(['4.7.1', '4.6.3'])
  })

  it('keeps a version once per channel, newest and most stable first', () => {
    // Beta and stable are cut at the same number, so they are two offers.
    const all = [
      opt({
        platform: 'CubeOrange',
        boardId: 140,
        version: '4.8.0',
        channel: 'beta',
        current: false,
      }),
      opt({ platform: 'CubeOrange', boardId: 140, version: '4.7.1' }),
      opt({ platform: 'CubeOrange', boardId: 140, version: '4.7.0', current: false }),
      opt({
        platform: 'CubeOrange',
        boardId: 140,
        version: '4.9.0',
        channel: 'dev',
        current: false,
      }),
    ]
    expect(versionsFor(all, 'Copter').map((r) => `${r.version} ${r.channel}`)).toEqual([
      '4.7.1 stable',
      '4.7.0 stable',
      '4.8.0 beta',
      '4.9.0 dev',
    ])
  })

  it('says nothing for a vehicle the manifest does not carry', () => {
    expect(
      versionsFor([opt({ version: '4.7.1', platform: 'CubeOrange', boardId: 140 })], 'SUBMARINE'),
    ).toEqual([])
  })
})

describe('every target, for a board with no id', () => {
  it('lists current builds across all vehicles, sorted', () => {
    const all = [
      opt({ version: '4.7.1', current: true, platform: 'Pixhawk1', vehicle: 'FIXED_WING' }),
      opt({ version: '4.7.1', current: true, platform: 'CubeOrange' }),
      opt({ version: '4.3.0', platform: 'Retired' }),
    ]
    expect(allPlatforms(all)).toEqual(['CubeOrange', 'Pixhawk1'])
  })

  it('falls back to everything when nothing is current', () => {
    expect(allPlatforms([opt({ version: '4.3.0', platform: 'Retired' })])).toEqual(['Retired'])
  })
})
