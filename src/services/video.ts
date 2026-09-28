// HUD video in the renderer: decodes the bitstream the main process forwards
// with WebCodecs and hands frames to whoever is drawing. WebCodecs because
// there is no container, just access units off the wire.
//
// A dropped stream reconnects by itself: any failure that is not about the
// request itself (video-error.ts) retries with backoff until the user presses
// Disconnect. A stream that goes silent while playing counts as a failure,
// since a camera that stops sending without closing its socket raises no
// event.
//
// The desktop side follows every failure with a "Stopped". Only the first
// report of a session is acted on, so that "Stopped" does not wipe the error.

import { describeVideoError, isRetryable } from './video-error'

export type VideoState = 'idle' | 'connecting' | 'playing' | 'retrying' | 'error'

export interface VideoStatus {
  state: VideoState
  /** What to show the user: a step, what is playing, or why it stopped. */
  text: string
}

type FrameSink = (frame: VideoFrame) => void
type StatusSink = (status: VideoStatus) => void

/** Waits between attempts: quick at first, then no more often than this. */
const RETRY_MS = [1000, 2000, 4000, 5000]
/** How long a playing stream may send no frame before it counts as dropped. */
const SILENT_MS = 3000

class VideoService {
  private decoder: VideoDecoder | null = null
  private unsubscribe: (() => void)[] = []
  private frameSinks = new Set<FrameSink>()
  private statusSinks = new Set<StatusSink>()
  private status: VideoStatus = { state: 'idle', text: '' }
  /** Frames before the first keyframe are dropped. */
  private sawKeyframe = false
  /** The stream wanted, or null once the user has stopped it. */
  private url: string | null = null
  /** Counts attempts, so a late event from an abandoned attempt is ignored. */
  private session = 0
  /** The session whose failure has been handled; its "Stopped" is ignored. */
  private failedSession = -1
  private attempt = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private watchdog: ReturnType<typeof setInterval> | null = null
  private lastFrameAt = 0
  private size = ''

  get current(): VideoStatus {
    return this.status
  }

  onFrame(sink: FrameSink): () => void {
    this.frameSinks.add(sink)
    return () => this.frameSinks.delete(sink)
  }

  onStatus(sink: StatusSink): () => void {
    this.statusSinks.add(sink)
    sink(this.status)
    return () => this.statusSinks.delete(sink)
  }

  private setStatus(state: VideoState, text: string) {
    this.status = { state, text }
    for (const s of this.statusSinks) s(this.status)
  }

  supported(): boolean {
    return typeof window !== 'undefined' && 'VideoDecoder' in window && !!window.loftgcs?.video
  }

  /** Start showing a stream, and keep it showing until `close`. */
  async open(url: string): Promise<void> {
    await this.close()
    const bridge = window.loftgcs?.video
    if (!bridge) {
      this.setStatus('error', 'Video requires the desktop app.')
      return
    }
    if (!('VideoDecoder' in window)) {
      this.setStatus('error', 'This build has no WebCodecs decoder.')
      return
    }
    this.url = url
    this.attempt = 0
    this.setStatus('connecting', 'Opening…')
    await this.start()
  }

  private async start(): Promise<void> {
    const bridge = window.loftgcs?.video
    const url = this.url
    if (!bridge || url === null) return
    const session = ++this.session
    this.teardown()

    this.unsubscribe.push(
      bridge.onStatus((s) => {
        if (session !== this.session) return
        if (s.error) this.failed(session, s.text)
        else if (s.closed) this.failed(session, null)
        // Progress from the desktop side, until the first frame arrives.
        else if (this.status.state === 'connecting') this.setStatus('connecting', s.text)
      }),
      bridge.onReady((info) => {
        if (session === this.session) this.configure(info.codec, session)
      }),
      bridge.onUnit((u) => {
        if (session === this.session) this.decode(u, session)
      }),
    )

    const result = await bridge.open(url)
    if (!result.ok) this.failed(session, result.error)
  }

  /**
   * An attempt ended unrequested: report why, then retry unless the failure
   * is not retryable. `raw` is null when the far end closed without an error.
   */
  private failed(session: number, raw: string | null) {
    if (session !== this.session || session === this.failedSession || this.url === null) return
    this.failedSession = session
    const url = this.url
    this.teardown()
    void window.loftgcs?.video?.close().catch(() => undefined)
    const sentence = raw === null ? 'The stream stopped.' : describeVideoError(raw, url)
    if (raw !== null && !isRetryable(raw)) {
      this.url = null
      this.setStatus('error', sentence)
      return
    }
    const wait = RETRY_MS[Math.min(this.attempt, RETRY_MS.length - 1)]!
    this.attempt++
    this.setStatus('retrying', `${sentence} Reconnecting…`)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.start()
    }, wait)
  }

  private configure(codec: string, session: number) {
    this.dropDecoder()
    this.sawKeyframe = false
    const decoder = new VideoDecoder({
      output: (frame) => {
        this.lastFrameAt = Date.now()
        const size = `${frame.displayWidth}×${frame.displayHeight}`
        if (this.status.state !== 'playing' || size !== this.size) {
          this.size = size
          this.attempt = 0
          this.setStatus('playing', `Playing · ${size}`)
          this.watch(session)
        }
        if (this.frameSinks.size === 0) {
          // An unclosed frame leaks its buffer and eventually stalls the decoder.
          frame.close()
          return
        }
        for (const sink of this.frameSinks) sink(frame)
        frame.close()
      },
      error: (err) => this.failed(session, err.message),
    })
    // No description: the depayloader produces Annex-B, which VideoDecoder
    // assumes when none is given.
    decoder.configure({ codec, optimizeForLatency: true })
    this.decoder = decoder
  }

  /** While playing, a stream that stops sending frames has dropped. */
  private watch(session: number) {
    if (this.watchdog) return
    this.watchdog = setInterval(() => {
      if (Date.now() - this.lastFrameAt > SILENT_MS) {
        this.failed(session, `No video for ${SILENT_MS / 1000} s`)
      }
    }, 500)
  }

  private decode(u: { data: Uint8Array; keyframe: boolean; timestamp: number }, session: number) {
    const decoder = this.decoder
    if (!decoder || decoder.state !== 'configured') return
    if (!this.sawKeyframe) {
      if (!u.keyframe) return
      this.sawKeyframe = true
    }
    try {
      decoder.decode(
        new EncodedVideoChunk({
          type: u.keyframe ? 'key' : 'delta',
          // RTP timestamps for H.264 run at 90 kHz; WebCodecs wants µs.
          timestamp: Math.round((u.timestamp / 90000) * 1e6),
          data: u.data,
        }),
      )
    } catch (err) {
      this.failed(session, err instanceof Error ? err.message : 'Decode failed')
    }
  }

  private dropDecoder() {
    const decoder = this.decoder
    this.decoder = null
    if (!decoder) return
    try {
      if (decoder.state !== 'closed') decoder.close()
    } catch {
      // Already torn down.
    }
  }

  /** Releases everything an attempt holds, without changing the status. */
  private teardown() {
    for (const off of this.unsubscribe) off()
    this.unsubscribe = []
    if (this.watchdog) clearInterval(this.watchdog)
    this.watchdog = null
    this.dropDecoder()
    this.size = ''
  }

  /** Stops the stream and any retries, without showing a reason. */
  async close(): Promise<void> {
    this.url = null
    this.session++
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.teardown()
    await window.loftgcs?.video?.close().catch(() => undefined)
    this.setStatus('idle', '')
  }
}

export const videoService = new VideoService()
