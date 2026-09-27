// @vitest-environment node
//
// The video client against GStreamer, an independent implementation. Run with:
//
//   node scripts/video-testsrc.mjs rtsp        (one terminal)
//   VIDEO=1 npm test                           (another)
//
// Skipped unless VIDEO=1.
//
// Mainly exercises the H.264 depayloader: rtph264pay aggregates small NALs
// into STAP-A, splits large ones across FU-A and emits real SPS/PPS from
// x264enc, and a failure in any of those paths is silent.

import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openSource } from './source'
import type { AccessUnit } from './h264'
import { findGstreamer } from '../../scripts/video-testsrc.mjs'

const RTSP_URL = process.env.VIDEO_URL ?? 'rtsp://127.0.0.1:8554/test'
const UDP_PORT = Number(process.env.VIDEO_TESTSRC_UDP_PORT ?? 5600)
const live = process.env.VIDEO === '1' ? describe : describe.skip

/**
 * Decodes an Annex-B stream with GStreamer and returns how many frames came
 * out. If reassembly dropped a fragment or misordered NALs, an independent
 * decoder produces fewer frames than we fed it.
 *
 * Scaled to 16x16 GRAY8 so the frame count is a division of the file size.
 */
function decodedFrameCount(annexB: Uint8Array): { frames: number; stderr: string } {
  const bin = findGstreamer()
  if (bin === null) throw new Error('GStreamer not found')
  const dir = mkdtempSync(path.join(os.tmpdir(), 'loftgcs-video-'))
  const input = path.join(dir, 'capture.h264')
  const output = path.join(dir, 'frames.gray')
  writeFileSync(input, annexB)
  const exe = os.platform() === 'win32' ? 'gst-launch-1.0.exe' : 'gst-launch-1.0'
  const gst = (p: string) => p.replace(/\\/g, '/')
  const proc = spawnSync(
    bin ? path.join(bin, exe) : exe,
    [
      '-q',
      'filesrc',
      `location=${gst(input)}`,
      '!',
      'h264parse',
      '!',
      'avdec_h264',
      // Without this libav conceals damage and still emits a frame, so a
      // truncated NAL would count the same as a good one.
      'output-corrupt=false',
      '!',
      'videoconvert',
      '!',
      'videoscale',
      '!',
      'video/x-raw,format=GRAY8,width=16,height=16',
      '!',
      'filesink',
      `location=${gst(output)}`,
    ],
    {
      encoding: 'utf8',
      env: bin ? { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` } : process.env,
    },
  )
  let frames = 0
  try {
    frames = statSync(output).size / (16 * 16)
  } catch {
    frames = 0
  }
  return { frames, stderr: proc.stderr ?? '' }
}

/** Collects units until `want` have arrived, or gives up. */
function collect(url: string, want: number, ms = 15_000) {
  return new Promise<{ codec: string; units: AccessUnit[]; status: string[] }>(
    (resolve, reject) => {
      const units: AccessUnit[] = []
      const status: string[] = []
      let codec = ''
      const source = openSource(url)
      const done = (err?: Error) => {
        clearTimeout(timer)
        source.close()
        if (err) reject(err)
        else resolve({ codec, units, status })
      }
      const timer = setTimeout(
        () => done(units.length ? undefined : new Error(`no video from ${url}`)),
        ms,
      )
      source.on('ready', (info) => (codec = info.codec))
      source.on('status', (s) => status.push(s))
      source.on('unit', (u) => {
        units.push(u)
        if (units.length >= want) done()
      })
      source.on('error', (err) => done(err))
    },
  )
}

/** Splits an Annex-B buffer back into NAL units, to inspect what we built. */
function nals(data: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = []
  let start = -1
  for (let i = 0; i + 2 < data.length; i++) {
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) {
      if (start >= 0) out.push(data.subarray(start, i))
      start = i + 3
      i += 2
    }
  }
  if (start >= 0) out.push(data.subarray(start))
  return out
}

const nalType = (n: Uint8Array) => (n[0] ?? 0) & 0x1f

live('against a real GStreamer RTSP server', () => {
  it('negotiates, depayloads and produces decodable access units', async () => {
    const { codec, units } = await collect(RTSP_URL, 40)

    // Derived from the SPS x264enc actually emitted, not one we wrote.
    expect(codec).toMatch(/^avc1\.[0-9a-f]{6}$/)
    expect(units.length).toBeGreaterThanOrEqual(40)

    // Every unit must start with a start code, or the decoder rejects the lot.
    for (const u of units) {
      expect([...u.data.subarray(0, 4)]).toEqual([0, 0, 0, 1])
    }

    // At 30 fps with a keyframe a second, 40 units must span at least one.
    const keys = units.filter((u) => u.keyframe)
    expect(keys.length).toBeGreaterThan(0)

    // Every keyframe carries its parameter sets, so the HUD can recover from
    // a dropped link on any keyframe.
    for (const k of keys) {
      const types = nals(k.data).map(nalType)
      expect(types).toContain(7) // SPS
      expect(types).toContain(8) // PPS
      expect(types).toContain(5) // IDR
      expect(types.indexOf(7)).toBeLessThan(types.indexOf(5))
      // A delimiter must stay first; Chromium will not decode otherwise.
      if (types.includes(9)) expect(types[0]).toBe(9)
    }

    // Non-keyframes carry slice data and no parameter sets. Dropped P-frames
    // would show as a frozen picture rather than an error.
    const inter = units.filter((u) => !u.keyframe)
    expect(inter.length).toBeGreaterThan(0)
    for (const u of inter) {
      const types = nals(u.data).map(nalType)
      expect(types).toContain(1)
      expect(types).not.toContain(7)
      expect(types).not.toContain(8)
    }

    // Guards the fixture: keyframes must be large enough (~18 KB, a dozen
    // packets) to exercise middle fragments. videotestsrc's `ball` pattern
    // fits a keyframe in two packets. If this fails, suspect the test source
    // before the client.
    expect(Math.max(...keys.map((k) => k.data.length))).toBeGreaterThan(8000)

    // Timestamps must advance, or the decoder queues everything at t=0.
    const stamps = units.map((u) => u.timestamp)
    expect(new Set(stamps).size).toBeGreaterThan(units.length / 2)
    expect(Math.max(...stamps)).toBeGreaterThan(Math.min(...stamps))
  }, 30_000)

  it('produces a bitstream an independent decoder accepts whole', async () => {
    const { units } = await collect(RTSP_URL, 60)
    const total = units.reduce((n, u) => n + u.data.length, 0)
    const joined = new Uint8Array(total)
    let at = 0
    for (const u of units) {
      joined.set(u.data, at)
      at += u.data.length
    }

    const { frames, stderr } = decodedFrameCount(joined)

    // One frame out per access unit in. A dropped fragment, misordered NAL
    // or missing parameter set shows up as a shortfall.
    expect(frames).toBe(units.length)
    expect(stderr).not.toMatch(/error/i)
  }, 40_000)

  it('reports a stream that is not there instead of hanging', async () => {
    await expect(collect('rtsp://127.0.0.1:8554/nonexistent', 1, 8000)).rejects.toThrow()
  }, 15_000)
})

/**
 * The RTSP tests do not cover FU-A: interleaved RTP over TCP has no datagram
 * limit, so GStreamer sends each keyframe whole. UDP forces fragmentation.
 * This block starts its own sender and needs only GStreamer installed.
 */
live('over UDP, where keyframes must fragment', () => {
  let sender: ReturnType<typeof spawn> | null = null

  beforeAll(() => {
    sender = spawn(process.execPath, ['scripts/video-testsrc.mjs', 'udp'], {
      stdio: 'ignore',
    })
  })
  afterAll(() => sender?.kill())

  it('reassembles fragmented keyframes into a decodable stream', async () => {
    const { units } = await collect(`udp://:${UDP_PORT}`, 60, 25_000)

    // The sender's MTU is 1200; a keyframe here is ~145 KB, each slice
    // spanning 6-8 FU-A fragments. The threshold sits near the real size
    // because a depayloader keeping only two fragments per NAL still yields
    // ~26 KB keyframes that decode to the full frame count.
    const keys = units.filter((u) => u.keyframe)
    expect(keys.length).toBeGreaterThan(0)
    expect(Math.max(...keys.map((k) => k.data.length))).toBeGreaterThan(60_000)

    // One frame out per unit in: a truncated NAL still looks like a keyframe
    // from the outside, and only a decoder notices.
    const total = units.reduce((n, u) => n + u.data.length, 0)
    const joined = new Uint8Array(total)
    let at = 0
    for (const u of units) {
      joined.set(u.data, at)
      at += u.data.length
    }
    const { frames, stderr } = decodedFrameCount(joined)
    expect(frames).toBe(units.length)
    expect(stderr).not.toMatch(/error/i)
  }, 60_000)
})
