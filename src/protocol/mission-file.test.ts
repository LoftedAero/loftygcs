import { describe, expect, it } from 'vitest'
import { parsePlanFile, parseWaypointsFile, serializeWaypointsFile } from './mission-file'

// As Mission Planner writes it: \r\n endings, tab separated, home first.
const MP_FILE = [
  'QGC WPL 110',
  '0\t1\t0\t16\t0\t0\t0\t0\t-35.3632621\t149.1652374\t584.000000\t1',
  '1\t0\t3\t22\t15.000000\t0\t0\t0\t0\t0\t50.000000\t1',
  '2\t0\t3\t16\t0\t0\t0\t0\t-35.3612000\t149.1640000\t80.000000\t1',
  '',
].join('\r\n')

describe('waypoints files', () => {
  it('parses what Mission Planner writes', () => {
    const items = parseWaypointsFile(MP_FILE)
    expect(items).toHaveLength(3)
    expect(items[0]).toMatchObject({ seq: 0, frame: 0, command: 16, current: 1 })
    // Degrees to 1e7 int, exactly -- this is where float sloppiness would
    // move a waypoint by meters.
    expect(items[0]!.x).toBe(-353632621)
    expect(items[2]!.y).toBe(1491640000)
    expect(items[1]).toMatchObject({ command: 22, param1: 15, z: 50 })
  })

  it('round-trips without losing a digit', () => {
    const items = parseWaypointsFile(MP_FILE)
    expect(parseWaypointsFile(serializeWaypointsFile(items))).toEqual(items)
  })

  it('renumbers gappy hand-edited sequences', () => {
    const gappy = ['QGC WPL 110', '5\t1\t0\t16\t0\t0\t0\t0\t1\t2\t3\t1', '9\t0\t3\t16\t0\t0\t0\t0\t4\t5\t6\t1', ''].join('\n')
    expect(parseWaypointsFile(gappy).map((i) => i.seq)).toEqual([0, 1])
  })

  it('rejects a file that is not a mission with a plain sentence', () => {
    expect(() => parseWaypointsFile('PK\x03\x04 definitely a zip')).toThrow(/QGC WPL 110/)
    expect(() => parseWaypointsFile('QGC WPL 110\n1\t2\t3\n')).toThrow(/line 2/)
    expect(() => parseWaypointsFile('QGC WPL 110\na\tb\tc\td\te\tf\tg\th\ti\tj\tk\tl\n')).toThrow(
      /not a number/,
    )
  })
})

describe('.plan import', () => {
  const plan = (missionExtra: object = {}, items: unknown[] = []) =>
    JSON.stringify({
      fileType: 'Plan',
      version: 1,
      groundStation: 'QGroundControl',
      mission: {
        plannedHomePosition: [-35.3632621, 149.1652374, 584],
        items,
        ...missionExtra,
      },
    })

  it('imports simple items starting after home', () => {
    const { items, home } = parsePlanFile(
      plan({}, [
        { type: 'SimpleItem', command: 22, frame: 3, autoContinue: true, params: [15, 0, 0, null, 0, 0, 50] },
        { type: 'SimpleItem', command: 16, frame: 3, autoContinue: true, params: [0, 0, 0, 0, -35.3612, 149.164, 80] },
      ]),
    )
    expect(home).toEqual({ x: -353632621, y: 1491652374, z: 584 })
    expect(items.map((i) => i.seq)).toEqual([1, 2])
    expect(items[1]).toMatchObject({ command: 16, x: -353612000, z: 80 })
    // QGC writes null for unused params; they must land as 0, not NaN.
    expect(items[0]!.param4).toBe(0)
  })

  it('refuses complex items by name instead of dropping them', () => {
    expect(() =>
      parsePlanFile(plan({}, [{ type: 'ComplexItem', complexItemType: 'survey' }])),
    ).toThrow(/survey/)
  })

  it('rejects non-plan JSON plainly', () => {
    expect(() => parsePlanFile('{"hello": 1}')).toThrow(/Plan mission section/)
    expect(() => parsePlanFile('not json at all')).toThrow(/invalid JSON/)
  })
})
