import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { videoService, type VideoStatus } from './video'
import { describeVideoError, isRetryable, videoTarget } from './video-error'

// The desktop bridge, faked: what it was asked to do, and a way to make it
// say things back.
type StatusMsg = { text: string; error?: boolean; closed?: boolean }
const statusCbs = new Set<(s: StatusMsg) => void>()
const readyCbs = new Set<(i: { codec: string }) => void>()
const unitCbs = new Set<(u: { data: Uint8Array; keyframe: boolean; timestamp: number }) => void>()
const opened: string[] = []
let closes = 0
const bridge = {
  open: (url: string) => {
    opened.push(url)
    return Promise.resolve({ ok: true as const })
  },
  close: () => {
    closes++
    return Promise.resolve({ ok: true as const })
  },
  onStatus: (cb: (s: StatusMsg) => void) => (statusCbs.add(cb), () => statusCbs.delete(cb)),
  onReady: (cb: (i: { codec: string }) => void) => (readyCbs.add(cb), () => readyCbs.delete(cb)),
  onUnit: (cb: (u: { data: Uint8Array; keyframe: boolean; timestamp: number }) => void) => (
    unitCbs.add(cb),
    () => unitCbs.delete(cb)
  ),
}
const say = (s: StatusMsg) => [...statusCbs].forEach((cb) => cb(s))

/** A decoder that turns every chunk into a 1280x720 frame at once. */
class FakeDecoder {
  state = 'unconfigured'
  constructor(private init: { output: (f: unknown) => void }) {}
  configure() {
    this.state = 'configured'
  }
  decode() {
    this.init.output({ displayWidth: 1280, displayHeight: 720, close() {} })
  }
  close() {
    this.state = 'closed'
  }
}
class FakeChunk {}

/** A frame arriving from the wire, codec announced first. */
function frame() {
  ;[...readyCbs].forEach((cb) => cb({ codec: 'avc1.42e01f' }))
  ;[...unitCbs].forEach((cb) => cb({ data: new Uint8Array([0]), keyframe: true, timestamp: 0 }))
}

let status: VideoStatus
beforeEach(async () => {
  vi.useFakeTimers()
  opened.length = 0
  closes = 0
  ;(window as unknown as { loftgcs: unknown }).loftgcs = { video: bridge }
  vi.stubGlobal('VideoDecoder', FakeDecoder)
  vi.stubGlobal('EncodedVideoChunk', FakeChunk)
  videoService.onStatus((s) => (status = s))
  await videoService.open('rtsp://10.0.0.5:8554/cam')
})

afterEach(async () => {
  await videoService.close()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  delete (window as unknown as { loftgcs?: unknown }).loftgcs
})

describe('a stream that fails', () => {
  it('keeps the error, rather than the "Stopped" that always follows it', () => {
    say({ text: 'connect ECONNREFUSED 10.0.0.5:8554', error: true })
    say({ text: 'Stopped', closed: true })
    expect(status.state).toBe('retrying')
    expect(status.text).toBe('Nothing is listening at 10.0.0.5:8554. Reconnecting…')
  })

  it('tries again by itself, backing off', async () => {
    say({ text: 'connect ECONNREFUSED 10.0.0.5:8554', error: true })
    await vi.advanceTimersByTimeAsync(999)
    expect(opened).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(opened).toHaveLength(2)
    say({ text: 'connect ECONNREFUSED 10.0.0.5:8554', error: true })
    await vi.advanceTimersByTimeAsync(1999)
    expect(opened).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(opened).toHaveLength(3)
  })

  it('stops for a failure that trying again could not fix', async () => {
    say({ text: 'Only H.264 is supported; this stream is H265', error: true })
    expect(status).toEqual({
      state: 'error',
      text: 'Only H.264 is supported; this stream is H265.',
    })
    await vi.advanceTimersByTimeAsync(10000)
    expect(opened).toHaveLength(1)
  })

  it('stops trying when the user disconnects', async () => {
    say({ text: 'read ECONNRESET', error: true })
    await videoService.close()
    await vi.advanceTimersByTimeAsync(10000)
    expect(opened).toHaveLength(1)
    expect(status).toEqual({ state: 'idle', text: '' })
  })

  it('treats a close with no error as a drop', () => {
    say({ text: 'Stopped', closed: true })
    expect(status.text).toBe('The stream stopped. Reconnecting…')
  })
})

describe('a stream that plays', () => {
  it('says what is playing', () => {
    frame()
    expect(status).toEqual({ state: 'playing', text: 'Playing · 1280×720' })
  })

  it('counts going silent as a drop, since no event reports it', async () => {
    frame()
    await vi.advanceTimersByTimeAsync(3600)
    expect(status.state).toBe('retrying')
    expect(status.text).toBe('No video for 3 s. Reconnecting…')
    await vi.advanceTimersByTimeAsync(1000)
    expect(opened).toHaveLength(2)
  })

  it('starts the backoff over once it plays again', async () => {
    say({ text: 'read ECONNRESET', error: true })
    await vi.advanceTimersByTimeAsync(1000)
    say({ text: 'read ECONNRESET', error: true })
    await vi.advanceTimersByTimeAsync(2000)
    frame()
    say({ text: 'read ECONNRESET', error: true })
    // Back to the first, shortest wait.
    await vi.advanceTimersByTimeAsync(1000)
    expect(opened).toHaveLength(4)
  })
})

describe('the words', () => {
  it('names the stream as it was typed', () => {
    expect(videoTarget('rtsp://user:pw@10.0.0.5/cam')).toBe('10.0.0.5:554')
    expect(videoTarget('rtsp://10.0.0.5:8554/cam')).toBe('10.0.0.5:8554')
    expect(videoTarget('udp://0.0.0.0:5600')).toBe('port 5600')
  })

  it('turns a Node error code into a sentence, and leaves one alone', () => {
    const url = 'rtsp://10.0.0.5:8554/cam'
    expect(describeVideoError('read ECONNRESET', url)).toBe('10.0.0.5:8554 closed the connection.')
    expect(describeVideoError('No answer from 10.0.0.5:8554', url)).toBe(
      'No answer from 10.0.0.5:8554.',
    )
  })

  it('says what the field takes, not the address back', () => {
    expect(describeVideoError('Not an RTSP URL: http://x', 'http://x')).toBe(
      'The address must start with rtsp:// or udp://.',
    )
  })

  it('does not retry a request that is itself wrong', () => {
    expect(isRetryable('Not an RTSP URL: http://x')).toBe(false)
    expect(isRetryable('DESCRIBE failed: 404 Not Found')).toBe(false)
    expect(isRetryable('DESCRIBE failed: 503 Service Unavailable')).toBe(true)
    expect(isRetryable('connect ETIMEDOUT 10.0.0.5:8554')).toBe(true)
  })
})
