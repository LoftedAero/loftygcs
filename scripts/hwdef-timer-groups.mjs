// Generate src/protocol/timer-groups.ts from ArduPilot's own hwdef tree.
//
//   node scripts/hwdef-timer-groups.mjs [--ref master]
//
// A flight controller's outputs are wired to hardware timers in groups, and
// every channel in a group must share one protocol: choosing DShot on output 5
// takes 6, 7 and 8 with it. **That grouping is in no parameter and in no
// MAVLink message.** The boot banner looks like it carries it and does not --
// `RCOutput::get_output_mode_banner` merges adjacent channels by *mode*, so two
// separate timer groups both left on PWM come back as one run and a board's
// real boundaries never appear.
//
// The grouping is stated once, in the board's hwdef, as the timer named on each
// output's pin line:
//
//   PB0  TIM8_CH2N TIM8  PWM(1)  GPIO(50)
//   PA0  TIM5_CH1  TIM5  PWM(3)  GPIO(52)
//
// So a group is "same TIMx", read from the source of truth rather than from
// anything remembered. Three things it has to handle:
//
//   - `include` chains. Most boards are a stub including a shared `.inc`, and
//     some go two deep (a variant including its base).
//   - `IOMCU_UART`. A board with an IO co-processor drives outputs 1-8 from it,
//     on a fixed layout of its own, and the FMU's own `PWM(1)` is output 9.
//     ArduPilot calls that shift `chan_offset`.
//   - `NODMA`. A channel without DMA cannot do DShot whatever its group allows,
//     which is worth carrying beside the group.
//
// **Keyed by board name, not by board id.** The id is what a vehicle reports
// most readily -- AUTOPILOT_VERSION's `board_version` carries it shifted up
// sixteen bits -- but it does not identify a pinout: measured on this tree, 44
// ids are claimed by more than one layout, and id 9 alone covers CubeBlack,
// Pixhawk1, fmuv2, fmuv3 and the skyviper boards, which are not the same
// hardware. Keying by id would have shown a Pixhawk1 owner skyviper's timer
// groups. So the name leads -- ArduPilot's `CHIBIOS_SHORT_BOARD_NAME`, which it
// prints in the boot banner's system-id line -- and the id is a fallback
// emitted only for ids whose every board agrees on one layout.

import { writeFileSync } from 'node:fs'

const REF = process.argv.includes('--ref')
  ? process.argv[process.argv.indexOf('--ref') + 1]
  : 'master'
const RAW = `https://raw.githubusercontent.com/ArduPilot/ardupilot/${REF}`
const HWDEF = `${RAW}/libraries/AP_HAL_ChibiOS/hwdef`
const OUT = new URL('../src/protocol/timer-groups.ts', import.meta.url)

/** Public tree, used keyless: keep the concurrency polite. */
const CONCURRENCY = 8

const cache = new Map()
function fetchText(url) {
  if (!cache.has(url)) cache.set(url, fetch(url).then((r) => (r.ok ? r.text() : null)))
  return cache.get(url)
}

/** Resolve `AP_HW_CUBEORANGE` and friends to their numbers. */
async function boardTypes() {
  const txt = await fetchText(`${RAW}/Tools/AP_Bootloader/board_types.txt`)
  const map = new Map()
  for (const line of (txt ?? '').split('\n')) {
    // Hyphens are ordinary in these symbols (`AP_HW_AET-H743-Basic`), and a
    // word-character class silently dropped every board that had one.
    const m = /^\s*([A-Za-z0-9_-]+)\s+(\d+)/.exec(line)
    if (m) map.set(m[1], Number(m[2]))
  }
  return map
}

/**
 * Flatten a board's hwdef, following `include` relative to the including file.
 *
 * Depth-limited rather than cycle-detected: the tree is two or three deep, and a
 * cycle would be a bug upstream rather than something to paper over here.
 */
async function flatten(dir, file = 'hwdef.dat', depth = 0) {
  if (depth > 4) return []
  const txt = await fetchText(`${HWDEF}/${dir}/${file}`)
  if (txt === null) return []
  const out = []
  for (const line of txt.split('\n')) {
    const inc = /^\s*include\s+(\S+)/.exec(line)
    if (inc) {
      // Resolved against the including file, so `../iomcu/hwdef.inc` works.
      const rel = new URL(inc[1], `file:///${dir}/${file}`).pathname.replace(/^\//, '')
      const slash = rel.lastIndexOf('/')
      out.push(...(await flatten(rel.slice(0, slash), rel.slice(slash + 1), depth + 1)))
      continue
    }
    out.push(line)
  }
  return out
}

/**
 * The output pins, after `undef`.
 *
 * A variant overrides its base by undefining pins and redefining them, and the
 * `-bdshot` boards move outputs to entirely different timers while doing it:
 *
 *   include ../MatekH743/hwdef.dat
 *   undef PC7 PC6 PB0 PB1 ...
 *   PB0  TIM3_CH3 TIM3  PWM(1)  GPIO(50) BIDIR   # was TIM8 in the base
 *
 * Read as a flat list that produces two pins claiming output 1 on different
 * timers, and the groups come out shredded -- MatekH743-bdshot parsed to a
 * group of one where the board has a pair. So pins are kept by name, an
 * `undef` removes them, and a later definition replaces an earlier one.
 */
function parsePins(lines) {
  const byPin = new Map()
  for (const line of lines) {
    if (/^\s*#/.test(line)) continue
    const undef = /^\s*undef\s+(.*)$/.exec(line)
    if (undef) {
      for (const pin of undef[1].trim().split(/\s+/)) byPin.delete(pin)
      continue
    }
    const m = /^\s*(P[A-Z]\d+)\s.*?\b(TIM\d+)\b[^#]*?\bPWM\((\d+)\)/.exec(line)
    if (m) byPin.set(m[1], { timer: m[2], chan: Number(m[3]), nodma: /\bNODMA\b/.test(line) })
  }
  // A channel claimed by two surviving pins takes the later definition.
  const byChan = new Map()
  for (const pin of byPin.values()) byChan.set(pin.chan, pin)
  return [...byChan.values()]
}

/** Contiguous runs of one timer, in channel order. */
function groupsFrom(pins, offset) {
  const groups = []
  for (const p of [...pins].sort((a, b) => a.chan - b.chan)) {
    const last = groups[groups.length - 1]
    const chan = p.chan + offset
    if (last && last.timer === p.timer && chan === last.high + 1) {
      last.high = chan
      last.nodma = last.nodma && p.nodma
    } else {
      groups.push({ timer: p.timer, low: chan, high: chan, nodma: p.nodma })
    }
  }
  return groups
}

const PREAMBLE = `
/** \`[first channel, last channel, timer, 1 when the run has no DMA]\`. */
export type TimerGroupRow = readonly [number, number, string] | readonly [number, number, string, 1]

export interface Board {
  /** ArduPilot's \`APJ_BOARD_ID\` for this board. */
  id: number
  groups: readonly TimerGroupRow[]
}
`

async function main() {
  const types = await boardTypes()
  const listing = await fetch(
    `https://api.github.com/repos/ArduPilot/ardupilot/contents/libraries/AP_HAL_ChibiOS/hwdef?ref=${REF}`,
  ).then((r) => r.json())
  const dirs = listing
    .filter((e) => e.type === 'dir' && !/^(iomcu|scripts|common|STM32|.*-bl)$/i.test(e.name))
    .map((e) => e.name)

  // The IO co-processor's own fixed layout, read from its hwdef rather than
  // written down here.
  const iomcu = groupsFrom(parsePins(await flatten('iomcu')), 0)

  const boards = []
  let i = 0
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (i < dirs.length) {
        const dir = dirs[i++]
        const lines = await flatten(dir)
        if (lines.length === 0) continue
        const idLine = lines.find((l) => /^\s*APJ_BOARD_ID\s+/.test(l))
        if (!idLine) continue
        const token = idLine.trim().split(/\s+/)[1]
        const id = /^\d+$/.test(token) ? Number(token) : types.get(token)
        if (!id) continue
        const hasIomcu = lines.some((l) => /^\s*IOMCU_UART\s+/.test(l))
        const fmu = groupsFrom(parsePins(lines), hasIomcu ? 8 : 0)
        if (fmu.length === 0) continue
        // What the board calls itself over the link; defaults to the directory,
        // which is what chibios_hwdef.py does unless a board overrides it.
        const name =
          /define\s+CHIBIOS_SHORT_BOARD_NAME\s+"([^"]+)"/.exec(lines.join('\n'))?.[1] ?? dir
        boards.push({ id, name, groups: hasIomcu ? [...iomcu, ...fmu] : fmu })
      }
    }),
  )

  boards.sort((a, b) => a.name.localeCompare(b.name))
  const byName = new Map()
  for (const b of boards) if (!byName.has(b.name)) byName.set(b.name, b)

  // An id is usable on its own only where every board carrying it agrees on one
  // layout -- a board and its `-bdshot` sibling usually do, CubeBlack and
  // skyviper emphatically do not.
  const layouts = new Map()
  for (const b of byName.values()) {
    if (!layouts.has(b.id)) layouts.set(b.id, new Set())
    layouts.get(b.id).add(JSON.stringify(b.groups))
  }
  const byId = new Map()
  for (const b of byName.values()) {
    if (layouts.get(b.id).size === 1 && !byId.has(b.id)) byId.set(b.id, b.name)
  }

  const fmt = (g) => `[${g.low},${g.high},'${g.timer}'${g.nodma ? ',1' : ''}]`
  const rows = [...byName.values()]
    .map((b) => `  ['${b.name}', { id: ${b.id}, groups: [${b.groups.map(fmt).join(', ')}] }],`)
    .join('\n')
  const idRows = [...byId.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([id, name]) => `  [${id}, '${name}'],`)
    .join('\n')

  writeFileSync(
    OUT,
    `// GENERATED by scripts/hwdef-timer-groups.mjs -- do not edit.
// Source: ArduPilot ${REF}, libraries/AP_HAL_ChibiOS/hwdef.
// Regenerate when boards are added: node scripts/hwdef-timer-groups.mjs
//
// Why this exists, and why it is generated rather than read from the vehicle,
// is in that script's header. In short: a board's output timer grouping is in
// no parameter and in no MAVLink message, and the boot banner only looks like
// it carries it.
${PREAMBLE}
/** By \`CHIBIOS_SHORT_BOARD_NAME\`, which is what the boot banner prints. */
const BY_NAME = new Map<string, Board>([
${rows}
])

/**
 * By \`APJ_BOARD_ID\`, and only for ids that mean one layout.
 *
 * The ambiguous ones are left out on purpose rather than resolved to a guess:
 * id 9 is CubeBlack and Pixhawk1 and skyviper, and there is no answer for it.
 */
const BY_ID = new Map<number, string>([
${idRows}
])

/**
 * The output timer groups of the connected board, or null when we cannot say.
 *
 * Null covers three real cases and does not distinguish them, because the
 * screen's answer is the same for all three: a board added to ArduPilot since
 * this table was generated, a board whose id is shared by several layouts and
 * which did not name itself, and a vehicle that reports neither -- SITL among
 * them, since the id is a ChibiOS build constant.
 */
export function timerGroups(boardName: string | null, boardId: number): Board | null {
  if (boardName) {
    const byName = BY_NAME.get(boardName)
    if (byName) return byName
  }
  const name = BY_ID.get(boardId)
  return name ? (BY_NAME.get(name) ?? null) : null
}

/** Table sizes, for the test that guards the generator's output shape. */
export const BOARD_COUNT = BY_NAME.size
export const UNAMBIGUOUS_ID_COUNT = BY_ID.size
`,
    'utf8',
  )
  console.log(`wrote ${byName.size} boards (${byId.size} unambiguous ids) to ${OUT.pathname}`)
}

await main()
