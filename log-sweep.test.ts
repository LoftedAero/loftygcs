// Runs the whole log pipeline over a directory of real logs. Hardware logs
// break parsers in ways SITL and a single fixture do not: truncated tails
// from a power cut, formats that appear mid-file, multi-instance sensors,
// gaps.
//
// Run: LOG_SWEEP="<dir>" npx vitest run log-sweep.test.ts
import { describe, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { getSeries, plottableFields, seriesStats, parseDataflash } from './src/protocol/dataflash'
import { flightPath } from './src/protocol/log-path'
import { firmwareString, logEnd, modeSpans, vehicleClassFromLog } from './src/protocol/log-modes'
import { airframeFromLog } from './src/protocol/airframe'
import { channelLabels } from './src/protocol/log-labels'
import { evaluateExpression, expressionError } from './src/protocol/log-expression'

const ROOT = process.env.LOG_SWEEP

function allLogs(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) allLogs(p, out)
    else if (/\.bin$/i.test(e.name)) out.push(p)
  }
  return out
}

interface Row {
  file: string
  mb: number
  ms: number
  problems: string[]
  skipped: number
  messages: number
  params: number
  fw: string | null
  vehicle: string
  airframe: string | null
  pathSource: string | null
  samples: number
  pathProblems: string[]
  modes: number
  end: number
  fields: number
  badStats: string[]
  exprFail: string[]
  threw: string | null
}

describe.runIf(ROOT !== undefined)('log corpus sweep', () => {
  it('runs the pipeline over every log', () => {
    const files = allLogs(ROOT!)
    console.log(`sweeping ${files.length} logs under ${ROOT}\n`)
    const rows: Row[] = []

    for (const file of files) {
      const rel = path.relative(ROOT!, file)
      const mb = statSync(file).size / 1e6
      const row: Row = {
        file: rel,
        mb: Number(mb.toFixed(1)),
        ms: 0,
        problems: [],
        skipped: 0,
        messages: 0,
        params: 0,
        fw: null,
        vehicle: '',
        airframe: null,
        pathSource: null,
        samples: 0,
        pathProblems: [],
        modes: 0,
        end: 0,
        fields: 0,
        badStats: [],
        exprFail: [],
        threw: null,
      }
      try {
        const t0 = Date.now()
        const log = parseDataflash(new Uint8Array(readFileSync(file)))
        row.ms = Date.now() - t0
        row.problems = log.problems
        row.skipped = log.skippedBytes
        row.messages = log.messages.size
        row.params = log.params.size
        row.fw = firmwareString(log)
        row.vehicle = vehicleClassFromLog(log)
        row.airframe = airframeFromLog(log)

        const p = flightPath(log)
        row.pathSource = p.source
        row.samples = p.samples.length
        row.pathProblems = p.problems
        row.modes = modeSpans(log).length
        row.end = Math.round(logEnd(log))

        // Labels read the log's own parameter dump, which may be malformed.
        channelLabels(log.params, 'RCOU')
        channelLabels(log.params, 'RCIN')

        const fields = plottableFields(log)
        row.fields = fields.length
        // NaN or Infinity in a min/max means a decoding fault.
        for (const f of fields) {
          const s = getSeries(log, f.message, f.field)
          if (!s || s.values.length === 0) continue
          const st = seriesStats(s, 0, row.end)
          if (st.count === 0) continue
          if (!Number.isFinite(st.min) || !Number.isFinite(st.max) || !Number.isFinite(st.mean)) {
            row.badStats.push(`${f.message}.${f.field}`)
          }
        }

        for (const expr of ['ATT.DesRoll - ATT.Roll', 'sqrt(IMU.AccX^2 + IMU.AccY^2)']) {
          if (expressionError(log, expr) !== null) continue
          try {
            const r = evaluateExpression(log, expr)
            if (r.values.length === 0) row.exprFail.push(`${expr}: empty`)
          } catch (err) {
            row.exprFail.push(`${expr}: ${String(err)}`)
          }
        }
      } catch (err) {
        row.threw = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
      }
      rows.push(row)
    }

    // ---- report
    const threw = rows.filter((r) => r.threw)
    const noPath = rows.filter((r) => !r.threw && r.samples === 0)
    const skipped = rows.filter((r) => r.skipped > 0)
    const problems = rows.filter((r) => r.problems.length > 0)
    const badStats = rows.filter((r) => r.badStats.length > 0)
    const exprFail = rows.filter((r) => r.exprFail.length > 0)
    const noFw = rows.filter((r) => !r.threw && !r.fw)

    console.log(`--- ${rows.length} logs, ${rows.reduce((a, r) => a + r.mb, 0).toFixed(0)} MB ---`)
    console.log(`threw:            ${threw.length}`)
    console.log(`no flight path:   ${noPath.length}`)
    console.log(`skipped bytes:    ${skipped.length}`)
    console.log(`parser problems:  ${problems.length}`)
    console.log(`non-finite stats: ${badStats.length}`)
    console.log(`expression fail:  ${exprFail.length}`)
    console.log(`no firmware line: ${noFw.length}`)

    const slow = [...rows].sort((a, b) => b.ms - a.ms).slice(0, 5)
    console.log(`\nslowest parses:`)
    for (const r of slow) console.log(`  ${r.ms} ms  ${r.mb} MB  ${r.file}`)
    const rate = rows.reduce((a, r) => a + r.mb, 0) / (rows.reduce((a, r) => a + r.ms, 0) / 1000)
    console.log(`  throughput: ${rate.toFixed(1)} MB/s`)

    for (const [label, list] of [
      ['THREW', threw],
      ['NO PATH', noPath],
      ['SKIPPED BYTES', skipped],
      ['PARSER PROBLEMS', problems],
      ['NON-FINITE STATS', badStats],
      ['EXPRESSION FAIL', exprFail],
      ['NO FIRMWARE LINE', noFw],
    ] as const) {
      if (list.length === 0) continue
      console.log(`\n=== ${label} (${list.length}) ===`)
      for (const r of list.slice(0, 12)) {
        const detail = r.threw ?? r.problems.slice(0, 2).join(' | ') ?? ''
        console.log(
          `  ${r.file}  ${r.mb}MB fw=${r.fw ?? '-'} msgs=${r.messages} skipped=${r.skipped}` +
            `${r.badStats.length ? ` badStats=${r.badStats.slice(0, 4).join(',')}` : ''}` +
            `${r.exprFail.length ? ` expr=${r.exprFail[0]}` : ''}` +
            `${r.pathProblems.length ? ` path="${r.pathProblems[0]}"` : ''}` +
            `${detail ? ` ${detail}` : ''}`,
        )
      }
    }

    const versions = new Map<string, number>()
    const airframes = new Map<string, number>()
    for (const r of rows) {
      const v = (r.fw ?? 'none').replace(/ \(.*/, '')
      versions.set(v, (versions.get(v) ?? 0) + 1)
      const a = r.airframe ?? '-'
      airframes.set(a, (airframes.get(a) ?? 0) + 1)
    }
    console.log(`\nfirmware versions seen:`)
    for (const [v, n] of [...versions].sort((a, b) => b[1] - a[1])) console.log(`  ${n} ${v}`)
    console.log(`airframe detected: ${[...airframes].map(([a, n]) => `${a}=${n}`).join(' ')}`)
  }, 1800000)
})
