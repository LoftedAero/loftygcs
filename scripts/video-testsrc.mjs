// A video source to point the HUD at without a camera.
//
//   node scripts/video-testsrc.mjs rtsp     -> rtsp://127.0.0.1:8554/test
//   node scripts/video-testsrc.mjs udp      -> RTP to 127.0.0.1:5600
//
// The loopback test in electron/video/source.test.ts only checks our client
// against our own fake server. GStreamer shares none of our assumptions:
// x264enc emits real SPS/PPS, and rtph264pay does its own STAP-A aggregation
// and FU-A fragmentation.
//
// GStreamer is a test fixture only, not an app dependency, so nothing under
// electron/ or src/ refers to it.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const CLIP = path.resolve('video-fixtures', 'testsrc.mp4')
// Long enough to watch the HUD for a while; short enough to encode in seconds.
const SECONDS = Number(process.env.VIDEO_TESTSRC_SECONDS ?? 120)
const FPS = 30
const RTSP_PORT = Number(process.env.VIDEO_TESTSRC_PORT ?? 8554)
const UDP_PORT = Number(process.env.VIDEO_TESTSRC_UDP_PORT ?? 5600)

// The pattern matters. `ball` encodes to under 1 KB a frame even at 1080p and
// 8 Mbit, so its keyframes fit in two RTP packets and FU-A reassembly never
// sees a middle fragment. `circular` runs about 18 KB a frame, so a keyframe
// spans a dozen or so packets as a real camera's does, and its rings make
// decode artifacts easy to see.
const PATTERN = process.env.VIDEO_TESTSRC_PATTERN ?? 'pattern=circular'
const BITRATE = Number(process.env.VIDEO_TESTSRC_BITRATE ?? 8000)

// Mission Planner ships a full GStreamer for its own video support, so a
// Windows machine often has one there.
const CANDIDATES = [
  process.env.GSTREAMER_ROOT,
  'C:/ProgramData/Mission Planner/gstreamer/1.0/x86_64',
  'C:/gstreamer/1.0/msvc_x86_64',
  'C:/gstreamer/1.0/mingw_x86_64',
  '/usr/local',
  '/usr',
  '/opt/homebrew',
]

/** The bin/ directory holding gst-launch-1.0, or null. */
export function findGstreamer() {
  const exe = os.platform() === 'win32' ? 'gst-launch-1.0.exe' : 'gst-launch-1.0'
  for (const root of CANDIDATES) {
    if (!root) continue
    const bin = path.join(root, 'bin')
    if (existsSync(path.join(bin, exe))) return bin
  }
  // Already on PATH (the normal case everywhere but Windows).
  const probe = spawnSync(exe, ['--version'], { stdio: 'ignore' })
  return probe.status === 0 ? '' : null
}

/**
 * GStreamer's property parser treats a backslash as an escape, which silently
 * mangles a Windows path. Forward slashes work everywhere.
 */
const gstPath = (p) => p.replace(/\\/g, '/')

function run(bin, exe, args, opts = {}) {
  const env = { ...process.env }
  if (bin) env.PATH = `${bin}${path.delimiter}${env.PATH}`
  const file = bin ? path.join(bin, exe) : exe
  return spawn(file, args, { stdio: 'inherit', env, ...opts })
}

/** Encode the clip once and reuse it. */
function ensureClip(bin) {
  if (existsSync(CLIP) && statSync(CLIP).size > 0) return
  mkdirSync(path.dirname(CLIP), { recursive: true })
  // ASCII only: a Windows console renders this output as cp1252.
  console.log(`encoding a ${SECONDS}s test clip (one time, about a minute)...`)
  const exe = os.platform() === 'win32' ? 'gst-launch-1.0.exe' : 'gst-launch-1.0'
  const child = spawnSync(
    bin ? path.join(bin, exe) : exe,
    [
      '-q',
      'videotestsrc',
      `num-buffers=${SECONDS * FPS}`,
      PATTERN,
      '!',
      `video/x-raw,width=1280,height=720,framerate=${FPS}/1`,
      '!',
      'x264enc',
      'tune=zerolatency',
      `bitrate=${BITRATE}`,
      // A keyframe a second, as a camera would send.
      `key-int-max=${FPS}`,
      '!',
      'h264parse',
      '!',
      'mp4mux',
      '!',
      'filesink',
      `location=${gstPath(CLIP)}`,
    ],
    { stdio: 'inherit', env: bin ? { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` } : process.env },
  )
  if (child.status !== 0 || !existsSync(CLIP)) {
    console.error('could not encode the test clip')
    process.exit(1)
  }
}

function main() {
  const mode = process.argv[2] ?? 'rtsp'
  const bin = findGstreamer()
  if (bin === null) {
    console.error(
      'GStreamer not found. Looked on PATH and in:\n' +
        CANDIDATES.filter(Boolean)
          .map((c) => `  ${c}`)
          .join('\n') +
        '\nSet GSTREAMER_ROOT to the directory holding bin/gst-launch-1.0.',
    )
    process.exit(1)
  }

  if (mode === 'rtsp') {
    ensureClip(bin)
    // gst-validate-rtsp-server wraps gst-rtsp-server, so DESCRIBE/SETUP/PLAY
    // are exercised against an independent implementation.
    const exe =
      os.platform() === 'win32'
        ? 'gst-validate-rtsp-server-1.0.exe'
        : 'gst-validate-rtsp-server-1.0'
    console.log(`serving rtsp://127.0.0.1:${RTSP_PORT}/test  (Ctrl+C to stop)`)
    run(bin, exe, [`file:///${gstPath(CLIP)}`, '-p', String(RTSP_PORT)])
  } else if (mode === 'udp') {
    const exe = os.platform() === 'win32' ? 'gst-launch-1.0.exe' : 'gst-launch-1.0'
    console.log(
      `sending RTP to 127.0.0.1:${UDP_PORT} -- connect to udp://:${UDP_PORT}  (Ctrl+C to stop)`,
    )
    run(bin, exe, [
      '-q',
      'videotestsrc',
      'is-live=true',
      PATTERN,
      '!',
      `video/x-raw,width=1280,height=720,framerate=${FPS}/1`,
      '!',
      'x264enc',
      'tune=zerolatency',
      `bitrate=${BITRATE}`,
      `key-int-max=${FPS}`,
      '!',
      'h264parse',
      // Repeat the parameter sets so a late receiver can start, as a camera
      // does. With no SDP, the depayloader relies on this.
      'config-interval=1',
      '!',
      'rtph264pay',
      'pt=96',
      'config-interval=1',
      // Below the 1500-byte MTU so keyframes are split across FU-A packets.
      'mtu=1200',
      '!',
      'udpsink',
      'host=127.0.0.1',
      `port=${UDP_PORT}`,
    ])
  } else {
    console.error(`unknown mode "${mode}" -- expected rtsp or udp`)
    process.exit(1)
  }
}

// Only when run as a script: the live test imports findGstreamer from here.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
