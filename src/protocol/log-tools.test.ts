import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import path from 'node:path'
import { parseDataflash, type MessageTable, type ParsedLog } from './dataflash'
import { webToolsFor } from './log-tools'

const real = parseDataflash(
  new Uint8Array(gunzipSync(readFileSync('src/test-fixtures/copter-sitl.bin.gz'))),
)

/** A log holding exactly the message types named, contents irrelevant. */
function logWith(...names: string[]): ParsedLog {
  const messages = new Map<string, MessageTable>()
  for (const name of names) {
    messages.set(name, {
      format: { type: 1, name, length: 0, fields: [] },
      count: 1,
      columns: new Map(),
    })
  }
  return { messages, params: new Map(), problems: [], skippedBytes: 0 }
}

const tool = (log: ParsedLog, id: string) => webToolsFor(log).find((t) => t.id === id)!

describe('matching a log to the WebTools that can read it', () => {
  it('judges the SITL fixture the way the tools would', () => {
    // The fixture logs MAG, position and the rate PIDs, but no batch IMU
    // sampling, so three tools work and Filter Review does not.
    expect(tool(real, 'hardware').missing).toBeNull()
    expect(tool(real, 'magfit').missing).toBeNull()
    expect(tool(real, 'pid').missing).toBeNull()
    expect(tool(real, 'filter').missing).toMatch(/INS_LOG_BAT_MASK/)
  })

  it('offers Hardware Report for anything at all', () => {
    expect(tool(logWith('MSG'), 'hardware').missing).toBeNull()
  })

  it('wants both a compass and a position for MAGFit', () => {
    expect(tool(logWith('MAG', 'GPS'), 'magfit').missing).toBeNull()
    expect(tool(logWith('MAG', 'POS'), 'magfit').missing).toBeNull()
    expect(tool(logWith('GPS'), 'magfit').missing).toMatch(/compass/)
    // A compass but no fix: the reason names the position, not the MAG.
    expect(tool(logWith('MAG'), 'magfit').missing).toMatch(/position/)
  })

  it('accepts either batch sampling or raw gyro for Filter Review', () => {
    expect(tool(logWith('ISBH', 'ISBD'), 'filter').missing).toBeNull()
    expect(tool(logWith('GYR'), 'filter').missing).toBeNull()
    expect(tool(logWith('IMU'), 'filter').missing).toMatch(/raw IMU/)
  })

  it('wants rate PID records for PID Review', () => {
    expect(tool(logWith('PIDR'), 'pid').missing).toBeNull()
    expect(tool(logWith('PIDA'), 'pid').missing).toMatch(/PID/)
  })

  it('points every tool at firmware.ardupilot.org over https', () => {
    for (const t of webToolsFor(real)) {
      expect(t.url).toMatch(/^https:\/\/firmware\.ardupilot\.org\/Tools\/WebTools\/\w+\/$/)
    }
  })
})

// Real logs with batch logging on, where every tool applies, which the
// fixture cannot cover.
describe.runIf(process.env.F35B_LOGS !== undefined)('against real F-35B logs', () => {
  it('accepts 00000009.BIN for every tool', () => {
    const log = parseDataflash(
      new Uint8Array(readFileSync(path.join(process.env.F35B_LOGS!, '00000009.BIN'))),
    )
    for (const t of webToolsFor(log)) {
      expect(t.missing, `${t.name} should accept this log`).toBeNull()
    }
  })
})
